// Process-local bookkeeping for the session-budget plugin.
//
// One SessionState per session plus one UsageTracker for the whole process.
// Both are in-memory only: a restarted server starts from zero, and deleting a
// session evicts only its activity entry (the usage ledger is separate).

import { CHEAP_TOOLS } from "../config.js"
import { UsageTracker } from "../usage.js"

export interface SessionState {
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

export const state = new Map<string, SessionState>()

// One accumulator for all sessions in this process. session-budget keeps its
// own s.calls for the call-count thresholds (announce/audit/boundary); this one
// owns measured cost/tokens/context from step-finish events.
export const usage = new UsageTracker()

// User messages are remembered only long enough to dedupe the repeated
// `message.updated` events that follow one message. A Set preserves insertion
// order, so the oldest entry is the eviction candidate; without a cap the set
// would grow for the life of a long session.
export const SEEN_MESSAGES_MAX = 200

export function track(sessionID: string, tool: string): SessionState {
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

export function topTools(s: SessionState): string {
  return [...s.tools.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([t, n]) => `${t} ${n}`)
    .join(", ")
}
