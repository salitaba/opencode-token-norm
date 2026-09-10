// Measured usage: the counting half of the budget plugin.
//
// session-budget.ts counts tool calls because that is the only signal a plugin
// used to have. OpenCode does emit the real numbers -- every assistant step
// publishes a `step-finish` part carrying cost and the full token breakdown --
// but nothing was reading them, so the norm estimated spend from tool-call
// counts with a formula that lived only in scripts/usage-audit.py.
//
// This module is the single accumulator for those events. One rule it enforces
// on the caller: `step-finish` is the ONLY token/cost source. AssistantMessage
// carries the same fields and summing both would double every dollar -- the
// bug this module exists to prevent is worth more than the fields it reads.
//
// Attribution (bytes per tool, repeated reads) is estimated from tool args and
// output sizes, never presented as provider-measured tokens: bytes are not
// tokens and chunking means neither one converts linearly into the other.

export interface StepTokens {
  input: number
  output: number
  reasoning: number
  cache: { read: number; write: number }
}

export interface StepUsage {
  partID: string
  cost: number
  effective: number
  tokens: StepTokens
  /** Prompt + output for this step, i.e. what the window holds right after it. */
  contextAfter: number
  at: number
}

export interface Rollup {
  costUsd: number
  effectiveTokens: number
  stepCount: number
  calls: number
  sessions: number
}

export interface SessionUsage {
  sessionID: string
  parentID?: string
  childIDs: Set<string>
  costUsd: number
  effectiveTokens: number
  stepCount: number
  /** Budgeted tool calls, cheap tools excluded by the caller. */
  calls: number
  contextNow: number
  contextPeak: number
  providerID?: string
  modelID?: string
  history: StepUsage[]
  /** Positive context-window growth per step; cleared by compaction. */
  deltas: number[]
  seenParts: Set<string>
  bytesByTool: Map<string, number>
  readCounts: Map<string, number>
  imageReads: number
  editedFiles: Map<string, number>
  lastTool?: string
  /** Totals-only tombstone left by `session.deleted`: counters and linkage
   * stay so rollups keep their dollars, detail is freed. Late events for the
   * id are ignored; only a real `session.created` revives it. */
  retired: boolean
}

export interface NormEvent {
  type?: string
  properties?: any
}

export interface Bloat {
  medianDelta: number
  lastDelta: number
  /** Last step grew the window more than 2x the session's median growth. */
  flagged: boolean
}

export interface Attribution {
  topTools: Array<{ tool: string; bytes: number }>
  repeated: Array<{ file: string; count: number }>
  images: number
}

const HISTORY_MAX = 100
const SEEN_PARTS_MAX = 500
const EDITED_MAX = 100
const RECENT_EDITS_MAX = 20
const ROOT_DEPTH_MAX = 20

// Tool ids that write to disk. `file.edited` carries no sessionID (verified
// against the installed runtime schema: `{ file: String }`), so per-session
// edit attribution has to come from the tool args; the event only feeds a
// directory-level fallback.
const MUTATING_TOOLS = new Set(["edit", "write", "patch", "multiedit", "apply_patch"])
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|svg|ico|pdf)$/i

/** Mirror of usage-audit.py:61. Output tokens are excluded on purpose: this
 * is cost-weighted *input*, a normalized proxy for what the provider charged. */
export function effectiveFresh(tokens: Partial<StepTokens> | undefined): number {
  const input = tokens?.input ?? 0
  const cache = tokens?.cache ?? ({} as StepTokens["cache"])
  return input + 0.1 * (cache.read ?? 0) + 1.25 * (cache.write ?? 0)
}

export function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

function addCapped(set: Set<string>, value: string, max: number): void {
  set.add(value)
  if (set.size > max) {
    const oldest = set.values().next().value
    if (oldest !== undefined) set.delete(oldest)
  }
}

function pushCapped<T>(list: T[], value: T, max: number): void {
  list.push(value)
  if (list.length > max) list.splice(0, list.length - max)
}

function normalizeTokens(tokens: any): StepTokens {
  return {
    input: tokens?.input ?? 0,
    output: tokens?.output ?? 0,
    reasoning: tokens?.reasoning ?? 0,
    cache: { read: tokens?.cache?.read ?? 0, write: tokens?.cache?.write ?? 0 },
  }
}

