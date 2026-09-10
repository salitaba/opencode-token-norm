// Session budget enforcement (always-on, all projects).
//
// WHY THIS EXISTS
// A token norm written into AGENTS.md loads into every session and is still
// broken, because the rules that survive are the ones that do not depend on the
// agent choosing to follow them. Capping bash output works every time because a
// plugin rewrites the command and nobody has to remember it. The two rules with
// no mechanism -- "announce the cost before a big task" and "run the audit
// midway" -- were the exact two that failed in a 184-call, 3.0M effective-token
// session where the norm was in context the whole time.
//
// So this plugin does not add advice. It counts, and at thresholds it staples
// a notice onto tool output the agent is already reading. An instruction the
// agent cannot skip past beats an instruction it merely has.
//
// It never edits args and, outside opt-in `block` mode, never fails a tool
// call: a wrong guess here must cost a few lines of text, not a broken session.

import type { Plugin } from "@opencode-ai/plugin"
import { runAudit } from "./audit.js"
import { log } from "./log.js"
import {
  ANNOUNCE_AT,
  AUDIT_EVERY,
  BOUNDARY_AT,
  CHEAP_TOOLS,
  CONTEXT_LIMIT,
  CONTEXT_WARN,
  MAX_COST,
  MAX_EFFECTIVE_TOKENS,
  MAX_TOOL_CALLS,
  MODE,
  type BudgetMode,
} from "./config.js"
import { attribution, UsageTracker, type Rollup } from "./usage.js"

interface SessionState {
  calls: number
  announced: boolean
  lastAudit: number
  tools: Map<string, number>
  seenMessages: Set<string>
  pendingBoundary: boolean
  /** A pause plus budget pressure armed a handoff recommendation. */
  pendingHandoff: boolean
  /** Budget metrics whose crossing has already been reported this session. */
  crossed: Set<string>
}

const state = new Map<string, SessionState>()

// One accumulator for all sessions in this process. session-budget keeps its
// own s.calls for the call-count thresholds (announce/audit/boundary); this one
// owns measured cost/tokens/context from step-finish events.
const usage = new UsageTracker()

const HANDOFF_TOOL = "handoff"

// User messages are remembered only long enough to dedupe the repeated
// `message.updated` events that follow one message. A Set preserves insertion
// order, so the oldest entry is the eviction candidate; without a cap the set
// would grow for the life of a long session.
const SEEN_MESSAGES_MAX = 200

function track(sessionID: string, tool: string): SessionState {
  let s = state.get(sessionID)
  if (!s) {
    s = {
      calls: 0,
      announced: false,
      lastAudit: 0,
      tools: new Map(),
      seenMessages: new Set(),
      pendingBoundary: false,
      pendingHandoff: false,
      crossed: new Set(),
    }
    state.set(sessionID, s)
  }
  if (!CHEAP_TOOLS.has(tool)) s.calls++
  s.tools.set(tool, (s.tools.get(tool) ?? 0) + 1)
  return s
}

function topTools(s: SessionState): string {
  return [...s.tools.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([t, n]) => `${t} ${n}`)
    .join(", ")
}

function note(lines: string[]): string {
  return `\n\n<system-reminder>\n${lines.join("\n")}\n</system-reminder>`
}

function fmtCount(n: number): string {
  return `${Math.round(n)}`
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return `${Math.round(n)}`
}

function fmtBytes(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}MB`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}kB`
  return `${Math.round(n)}B`
}

function fmtUsd(n: number): string {
  return `$${n.toFixed(2)}`
}

interface BudgetMetric {
  key: string
  label: string
  used: number
  limit: number
  /** Crossing threshold: the limit for cost/tokens/calls, a fraction of it for context. */
  warnAt: number
  format: (n: number) => string
}

const modelContextLimits = new Map<string, number>()

/** Model window size, cached per provider/model. TOKEN_NORM_CONTEXT_LIMIT wins.
 * When neither the client lookup nor the env var yields a number, context
 * pressure is simply disabled -- never guessed. */
