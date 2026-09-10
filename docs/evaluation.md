# Does it work? Evaluation notes

*What the plugin's own logs and one user's local OpenCode database can and cannot
show. All queries are read-only; no session content, titles, or file paths are
published here.*

## Method

- **Sources.** `session-budget.log` (threshold firings), `handoff/*.md` note
  filenames (UTC timestamp + session id), and the `session` table of the local
  OpenCode database (token totals and timestamps).
- **Window.** 2026-09-08T18:52Z (first threshold firing) through 2026-09-10.
- **Cohorts** for the before/after comparison split at that cutoff.
- **Design.** No randomization, no control group, a single user. Treat everything
  below as operational telemetry, not an experiment.

## Mechanism activation

| Signal | Count |
|---|---|
| Sessions in the threshold log | 205 |
| Cost-statement reminders (25 calls) | 227 |
| Audit checkpoints (60 calls) | 69 |
| Task-boundary reminders | 583 |
| `handoff` notes written | 74 |

The 227 announcements across 205 sessions are the restart behavior from
[the design notes](design.md#session-state-and-process-boundaries) showing up in
practice: when OpenCode restarts mid-session, the in-memory count resets and the
announcement can fire once more. Once, not per call — the dedupe on message
identity held across 583 boundary events.

## Does `handoff` end the old session?

71 of 74 notes matched a live session in the database. For each, we measured the
time between the note's UTC timestamp and that session's last update.

| Outcome | Sessions |
|---|---|
| Stopped within 5 minutes | 64 / 71 (90%) |
| Kept going 5–60 minutes | 7 / 71 |
| Continued past 60 minutes | 0 / 71 |

Median time to last update: **~4 seconds**. The STOP paragraph in the tool result
is not decoration — the old session ends, and the work continues in the
pre-filled fresh session.

## Before / after tokens: inconclusive

The same window gives this comparison, using `effective fresh tokens` (see
[the metric](design.md#the-effective-fresh-metric)):

| Cohort | Sessions | Median effective | P75 | Median duration |
|---|---|---|---|---|
| Before, all | 1,869 | 98k | 215k | 4 min |
| After, all | 451 | 77k | 233k | 1 min |
| Before, primary agents only | 406 | 216k | 1.0M | 21 min |
| After, primary agents only | 179 | 322k | 687k | 15 min |

The medians flip direction depending on whether subagent sessions are included.
The "after" window is also dominated by developing this plugin: long
implementation sessions on a single codebase, unlike the mixed work before it.

**We make no causal claim.** This data neither supports nor refutes the idea that
the guardrails reduce spend. Answering that needs a different design, roughly:

- a fixed task list, run before and after (or alternating), so task mix is held
  roughly constant;
- primary-agent sessions only, with per-task normalization, not per-session;
- enough tasks that medians are not a coin flip (20 is a floor, not a target);
- the same model and provider across both arms.

Until then, the defensible claims are the mechanical ones: the reminders fire, and
`handoff` ends the session it was called from.