function empty(sessionID: string): SessionUsage {
  return {
    sessionID,
    childIDs: new Set(),
    costUsd: 0,
    effectiveTokens: 0,
    stepCount: 0,
    calls: 0,
    contextNow: 0,
    contextPeak: 0,
    history: [],
    deltas: [],
    seenParts: new Set(),
    bytesByTool: new Map(),
    readCounts: new Map(),
    imageReads: 0,
    editedFiles: new Map(),
    retired: false,
  }
}

export function bloat(s: SessionUsage, factor = 2): Bloat {
  const lastDelta = s.deltas.length > 0 ? s.deltas[s.deltas.length - 1] : 0
  const medianDelta = median(s.deltas)
  return { medianDelta, lastDelta, flagged: medianDelta > 0 && lastDelta > factor * medianDelta }
}

export function attribution(s: SessionUsage): Attribution {
  const topTools = [...s.bytesByTool.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([tool, bytes]) => ({ tool, bytes }))
  const repeated = [...s.readCounts.entries()]
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([file, count]) => ({ file, count }))
  return { topTools, repeated, images: s.imageReads }
}

export class UsageTracker {
  private sessions = new Map<string, SessionUsage>()
  private recentEdits: string[] = []

  get(sessionID: string): SessionUsage {
    let s = this.sessions.get(sessionID)
    if (!s) {
      s = empty(sessionID)
      this.sessions.set(sessionID, s)
    }
    return s
  }

  has(sessionID: string): boolean {
    return this.sessions.has(sessionID)
  }

  /** Tool bytes are chars-of-output, not tokens. The caller labels them estimated. */
  noteToolCall(
    sessionID: string,
    tool: string,
    args: any,
    output: { output?: string } | undefined,
    budgeted: boolean,
  ): void {
    const s = this.get(sessionID)
    // A retired id is a deleted session's ledger entry, not a live session:
    // late tool events must not resurrect detail or move its frozen totals.
    if (s.retired) return
    s.lastTool = tool
    if (budgeted) s.calls++
    const bytes = typeof output?.output === "string" ? Buffer.byteLength(output.output) : 0
    if (bytes > 0) s.bytesByTool.set(tool, (s.bytesByTool.get(tool) ?? 0) + bytes)

    const file = typeof args?.filePath === "string" ? args.filePath : undefined
    if (tool === "read" && file) {
      s.readCounts.set(file, (s.readCounts.get(file) ?? 0) + 1)
      if (IMAGE_EXT.test(file)) s.imageReads++
    }
    if (MUTATING_TOOLS.has(tool) && file) {
      s.editedFiles.set(file, (s.editedFiles.get(file) ?? 0) + 1)
    }
  }

  noteFileEdited(file: string): void {
    this.recentEdits = [file, ...this.recentEdits.filter((f) => f !== file)].slice(0, RECENT_EDITS_MAX)
  }

  recentEditedFiles(): string[] {
    return [...this.recentEdits]
  }

  /** Session-scoped edited files first, directory-level `file.edited` fallback. */
  editedFiles(sessionID: string): string[] {
    const seen = new Set<string>()
    const out: string[] = []
    for (const id of this.descendants(sessionID)) {
      const s = this.sessions.get(id)
      if (!s) continue
      for (const file of [...s.editedFiles.keys()].reverse()) {
        if (seen.has(file)) continue
        seen.add(file)
        out.push(file)
      }
    }
    if (out.length === 0) {
      for (const file of this.recentEdits) {
        if (seen.has(file)) continue
        seen.add(file)
        out.push(file)
      }
    }
    return out.slice(0, EDITED_MAX)
  }

  handleEvent(event: NormEvent | undefined): void {
    const type = event?.type
    const props = event?.properties
    if (type === "message.part.updated") {
      const part = props?.part
      if (part?.type === "step-finish") this.applyStep(part)
      return
    }
    if (type === "message.updated") {
      const info = props?.info
      if (info?.role === "assistant" && typeof info.sessionID === "string") {
        const s = this.get(info.sessionID)
        if (s.retired) return
        if (typeof info.providerID === "string") s.providerID = info.providerID
        if (typeof info.modelID === "string") s.modelID = info.modelID
      }
      return
    }
    if (type === "session.created" || type === "session.updated") {
      const info = props?.info
      if (!info?.id) return
      const s = this.get(info.id)
      // A late `session.updated` for a tombstone is a stale event; reparenting
      // frozen totals would move money between rollups, so ignore it. A real
      // `session.created` revives the entry with counters intact: spend is
      // never un-spent.
      if (s.retired) {
        if (type !== "session.created") return
        s.retired = false
      }
      this.setParent(s, info.parentID)
      return
    }
    if (type === "session.compacted") {
      const s = typeof props?.sessionID === "string" ? this.sessions.get(props.sessionID) : undefined
      if (s) {
        s.contextNow = 0
        s.deltas = []
      }
      return
    }
    if (type === "session.deleted") {
      const id = props?.info?.id ?? props?.sessionID
      if (typeof id === "string") this.remove(id)
      return
    }
    if (type === "file.edited") {
      if (typeof props?.file === "string") this.noteFileEdited(props.file)
    }
  }