async function contextLimitFor(client: any, sessionID: string): Promise<number | undefined> {
  if (CONTEXT_LIMIT !== undefined) return CONTEXT_LIMIT
  const s = usage.get(sessionID)
  if (!s.providerID || !s.modelID) return undefined
  const key = `${s.providerID}/${s.modelID}`
  const cached = modelContextLimits.get(key)
  if (cached !== undefined) return cached > 0 ? cached : undefined
  try {
    const res = await client?.config?.providers?.()
    const providers = res?.data?.providers ?? res?.providers
    if (!Array.isArray(providers)) return undefined
    const model = providers.find((p: any) => p?.id === s.providerID)?.models?.[s.modelID]
    const limit = typeof model?.limit?.context === "number" ? model.limit.context : 0
    modelContextLimits.set(key, limit)
    return limit > 0 ? limit : undefined
  } catch {
    return undefined
  }
}

function budgetMetrics(sessionID: string, rollup: Rollup, contextLimit: number | undefined): BudgetMetric[] {
  const metrics: BudgetMetric[] = []
  if (MAX_COST !== undefined) {
    metrics.push({ key: "cost", label: "Cost", used: rollup.costUsd, limit: MAX_COST, warnAt: MAX_COST, format: fmtUsd })
  }
  if (MAX_EFFECTIVE_TOKENS !== undefined) {
    metrics.push({
      key: "effective-tokens",
      label: "Effective tokens",
      used: rollup.effectiveTokens,
      limit: MAX_EFFECTIVE_TOKENS,
      warnAt: MAX_EFFECTIVE_TOKENS,
      format: fmtTokens,
    })
  }
  if (MAX_TOOL_CALLS !== undefined) {
    metrics.push({
      key: "tool-calls",
      label: "Tool calls",
      used: rollup.calls,
      limit: MAX_TOOL_CALLS,
      warnAt: MAX_TOOL_CALLS,
      format: fmtCount,
    })
  }
  if (contextLimit !== undefined) {
    // contextNow is this session's own window. It is NOT summable across a
    // parent and its subagents, which each have separate windows.
    const used = usage.get(sessionID).contextNow
    metrics.push({
      key: "context",
      label: "Context now",
      used,
      limit: contextLimit,
      warnAt: contextLimit * CONTEXT_WARN,
      format: fmtTokens,
    })
  }
  return metrics
}

const MODE_ADVICE: Record<BudgetMode, string> = {
  observe: `Observe mode: crossing logged, nothing injected (empirical validation).`,
  warn: `Report this to the user in your next message. If work remains, propose a split with a 3-line handoff.`,
  handoff: `Report this to the user. A handoff skeleton is appended at the next pause (idle or todos complete).`,
  block: `This limit is now enforced: non-cheap tool calls are refused until the session ends or the mode changes.`,
}

function budgetLines(metrics: BudgetMetric[], crossed: string[]): string[] {
  const lines = [`TOKEN NORM -- BUDGET (estimated from provider step-finish events):`]
  for (const m of metrics) {
    const pct = m.limit > 0 ? Math.round((m.used / m.limit) * 100) : 0
    const over = m.used >= m.warnAt ? " -- OVER" : ""
    lines.push(`  ${m.label}: ${m.format(m.used)} / ${m.format(m.limit)} (${pct}%)${over}`)
  }
  lines.push(`Crossed now: ${crossed.join(", ")}.`)
  lines.push(MODE_ADVICE[MODE])
  return lines
}

/** Fires once per crossing per metric; returns lines to inject, or undefined
 * in observe mode (log only) and when nothing new crossed. */
async function evaluateBudget(client: any, sessionID: string, s: SessionState): Promise<string[] | undefined> {
  const limit = await contextLimitFor(client, sessionID)
  const rollup = usage.rollup(usage.rootOf(sessionID))
  const metrics = budgetMetrics(sessionID, rollup, limit)
  const crossed: string[] = []
  for (const m of metrics) {
    if (m.used >= m.warnAt && !s.crossed.has(m.key)) {
      s.crossed.add(m.key)
      crossed.push(m.key)
    }
  }
  if (crossed.length === 0) return undefined
  const detail = metrics
    .filter((m) => crossed.includes(m.key))
    .map((m) => `${m.key} ${m.format(m.used)}/${m.format(m.limit)}`)
    .join(", ")
  log(`${sessionID} budget crossing at ${s.calls} calls: ${detail}`)
  if (MODE === "observe") return undefined
  return budgetLines(metrics, crossed)
}

