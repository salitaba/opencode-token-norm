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
// It never blocks, never edits args, never fails a tool call: a wrong guess
// here must cost a few lines of text, not a broken session.

import type { Plugin } from "@opencode-ai/plugin"
import { runAudit } from "./audit.js"
import { log } from "./log.js"
import { ANNOUNCE_AT, AUDIT_EVERY, BOUNDARY_AT, CHEAP_TOOLS } from "./config.js"

interface SessionState {
  calls: number
  announced: boolean
  lastAudit: number
  tools: Map<string, number>
  seenMessages: Set<string>
  pendingBoundary: boolean
}

const state = new Map<string, SessionState>()

function track(sessionID: string, tool: string): SessionState {
  let s = state.get(sessionID)
  if (!s) {
    s = { calls: 0, announced: false, lastAudit: 0, tools: new Map(), seenMessages: new Set(), pendingBoundary: false }
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

export const SessionBudgetPlugin: Plugin = async () => {
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
