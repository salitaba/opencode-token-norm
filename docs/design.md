# Design notes

*Why `opencode-token-norm` works the way it does. The [README](../README.md)
shows the behavior; this is the reasoning behind the thresholds, the boundaries,
and the metric. Claims trace back to one real session — the 184-call,
3.0M-token one in the [post-mortem](post-mortem.md).*

## The thesis: advice vs. enforcement

Every rule in a token norm is already in the agent's context. The gap is not
knowledge. The gap is mechanism.

"Cap bash output" never fails, because a plugin rewrites the command and nobody
has to remember. The two rules with no mechanism — keep a budget, split at phase
boundaries — are the two that break. Writing them better does not fix that: the
rules that hold are the ones that do not depend on the agent choosing to follow
them.

So this plugin does not rely on agent-authored advice as its enforcement
mechanism. It **counts**, and at thresholds it staples generated instructions
onto tool output the agent cannot skip past. It cannot make the agent obey. It
can put the rule directly in the agent's execution path, and that turns out to
be most of the gap.

The expensive failure it targets is not a long task. It is a **new** task
inheriting an old task's context *and* an old task's permission. Dashboards and
statuslines report that after the session ends, when the money is gone; the
plugin interrupts the agent while the spend is still avoidable.

For the rule-by-rule version of this argument, see
[advice-vs-enforcement.md](advice-vs-enforcement.md).

## Task boundary detection

The scene from the post-mortem, mechanically: a session 195k tokens deep, with
the norm in context the whole time, ran the audit and reported *"77x cache, bloat
HIGH"* — then kept going. The reason was not laziness. A second request (*"now do
all of them"*) was read as a continuation of the `do everything` override
granted for the first task. Overrides are per-task; nothing enforced that.

So `TOKEN_NORM_BOUNDARY_AT` (default 40) exists: once a session is past it, a new
user message marks a boundary, and the next tool call carries a reminder that
explicitly revokes the stale override.

Its last paragraph is the load-bearing one:

> Do NOT justify continuing with "finishing here beats reloading cold". That
> reasoning is always available, feels free only because this context is already
> warm, and is the exact rationalization the norm exists to block.

Every agent talks itself past a split with some version of that sentence.

### Dedupe on message identity, not call count

The reminder fires **once per user message**, keyed on message identity. This is
not a detail.

`message.updated` fires many times for the same message. An early build keyed
the dedupe on call count instead, which went stale after one tool call and
re-armed: 61 copies of the warning in a single session. That is worse than
silence. A warning on every tool call becomes wallpaper, and the agent learns to
skip *every* system-reminder, audit included. Cry wolf once per wolf.

## Why 25, and why once per session

The norm wants the cost statement **before** a big task starts. The agent cannot
give one then; it does not know the size yet. So the plugin waits for the first
moment the task is provably big — `TOKEN_NORM_ANNOUNCE_AT` counted calls — and
demands the statement there: calls remaining and what will drive them, the caps
now in effect, and which slice could ship immediately behind a handoff.

Once per session, not once per threshold. The statement exists to change the
plan, and the plan only changes once.

## Why the audit is run for the agent

"Run this command and report the number" is advice, and advice at a checkpoint
loses to the task in flight every time. One session was told to audit at call 79,
kept working, and produced the number only when the user thought to ask — long
after the spend it was meant to prevent. Compliance without action reads like
success in a transcript and costs the same as silence.

So the plugin runs the audit itself every `TOKEN_NORM_AUDIT_EVERY` calls. The
command is cheap, deterministic, and opens OpenCode's sqlite DB read-only. The
result arrives stapled to output the agent is already reading, leaving it a fact
to report rather than a step to defer.

The checkpoint is synchronous (`execFileSync`, 20s timeout), so a slow database
can briefly stall OpenCode's event loop at the checkpoint. That is a deliberate
trade: in exchange, the numbers are attached to the tool output the agent is
already reading — no second step to defer and no ordering gap between the
checkpoint and the number. The timeout and read-only access keep the worst case
bounded.

Tool calls are what get counted, because tool calls are what spend context.
`todowrite`, `question`, and `skill` are exempt: planning and asking usually
*save* calls. Reads and greps do count, because context is the thing you are
paying for.

## The effective-fresh metric

The audit's headline number is not raw input tokens:

```text
effective fresh tokens = input + 0.1·cache_read + 1.25·cache_write
```