async function overPressure(client: any, sessionID: string): Promise<boolean> {
  const limit = await contextLimitFor(client, sessionID)
  const rollup = usage.rollup(usage.rootOf(sessionID))
  return budgetMetrics(sessionID, rollup, limit).some((m) => m.used >= m.warnAt)
}

async function blockedReason(client: any, sessionID: string): Promise<string | undefined> {
  const limit = await contextLimitFor(client, sessionID)
  const rollup = usage.rollup(usage.rootOf(sessionID))
  const over = budgetMetrics(sessionID, rollup, limit).filter((m) => m.used >= m.limit)
  if (over.length === 0) return undefined
  return [
    `TOKEN NORM block (mode=block): ${over.map((m) => `${m.label} ${m.format(m.used)} / ${m.format(m.limit)}`).join("; ")}.`,
    `Non-cheap tool calls are refused while over budget. In your next message:`,
    `  1. Report the overage to the user.`,
    `  2. Propose a handoff (the handoff tool stays available) or ask the user to raise the`,
    `     limits / set TOKEN_NORM_MODE=warn and restart the session.`,
  ].join("\n")
}

function handoffLines(sessionID: string): string[] {
  const attr = attribution(usage.get(sessionID))
  const files = usage.editedFiles(sessionID)
  const lines = [
    `TOKEN NORM -- HANDOFF RECOMMENDED (budget/context pressure + a natural pause).`,
    `Do not start new work in this session. In your next message:`,
    `  1. Report the evidence below and propose finishing here.`,
    `  2. Fill the skeleton with real paths/identifiers; done/next must be yours, not invented.`,
    `  3. Call the handoff tool once the user agrees.`,
    ``,
    `Attribution (estimated from output bytes, not tokens):`,
  ]
  if (attr.topTools.length > 0) {
    lines.push(`  - top tools: ${attr.topTools.map((t) => `${t.tool} ${fmtBytes(t.bytes)}`).join(", ")}`)
  }
  if (attr.repeated.length > 0) {
    lines.push(`  - repeated reads: ${attr.repeated.map((r) => `${r.file} x${r.count}`).join(", ")}`)
  }
  if (attr.images > 0) lines.push(`  - image/PDF reads: ${attr.images}`)
  lines.push(`  - budgeted tool calls: ${usage.rollup(usage.rootOf(sessionID)).calls}`)
  if (files.length > 0) {
    const shown = files.slice(0, 10).join(", ")
    lines.push(`Files touched: ${shown}${files.length > 10 ? ` (+${files.length - 10} more)` : ""}`)
  }
  lines.push(``, `Skeleton:`, `Task: <one line>`, `Done: <finished and verified>`, `Next: <exact first action>`)
  return lines
}

function toast(client: any, message: string): void {
  try {
    Promise.resolve(
      client?.tui?.showToast?.({ body: { title: "Token norm", message, variant: "warning" } }),
    ).catch(() => {})
  } catch {
    /* a toast is decoration; never let it break the tool call */
  }
}

/** The two pauses a handoff may ride on: the session went idle, or every todo
 * is complete. The model has stopped, so a recommendation does not interrupt
 * work in flight. */
function pauseSessionID(event: any): string | undefined {
  const id = event?.properties?.sessionID
  if (typeof id !== "string") return undefined
  if (event?.type === "session.idle") return id
  if (event?.type !== "todo.updated") return undefined
  const todos = event.properties?.todos
  const done = Array.isArray(todos) && todos.length > 0 && todos.every((t: any) => t?.status === "completed")
  return done ? id : undefined
}