  private applyStep(part: any): void {
    const sessionID = part?.sessionID
    const partID = part?.id
    if (typeof sessionID !== "string" || typeof partID !== "string") return
    const s = this.get(sessionID)
    // Deleted sessions keep their ledger entry; a late step for one is a
    // duplicate or a zombie, never new spend -- ignore it.
    if (s.retired) return
    // step-finish parts are published once, but dedupe by id is cheap and makes
    // a double delivery cost nothing instead of doubling the budget.
    if (s.seenParts.has(partID)) return
    addCapped(s.seenParts, partID, SEEN_PARTS_MAX)

    const tokens = normalizeTokens(part.tokens)
    const contextAfter = tokens.input + tokens.cache.read + tokens.cache.write + tokens.output
    if (s.contextNow > 0 && contextAfter > s.contextNow) {
      pushCapped(s.deltas, contextAfter - s.contextNow, HISTORY_MAX)
    }
    s.costUsd += typeof part.cost === "number" ? part.cost : 0
    s.effectiveTokens += effectiveFresh(tokens)
    s.stepCount++
    s.contextNow = contextAfter
    if (contextAfter > s.contextPeak) s.contextPeak = contextAfter
    pushCapped(
      s.history,
      { partID, cost: part.cost ?? 0, effective: effectiveFresh(tokens), tokens, contextAfter, at: Date.now() },
      HISTORY_MAX,
    )
  }

  private setParent(s: SessionUsage, parentID: string | undefined): void {
    if (parentID === s.parentID) return
    if (s.parentID) this.sessions.get(s.parentID)?.childIDs.delete(s.sessionID)
    s.parentID = parentID
    if (parentID) this.get(parentID).childIDs.add(s.sessionID)
  }

  private remove(sessionID: string): void {
    const s = this.sessions.get(sessionID)
    if (!s) return
    // Retire to a totals-only tombstone: the parent link and the rolled-up
    // counters survive (budget money was spent; un-spending on delete lies),
    // but context, deltas, seen-ids, attribution and history are freed. The
    // tombstone keeps parent->child reachability so live grandchildren stay
    // in the root rollup. Late step/tool events are ignored; only a new
    // session.created for the id revives it (see handleEvent).
    s.contextNow = 0
    s.contextPeak = 0
    s.deltas = []
    s.seenParts = new Set()
    s.history = []
    s.bytesByTool = new Map()
    s.readCounts = new Map()
    s.imageReads = 0
    s.editedFiles = new Map()
    s.lastTool = undefined
    s.providerID = undefined
    s.modelID = undefined
    s.retired = true
  }

  rootOf(sessionID: string): string {
    let current = sessionID
    for (let i = 0; i < ROOT_DEPTH_MAX; i++) {
      const parent = this.sessions.get(current)?.parentID
      if (!parent) return current
      current = parent
    }
    return current
  }

  private descendants(sessionID: string): string[] {
    const out: string[] = []
    const visited = new Set<string>()
    const queue = [sessionID]
    while (queue.length > 0) {
      const id = queue.shift()!
      if (visited.has(id)) continue
      visited.add(id)
      out.push(id)
      const s = this.sessions.get(id)
      if (s) queue.push(...s.childIDs)
    }
    return out
  }

  /** Cost/tokens/calls sum across the subtree. `contextNow` deliberately does
   * not: every session has its own window, so summing them would report a
   * window that does not exist. */
  rollup(sessionID: string): Rollup {
    let costUsd = 0
    let effectiveTokens = 0
    let stepCount = 0
    let calls = 0
    const ids = this.descendants(sessionID)
    for (const id of ids) {
      const s = this.sessions.get(id)
      if (!s) continue
      costUsd += s.costUsd
      effectiveTokens += s.effectiveTokens
      stepCount += s.stepCount
      calls += s.calls
    }
    return { costUsd, effectiveTokens, stepCount, calls, sessions: ids.length }
  }
}
