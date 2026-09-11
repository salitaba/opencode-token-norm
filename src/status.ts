// On-demand session accounting, exposed as an agent-callable tool.
//
// The enforcement path in session-budget.ts injects reminders when a threshold
// is crossed; this path answers the same question immediately ("where is this
// session?") without waiting for one. The numbers must come from the same
// accumulators enforcement uses -- usage.rollup for cost/tokens, contextNow for
// the window, budgetMetrics for limits and warn thresholds -- so a status can
// never disagree with the reminder that would have been injected.
//
// session-budget.ts owns those accumulators, so it builds the reader and
// injects it through createStatusTool: importing session-budget.ts back would
// be a cycle, and a module-global registry would let a second plugin instance
// in the same process shadow the first one's reader. With no injected reader,
// an unknown session, or a reader that throws, the result is zeros: a status
// query must never break a session.

import { tool } from "@opencode-ai/plugin"
import type { PolicyState } from "./budget/policy.js"

export type Recommendation = "continue" | "warn" | "handoff" | "block"

export interface StatusMetric {
  used: number
  /** null when no limit is configured -- distinct from a zero/absent limit. */
  limit: number | null
}

export interface StatusSnapshot {
  session: {
    /** The context window is measured on the current session only. */
    scope: "current-session"
    context: number
    contextLimit: number | null
  }
  budget: {
    /** Budgets roll up the session tree: the root plus every descendant. */
    scope: "session-tree"
    toolCalls: number
    cost: StatusMetric
    effectiveTokens: StatusMetric
  }
  /** The policy state this recommendation was derived from, reported verbatim
   * so a caller can see the severity without inferring it from the advice. */
  state: PolicyState
  recommendation: Recommendation
}

/** What the owning plugin measures; snapshotFrom turns it into the wire shape. */
export interface StatusFacts {
  toolCalls: number
  context: number
  contextLimit?: number
  cost: { used: number; limit?: number }
  effectiveTokens: { used: number; limit?: number }
  /** The verdict from the same policy machine that drives enforcement. */
  state: PolicyState
}

export type StatusProvider = (
  sessionID: string,
) => StatusSnapshot | undefined | Promise<StatusSnapshot | undefined>

let provider: StatusProvider | undefined

export function setStatusProvider(fn: StatusProvider | undefined): void {
  provider = fn
}

function metric(used: number, limit: number | undefined): StatusMetric {
  return { used, limit: limit ?? null }
}

/** The policy state translated into the advice the caller asked for.
 *
 * This is a MAP, not a second ladder. It used to be a function that re-derived
 * severity from (pressured, exceeded, mode) -- a fourth copy of the gating
 * rules that drifted from the ones the hook actually enforced, so the tool
 * could answer "continue" on a session that was being warned. The state now
 * arrives already decided; all that is left is naming it. */
const RECOMMENDATION: Record<PolicyState, Recommendation> = {
  HEALTHY: "continue",
  ATTENTION: "warn",
  PRESSURE: "warn",
  HANDOFF_RECOMMENDED: "handoff",
  BLOCKED: "block",
}

export function recommendationFor(state: PolicyState): Recommendation {
  return RECOMMENDATION[state]
}

export function snapshotFrom(facts: StatusFacts): StatusSnapshot {
  return {
    session: {
      scope: "current-session",
      context: facts.context,
      contextLimit: facts.contextLimit ?? null,
    },
    budget: {
      scope: "session-tree",
      toolCalls: facts.toolCalls,
      cost: metric(facts.cost.used, facts.cost.limit),
      effectiveTokens: metric(facts.effectiveTokens.used, facts.effectiveTokens.limit),
    },
    state: facts.state,
    recommendation: recommendationFor(facts.state),
  }
}

export function emptyStatus(): StatusSnapshot {
  return snapshotFrom({
    toolCalls: 0,
    context: 0,
    cost: { used: 0 },
    effectiveTokens: { used: 0 },
    state: "HEALTHY",
  })
}

/** Never throws: an absent provider, unknown session, or failed read reports zeros. */
export async function readStatus(
  provider: StatusProvider | undefined,
  sessionID: string | undefined,
): Promise<StatusSnapshot> {
  if (!provider || typeof sessionID !== "string" || sessionID.length === 0) return emptyStatus()
  try {
    const snapshot = await provider(sessionID)
    return snapshot ?? emptyStatus()
  } catch {
    return emptyStatus()
  }
}

export function renderStatus(snapshot: StatusSnapshot): string {
  return JSON.stringify(snapshot, null, 2)
}

export function createStatusTool(provider?: StatusProvider) {
  return tool({
    description: [
      "Report token-budget accounting as machine-readable JSON. budget",
      "(toolCalls, cost, effectiveTokens) rolls up the whole session tree -- root",
      "plus descendant sessions; session.context is the current session's window",
      "only. Each metric is { used, limit }, limit null when unconfigured.",
      "state is the policy state (HEALTHY, ATTENTION, PRESSURE,",
      "HANDOFF_RECOMMENDED, BLOCKED) and never decreases within a session;",
      "recommendation is continue | warn | handoff | block, derived from it.",
      "",
      "Use before starting a large task, when the user asks what the session has cost,",
      "or to check whether the token-norm plugin would warn, hand off, or block now.",
      "Read-only; unknown sessions report zeros.",
    ].join("\n"),
    args: {},
    async execute(_args, ctx) {
      const snapshot = await readStatus(provider, ctx.sessionID)
      return {
        title: `Token status (${snapshot.recommendation})`,
        output: renderStatus(snapshot),
        metadata: { recommendation: snapshot.recommendation },
      }
    },
  })
}
