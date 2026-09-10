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
// So this plugin does not rely on agent-authored advice as its enforcement
// mechanism. It counts, and at thresholds it staples a notice onto tool output
// the agent is already reading. An instruction the agent cannot skip past beats
// an instruction it merely has.
//
// It never edits args and, outside opt-in `block` mode, never fails a tool
// call: a wrong guess here must cost a few lines of text, not a broken session.

import type { Plugin } from "@opencode-ai/plugin"
import { runAudit } from "../audit.js"
import { log } from "../log.js"
import { ANNOUNCE_AT, AUDIT_EVERY, BOUNDARY_AT, CHEAP_TOOLS, MAX_COST, MAX_EFFECTIVE_TOKENS, MODE } from "../config.js"
import { blockedReason, budgetMetrics, contextLimitFor, evaluateBudget, overPressure } from "./evaluator.js"
import { note } from "./format.js"
import {
  announceReminder,
  auditReminder,
  boundaryReminder,
  compactionContext,
  handoffLines,
} from "./reminders.js"
import { SEEN_MESSAGES_MAX, state, topTools, track, usage, type SessionState } from "./state.js"
import { createStatusTool, snapshotFrom, type StatusProvider } from "../status.js"

const HANDOFF_TOOL = "handoff"

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
  // The status tool must answer from the same accumulators that enforce the
  // budget, so the closure that owns `state` and `usage` is injected into the
  // tool factory. A module-global reader would let a second plugin instance in
  // the same process shadow this one; injection keeps the binding per instance.
  const statusProvider: StatusProvider = async (sessionID) => {
    const contextLimit = await contextLimitFor(client, sessionID)
    const rollup = usage.rollup(usage.rootOf(sessionID))
    const metrics = budgetMetrics(sessionID, rollup, contextLimit)
    return snapshotFrom({
      toolCalls: rollup.calls,
      context: usage.has(sessionID) ? usage.get(sessionID).contextNow : 0,
      contextLimit,
      cost: { used: rollup.costUsd, limit: MAX_COST },
      effectiveTokens: { used: rollup.effectiveTokens, limit: MAX_EFFECTIVE_TOKENS },
      pressured: metrics.some((m) => m.used >= m.warnAt),
      exceeded: metrics.some((m) => m.used >= m.limit),
      mode: MODE,
    })
  }

  return {
    // On-demand accounting for exactly the numbers the thresholds below use.
    // Read-only, no args, and a no-op (zeros) for unknown sessions.
    tool: {
      token_norm_status: createStatusTool(statusProvider),
    },

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
        output.output += note(boundaryReminder(s.calls))
        return
      }

      // Threshold 1 -- the startup reflex, fired late but before the bulk of
      // the spend. The norm wants this BEFORE the work; in practice the agent
      // only discovers the true size once it is underway, so catch it at the
      // first moment the task is provably "big" and force the statement then.
      if (!s.announced && s.calls >= ANNOUNCE_AT) {
        s.announced = true
        log(`${input.sessionID} announce-threshold at ${s.calls} calls (${topTools(s)})`)
        output.output += note(announceReminder(s.calls, topTools(s)))
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
        output.output += note(auditReminder(s.calls, audit))
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
      output.context.push(compactionContext(s.calls, topTools(s)))
    },
  }
}
