// Budget measurement and threshold evaluation.

import {
  CONTEXT_LIMIT,
  CONTEXT_WARN,
  MAX_COST,
  MAX_EFFECTIVE_TOKENS,
  MAX_TOOL_CALLS,
  MODE,
  type BudgetMode,
} from "../config.js"
import type { BudgetClient } from "../host.js"
import { log } from "../log.js"
import type { Rollup } from "../usage.js"
import { fmtCount, fmtTokens, fmtUsd } from "./format.js"
import { usage, type SessionState } from "./state.js"

export interface BudgetMetric {
  key: string
  label: string
  used: number
  limit: number
  /** Crossing threshold: the limit for cost/tokens/calls, a fraction of it for context. */
  warnAt: number
  format: (n: number) => string
}

const modelContextLimits = new Map<string, number>()

/** Model window size, cached per provider/model for the lifetime of the
 * process. Provider config changes (edited model limits, re-registered models)
 * are not picked up until opencode restarts; TOKEN_NORM_CONTEXT_LIMIT bypasses
 * the cache entirely. When neither the client lookup nor the env var yields a
 * number, context pressure is simply disabled -- never guessed. */
export async function contextLimitFor(
  client: BudgetClient | undefined,
  sessionID: string,
): Promise<number | undefined> {
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
    const model = providers.find((p) => p?.id === s.providerID)?.models?.[s.modelID]
    const limit = typeof model?.limit?.context === "number" ? model.limit.context : 0
    modelContextLimits.set(key, limit)
    return limit > 0 ? limit : undefined
  } catch {
    return undefined
  }
}

export function budgetMetrics(sessionID: string, rollup: Rollup, contextLimit: number | undefined): BudgetMetric[] {
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
export async function evaluateBudget(
  client: BudgetClient | undefined,
  sessionID: string,
  s: SessionState,
): Promise<string[] | undefined> {
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

export async function overPressure(client: BudgetClient | undefined, sessionID: string): Promise<boolean> {
  const limit = await contextLimitFor(client, sessionID)
  const rollup = usage.rollup(usage.rootOf(sessionID))
  return budgetMetrics(sessionID, rollup, limit).some((m) => m.used >= m.warnAt)
}

export async function blockedReason(
  client: BudgetClient | undefined,
  sessionID: string,
): Promise<string | undefined> {
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
