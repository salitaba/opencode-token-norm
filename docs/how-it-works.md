# How it works

*The mechanics behind the [README](../README.md). The reasoning — why the
thresholds are where they are, and why the metric is shaped the way it is —
lives in the [design notes](design.md).*

```text
                   OpenCode
                      │
          ┌───────────┴────────────┐
          │                        │
   session-budget             handoff
          │                        │
   tool.execute.after       handoff(...)
   message.updated                │
   session.compacting             ├─ persist note to disk
          │                       ├─ open a fresh session
          ├─ count budgeted calls ├─ pre-fill the prompt
          ├─ boundary / announce  └─ submit it
          ├─ run the audit
          └─ staple a reminder
             onto tool output
                      │
             the agent reads it in-band
```

## 1. Task boundary detection (the missing enforcement)

The expensive failure is not a long task. It is a **new** task inheriting an old
task's context *and* an old task's permission. A second request — *"now do all of
them"* — gets read as a continuation of the `do everything` override granted for
the first. Overrides are per-task; nothing enforced that.

When a new user message arrives in a session already past `BOUNDARY_AT` calls
(default 40), the next tool call carries this:

```text
TOKEN NORM -- new request arrived 47 tool calls deep. This is a TASK BOUNDARY.
A prior "do everything" / "don't ask" was scoped to the PREVIOUS task. It does not carry.
...
Do NOT justify continuing with "finishing here beats reloading cold". That reasoning
is always available, feels free only because this context is already warm, and is the
exact rationalization the norm exists to block.
```

The reminder fires **once per user message**, keyed on message identity — a build
that keyed on call count once fired it 61 times in one session. Why that is worse
than silence, and why "finishing here beats reloading cold" is the exact sentence
the reminder exists to block:
[the design notes](design.md#task-boundary-detection).

## 2. Cost statement at 25 calls — **once per session**

At 25 calls — the first moment the task is provably big — the plugin demands the
cost statement: remaining calls, the caps now in effect, and which slice could
ship immediately behind a handoff. Once per session: the statement exists to
change the plan, and the plan only changes once.
([Why 25](design.md#why-25-and-why-once-per-session).)

## 3. Audit checkpoint every 60 calls — **already run**

The plugin runs the audit itself — cheap, deterministic, read-only against
OpenCode's sqlite DB — and staples the result to output the agent is already
reading:

```text
TOKEN NORM -- 60 tool calls. Audit checkpoint (ran for you):

totals  : input 23k  output 15k  cache_read 891k  cache_write 87k
effective fresh tokens: 221k   (cost-weighted input: input + 0.1·cache_read + 1.25·cache_write)   cost $0.89
calls   : 22   context/call min 23k med 49k max 61k
cacheR  : per-call med 45k  (first-call total 23k = system floor)
cache   : 23x cache read ÷ (input+output) — bloat driver ok

In your NEXT message, before continuing the task: report the effective-token
number and the cache multiplier to the user, and say whether you are splitting.
```

No step left to defer — only a fact to report. What `effective fresh tokens`
measures, and why it is not a dollar amount:
[the metric](design.md#the-effective-fresh-metric).
(`calls` in the audit counts model turns; the 60 in the header counts tool calls.)

## 4. Compaction context

Compaction is the one moment an agent provably re-reads its own rules, so the
plugin injects the call count into it. *"You are 180 calls deep"* changes
behavior. *"Be frugal"* does not.

## 5. The `handoff` tool

The norm says split at phase boundaries. It rarely happens: splitting means
leaving the TUI, opening a session, and re-typing context by hand — three manual
steps at the exact moment the warm session feels cheapest to continue.
([Why friction wins](design.md#handoff-design-decisions).)

One tool call instead:

```js
handoff({
  task:  "Fix token expiry off-by-one in auth middleware",
  done:  "Diagnosed: TokenValidator.isExpired() at /repo/src/auth/token.ts:88 uses < not <=",
  next:  "Change the comparison, add a boundary test at exactly expiresAt",
  files: ["/repo/src/auth/token.ts:88", "/repo/src/auth/__tests__/token.test.ts"],
})
```

The plugin writes the note to disk, opens a new TUI session, pre-fills its
prompt, and submits it — the fresh session starts immediately.

The note is persisted before the TUI switch (a failed switch must not lose it),
auto-submitted by default (`submit: false` stops at the pre-filled prompt),
refused for subagents, and the tool result ends with an explicit STOP so the
agent doesn't keep spending in the session it just closed. The rest of the
design decisions, and why subagents are refused, are in
[the design notes](design.md#handoff-design-decisions).

## 6. On-demand status

`token_norm_status` answers the same accounting on demand instead of at a
threshold: read-only JSON with tool calls, context, cost and effective-token
usage, plus the `continue | warn | handoff | block` recommendation the plugin
would give right now. Scopes are explicit in the payload: `budget` figures
(`toolCalls`, `cost`, `effectiveTokens`) roll up the whole session tree (root
plus descendants), while `session.context` is the current session's window
alone. It reads the same accumulators the enforcement path uses, so status and
reminders cannot disagree; unknown sessions report zeros. The tool is registered
by the budget plugin, so it is absent when that plugin is not loaded.