It is a **cost-weighted normalized input**. Providers bill cache reads at roughly
a tenth of fresh input and cache writes at about 1.25x — the multipliers here
follow Anthropic's list; other providers are similar. Weighting the three classes
makes sessions comparable. Raw `cache_read` does not, which is why a session can
look enormous and cost little, or look modest and not. The multipliers are the
one number here that would need revisiting if provider pricing shifts.

It is a heuristic, not a dollar amount. Actual spend is `cost_usd` on the session
row, which the audit reports when OpenCode has one; some gateways report `0`, and
there the weighted figure is the only signal available. That is why "cost" is
reserved for the provider's number, and the effective figure is described as
weighted input rather than "the money number."

## Handoff design decisions

- **Auto-submitted by default.** The handoff starts the fresh session with no
  user action, which is the point of making the split frictionless. Pass
  `submit: false` to stop at the pre-filled prompt when you want a beat to
  redirect before any tokens burn.
- **The switch waits for evidence, not just a delay.** `session_new` returns once
  dispatched, and the V1 API has no TUI readiness signal (every TUI endpoint
  returns only a boolean). The append therefore waits for the `session.created`
  event for a parentless session, with the old fixed delay as a floor and
  `TOKEN_NORM_SWITCH_WAIT_MS` as the ceiling. Fast machines behave as before; a
  slow switch waits for proof instead of guessing. A late `session.created` from
  a switch that already timed out is rejected by creation time, so it cannot
  satisfy a later handoff's wait.
- **Persisted before the TUI switch.** If the switch fails, the note is already
  on disk. The reverse ordering loses it on precisely the failure that matters.
- **Refused for subagents.** Plugin tools register for every agent, so a subagent
  could otherwise hijack your screen mid-task to split work you never asked to
  split. Subagent status is resolved from the live agent list, so agents you add
  later classify correctly without touching this plugin. If that lookup fails it
  allows the call — a false block would strand the primary agent with no way out.
- **Structured args, not a freeform summary.** `task`/`done`/`next`/`files`/`notes`
  force real paths and verified identifiers into the note. The next session cannot
  see your scrollback, and a vague handoff makes it re-derive everything you just
  paid for.
- **The tool result says STOP.** It closes with an instruction not to continue,
  not to make further tool calls, and not to summarize beyond one line. Without
  it the agent helpfully keeps working in the session it just declared over —
  spending the exact context the handoff existed to discard.

## Session state and process boundaries

Call counts live in a `Map<sessionID, SessionState>` inside the plugin process.
That was chosen deliberately, and it defines the contract:

- **The map follows the plugin process, not the OpenCode session.** OpenCode
  persists sessions in its own database, so a session can outlive a server
  restart while the counters reset to zero. The guardrails then fail *silent* —
  they undercount, and never re-fire for spend already made — until fresh calls
  cross the thresholds again. That is the preferred failure direction:
  re-deriving counts from the database would staple a boundary reminder onto a
  session that already paid, every time OpenCode restarts.
- **Nothing is persisted.** The audit reads OpenCode's database; only the
  counters are in memory. There is no state file to corrupt and no schema to
  migrate, and `handoff` plus the manual audit keep working across restarts.
- **Live state is in memory; spend is a ledger.** Call counts reset when the
  plugin process restarts, and `session.deleted` frees a session's context,
  deltas and attribution detail. What deletion must not do is un-spend: a
  deleted session retires to a totals-only entry (cost/tokens/calls plus the
  parent link), so the root rollup — and `block` enforcement — keep counting
  money that was actually spent, including through still-live grandchildren.
  Late events for a deleted id are ignored, never re-counted.
- **Tombstones are the accepted cost of that ledger.** A long-lived server
  keeps one small totals entry per deleted session instead of full per-session
  state. Persisting the ledger is deliberately out of scope until budget
  enforcement needs to survive process restarts.

## What it is not

- **Not hard enforcement by default.** Outside opt-in `block` mode it never
  blocks a tool call, edits arguments, or fails one. It changes what the agent
  cannot miss, not what it can do. A determined agent can ignore every
  reminder; the fallback is the human reading the receipt.
- **Not a cost dashboard.** It enforces during the session; reporting is a side
  effect.
- **Not a replacement for the norm in `AGENTS.md`.** The text still defines what
  "on budget" means; the plugin enforces the parts a counter can see.
- **Not prompt engineering with extra steps.** The reminder is not a
  better-worded instruction; it is a different delivery mechanism attached to
  tool output.