export const SessionBudgetPlugin: Plugin = async ({ client } = {} as any) => {
  return {
    // A new user message in an already-large session is the task boundary the
    // norm cares about most, and the one with no mechanism until now. In a
    // 195k-token session the agent had the rule in context, ran the audit,
    // reported "77x cache, bloat HIGH" -- and then continued anyway, because a
    // second task ("do all of them") was treated as a continuation of the
    // "do everything" override granted for the first. Overrides are per-task;
    // nothing enforced that. This fires on the NEXT tool call after such a
    // message, which is the earliest point the agent cannot skip past.
    event: async ({ event }) => {
      try {
        usage.handleEvent(event)

        // Handoff mode: a pause plus budget/context pressure is the natural
        // split point. Events cannot append to output, so the recommendation
        // is armed here and injected on the next tool call.
        const pauseID = MODE === "handoff" ? pauseSessionID(event) : undefined
        if (pauseID) {
          const paused = state.get(pauseID)
          if (paused && !paused.pendingHandoff && (await overPressure(client, pauseID))) {
            paused.pendingHandoff = true
            log(`${pauseID} handoff armed (pause + budget pressure)`)
          }
        }

        // Counters are in-memory and keyed by session, so without this a
        // long-lived server would accumulate one entry per session ever
        // opened. The session is gone; keeping its score buys nothing.
        if (event?.type === "session.deleted") {
          state.delete(event.properties.info.id)
          return
        }
        if (event?.type !== "message.updated") return
        const info = event.properties?.info
        if (info?.role !== "user") return
        const s = state.get(info.sessionID)
        if (!s || s.calls < BOUNDARY_AT) return
        // Dedupe on MESSAGE IDENTITY, not on call count.
        //
        // `message.updated` fires many times for the SAME user message (it is
        // an update event: streaming, metadata, revisions). An earlier guard
        // compared `boundaryAt === s.calls`, but `s.calls` increments on every
        // tool call, so it went stale after one tool call and re-armed. One
        // live session fired this reminder 61 times for a single user message
        // -- on nearly every tool call for the rest of the session.
        //
        // That is worse than not firing at all. A warning that repeats on
        // every tool call becomes wallpaper, and the agent learns to skip ALL
        // system-reminders -- including the audit checkpoint, which in that
        // same session was ignored precisely because it arrived buried in the
        // 61st copy of this one. Cry wolf once per wolf.
        if (!info.id || s.seenMessages.has(info.id)) return
        s.seenMessages.add(info.id)
        if (s.seenMessages.size > SEEN_MESSAGES_MAX) {
          const oldest = s.seenMessages.values().next().value
          if (oldest !== undefined) s.seenMessages.delete(oldest)
        }
        s.pendingBoundary = true
        log(`${info.sessionID} task-boundary at ${s.calls} calls (msg ${info.id})`)
      } catch {
        /* a missed boundary must never break the session */
      }
    },

    "tool.execute.after": async (input, output) => {
      let s: SessionState
      try {
        s = track(input.sessionID, input.tool)
      } catch {
        return
      }

      try {
        usage.noteToolCall(input.sessionID, input.tool, input.args, output, !CHEAP_TOOLS.has(input.tool))
      } catch {
        /* measurement must never break a tool call */
      }

      // Threshold 0 -- task boundary. Highest priority: acting on it avoids
      // the spend the other two thresholds only measure after the fact.
      if (s.pendingBoundary) {
        s.pendingBoundary = false
        output.output += note([
          `TOKEN NORM -- new request arrived ${s.calls} tool calls deep. This is a TASK BOUNDARY.`,
          `A prior "do everything" / "don't ask" was scoped to the PREVIOUS task. It does not carry.`,
          `Before continuing, in your next message:`,
          `  1. Say whether this request names new files/subsystems (-> new task, not a continuation).`,
          `  2. If new: propose finishing here with a 3-line handoff (done / state / next),`,
          `     and let the user start it fresh. Cold start = system floor + a few targeted reads.`,
          `  3. If the user re-grants the override, proceed -- but state the cost first.`,
          `Do NOT justify continuing with "finishing here beats reloading cold". That reasoning`,
          `is always available, feels free only because this context is already warm, and is the`,
          `exact rationalization the norm exists to block.`,
        ])
        return
      }

      // Threshold 1 -- the startup reflex, fired late but before the bulk of
      // the spend. The norm wants this BEFORE the work; in practice the agent
      // only discovers the true size once it is underway, so catch it at the
      // first moment the task is provably "big" and force the statement then.
      if (!s.announced && s.calls >= ANNOUNCE_AT) {
        s.announced = true
        log(`${input.sessionID} announce-threshold at ${s.calls} calls (${topTools(s)})`)
        output.output += note([
          `TOKEN NORM -- ${s.calls} tool calls in this session (${topTools(s)}).`,
          `This is now a "big task" under the norm, which required a cost statement BEFORE starting.`,
          `Do this now, in your next message to the user, before more tool calls:`,
          `  1. State remaining expected tool calls and what will drive them.`,
          `  2. State your caps (read windows, smallest test target, no whole-file reads).`,
          `  3. Offer a session split: which part could ship now with a 3-line handoff?`,
          `If the user already said "do everything", the split is overridden -- the cost`,
          `statement and the audit are NOT. Say so explicitly rather than staying silent.`,
        ])
        return
      }

      // Threshold 2 -- the midway audit. Recurring, because the norm's real
      // failure mode is a session that quietly runs 3x past where a split
      // should have happened.
      if (s.calls > 0 && s.calls - s.lastAudit >= AUDIT_EVERY) {
        s.lastAudit = s.calls
        log(`${input.sessionID} audit-threshold at ${s.calls} calls (${topTools(s)})`)
        // Run the audit HERE rather than asking the agent to run it.
        //
        // "Run this command and report the number" is advice, and advice at a
        // checkpoint loses to the task in flight every time: one session was
        // told to audit at call 79, kept working, and produced the number only
        // when the user asked afterwards. The command is cheap, deterministic
        // and read-only, so the plugin runs it and staples the RESULT on. The
        // agent then has the number in hand and no step to defer -- only a
        // fact to report.
        const audit = runAudit(input.sessionID)
        output.output += note([
          `TOKEN NORM -- ${s.calls} tool calls. Audit checkpoint (ran for you):`,
          ``,
          audit,
          ``,
          `In your NEXT message, before continuing the task: report the effective-token`,
          `number and the cache multiplier to the user, and say whether you are splitting.`,
          `If work remains: state/done/next in a NOTES file, then propose a fresh session.`,
        ])
      }

      try {
        const lines = await evaluateBudget(client, input.sessionID, s)
        if (lines) {
          output.output += note(lines)
          toast(client, `Token norm: budget crossed (${s.calls} calls)`)
        }
      } catch {
        /* budget evaluation is advisory; never break the tool call */
      }

      if (s.pendingHandoff) {
        s.pendingHandoff = false
        output.output += note(handoffLines(input.sessionID))
        toast(client, "Token norm: handoff recommended")
      }
    },

    // Block mode is opt-in and the only path that fails a tool call. It is
    // deliberately the last resort: refusing work strands the session, so
    // cheap tools and the handoff tool stay open as the escape hatch.
    "tool.execute.before": async (input) => {
      if (MODE !== "block") return
      if (CHEAP_TOOLS.has(input.tool) || input.tool === HANDOFF_TOOL) return
      let reason: string | undefined
      try {
        reason = await blockedReason(client, input.sessionID)
      } catch {
        return
      }
      if (reason) throw new Error(reason)
    },

    // Compaction is the one moment the agent provably re-reads its own rules.
    // Adding the number matters, because "you are 180 calls deep" is a fact
    // that changes behavior and "be frugal" is not.
    "experimental.session.compacting": async (input, output) => {
      const s = state.get(input.sessionID)
      if (!s) return
      output.context.push(
        `## Session budget at compaction
This session has made ${s.calls} tool calls (${topTools(s)}).
Compaction is itself evidence the session ran too long for one task.
- Run the usage audit and report the effective-token number to the user.
- Put state/done/next in a NOTES file, not in the rebuilt context.
- Propose finishing here with a 3-line handoff and starting the next task fresh.`,
      )
    },
  }
}
