// Process-local bookkeeping for the session-budget plugin.
//
// One SessionState per session plus one UsageTracker for the whole process.
// Both are in-memory only: a restarted server starts from zero, and deleting a
// session evicts only its activity entry (the usage ledger is separate).

import { CHEAP_TOOLS, weightOf } from "../config.js"
import { UsageTracker } from "../usage.js"
import type { PolicyState } from "./policy.js"

export interface SessionState {
  calls: number
  weightedCalls: number
  announced: boolean
  lastAudit: number
  tools: Map<string, number>
  seenMessages: Set<string>
  pendingBoundary: boolean
  /** A pause was observed; handoff mode turns it into a recommendation once
   * the session is also under pressure. */
  pendingHandoff: boolean
  /** Budget metrics whose crossing has already been reported this session. */
  crossed: Set<string>
  /** Highest severity this session has ever reached.
   *
   * MONOTONE BY CONSTRUCTION: only ever assigned via max(). A session that
   * recovers below a threshold does not walk back down, because the reminder
   * for a crossing has already been injected and re-arming it would let a
   * metric hovering at 0.799/0.801 of the context window re-fire on every
   * other tool call. Severity here means "how bad has this gotten", not "how
   * bad is it this instant" -- the instantaneous read is the axis states,
   * recomputed fresh on every call. */
  level: PolicyState
  /** Per-axis severity from the last evaluation, kept so the rendered header
   * can name the driver without recomputing. */
  axisLevels: Record<string, PolicyState>
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
      weightedCalls: 0,
      announced: false,
      lastAudit: 0,
      tools: new Map(),
      seenMessages: new Set(),
      pendingBoundary: false,
      pendingHandoff: false,
      crossed: new Set(),
      level: "HEALTHY",
      axisLevels: {},
    }
    state.set(sessionID, s)
  }
  if (!CHEAP_TOOLS.has(tool)) {
    s.calls++
    s.weightedCalls += weightOf(tool, usage.get(sessionID).mode)
  }
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
