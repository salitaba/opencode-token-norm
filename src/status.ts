// On-demand session accounting, exposed as an agent-callable tool.
//
// The enforcement path in session-budget.ts injects reminders when a threshold
// is crossed; this path answers the same question immediately ("where is this
// session?") without waiting for one. The numbers must come from the same
// accumulators enforcement uses -- usage.rollup for cost/tokens, contextNow for
// the window, budgetMetrics for limits and warn thresholds -- so a status can
// never disagree with the reminder that would have been injected.
//
// session-budget.ts owns those accumulators, so it registers a reader here at
// plugin construction. status.ts importing session-budget.ts back would be a
// cycle; the module-level registry avoids it. With no registered reader, an
// unknown session, or a reader that throws, the result is zeros: a status
// query must never break a session.

import { tool } from "@opencode-ai/plugin"
import type { BudgetMode } from "./config.js"

export type Recommendation = "continue" | "warn" | "handoff" | "block"

export interface StatusMetric {
  used: number
  /** null when no limit is configured -- distinct from a zero/absent limit. */
  limit: number | null
}

export interface StatusSnapshot {
  session: {
    toolCalls: number
    context: number
    contextLimit: number | null
  }
  budget: {
    cost: StatusMetric
    effectiveTokens: StatusMetric
  }
  recommendation: Recommendation
}

/** What the owning plugin measures; snapshotFrom turns it into the wire shape. */
export interface StatusFacts {
  toolCalls: number
  context: number
  contextLimit?: number
  cost: { used: number; limit?: number }
  effectiveTokens: { used: number; limit?: number }
  /** A tracked metric is at/over its warn threshold, i.e. budgetMetrics.warnAt. */
  pressured: boolean
  /** A tracked metric is at/over its hard limit, i.e. what blockedReason refuses on. */
  exceeded: boolean
  mode: BudgetMode
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

/** The strongest action the plugin would take right now, mirroring its own
 * gates: block only in block mode over a hard limit, handoff only when handoff
 * mode is under pressure, warn for any other crossing. */
export function recommend(facts: Pick<StatusFacts, "pressured" | "exceeded" | "mode">): Recommendation {
  if (facts.exceeded) {
    if (facts.mode === "block") return "block"
    if (facts.mode === "handoff") return "handoff"
    return "warn"
  }
  if (facts.pressured && facts.mode === "handoff") return "handoff"
  return facts.pressured ? "warn" : "continue"
}

export function snapshotFrom(facts: StatusFacts): StatusSnapshot {
  return {
    session: {
      toolCalls: facts.toolCalls,
      context: facts.context,
      contextLimit: facts.contextLimit ?? null,
    },
    budget: {
      cost: metric(facts.cost.used, facts.cost.limit),
      effectiveTokens: metric(facts.effectiveTokens.used, facts.effectiveTokens.limit),
    },
    recommendation: recommend(facts),
  }
}

export function emptyStatus(): StatusSnapshot {
  return snapshotFrom({
    toolCalls: 0,
    context: 0,
    cost: { used: 0 },
    effectiveTokens: { used: 0 },
    pressured: false,
    exceeded: false,
    mode: "warn",
  })
}

/** Never throws: a failed or unknown read reports zeros. */
export async function readStatus(sessionID: string | undefined): Promise<StatusSnapshot> {
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

export function createStatusTool() {
  return tool({
    description: [
      "Report this session's token-budget accounting as machine-readable JSON:",
      "session.toolCalls, session.context, session.contextLimit, budget.cost and",
      "budget.effectiveTokens (each { used, limit }, limit null when unconfigured),",
      "and recommendation (continue | warn | handoff | block).",
      "",
      "Use before starting a large task, when the user asks what the session has cost,",
      "or to check whether the token-norm plugin would warn, hand off, or block now.",
      "Read-only; unknown sessions report zeros.",
    ].join("\n"),
    args: {},
    async execute(_args, ctx) {
      const snapshot = await readStatus(ctx.sessionID)
      return {
        title: `Token status (${snapshot.recommendation})`,
        output: renderStatus(snapshot),
        metadata: { recommendation: snapshot.recommendation },
      }
    },
  })
}
