# How it works

*The mechanics behind the [README](../README.md). The reasoning — why the
thresholds are where they are, and why the metric is shaped the way it is —
lives in the [design notes](design.md).*

**Before / after:**

```text
Without Token Norm
  Task A ─────────────────────────────┐
  Task B ─────────────────────────────┘   one context, and B inherits
                                          A's stale "do everything"

With Token Norm
  Task A ──→ boundary @40 ──→ audit @60 ──→ handoff ──→ Task B
             stale override    numbers      note         fresh context,
             revoked           in-band      written      pre-filled
```

**The two halves:**

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

**Inside the budget half**, the path from an event to injected text is a
one-way pipeline, and each stage is allowed to know only about the stage above
it:

```text
  OpenCode events                tool.execute.after · message.updated
        │                        session.idle · todo.updated · step-finish
        ▼
  ┌─────────────┐   measurement only: counts, cost, tokens, context window.
  │   usage +   │   Never decides anything. If the window cannot be resolved
  │   state     │   it stays unknown — no default is guessed.
  └─────────────┘
        ▼
  ┌─────────────┐   pure function: numbers in, verdict out. Three axes
  │   policy    │   (calls · budget · context), max across them, then the
  │   machine   │   mode lifts the result. Severity is decided HERE, once.
  └─────────────┘
        ▼
  ┌─────────────┐   ONE block per tool call or none, fixed section order,
  │  rendering  │   one header naming the state and its driver.
  └─────────────┘
        │
   ┌────┼─────────┬──────────┐
   ▼    ▼         ▼          ▼
 observe warn  handoff     block
 (log)  (inject) (+skeleton) (refuse)
        │
        ▼
   tool output the agent is already reading
        ▲
        └── token_norm_status reads the SAME machine, without latching
```

The single-evaluation rule is the point. Before it, eight independent `if`s
each owned a threshold, three could fire on one tool call and staple three
separate reminder blocks onto it, two returned early and silently deferred
another's crossing by a call, and the status tool answered from a fourth
disconnected ladder — so it could say `continue` while the hook was warning.
Adding a threshold now means adding an **axis**, not another `if`.

### One session, call by call

A `handoff`-mode session with `TOKEN_NORM_MAX_COST=5`, on default thresholds:

```text
call 1–24    nothing injected. Counting only.

call 25      ANNOUNCE — calls axis reaches ANNOUNCE_AT.
             state HEALTHY → ATTENTION (peak now ATTENTION).
             Injected: state the remaining calls, the caps in force, and which
             slice could ship now behind a handoff. Once per session.

call 38      user sends a new message ("now do all the others").
             Session is past BOUNDARY_AT? Not yet (38 < 40) — nothing armed.

call 44      user sends another new message. Past BOUNDARY_AT now, so the
             boundary arms, keyed on that message's id.

call 45      BOUNDARY — first tool call after the message.
             Injected: this is a new task; the "do everything" override granted
             for the last one does not carry. Fires once per message, never
             again for that id.

call 60      AUDIT — the plugin runs usage-audit.py itself, read-only, and
             staples the numbers on. The agent has the result in hand; there is
             no command left to defer.

call 71      cost crosses 5.00 USD. Budget axis → PRESSURE, peak → PRESSURE.
             Injected: the crossing, latched so a sustained overage says it
             once rather than on every call afterwards.

call 71+     session goes idle (or every todo completes) → a pause is armed.

call 72      HANDOFF RECOMMENDED — pressure AND an armed pause, in handoff mode.
             Injected: the handoff skeleton. The pause is consumed by this call
             whether or not it fires, so a handoff can never surface mid-task.

             (In block mode instead: the next non-cheap tool call is refused.
             todowrite, question, skill and handoff stay open as the exit.)
```

Nothing in that sequence ever stapled two blocks onto one tool call, and the
agent could have called `token_norm_status` at any point to get the same
severity the hook was about to inject.

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
would give right now. That value reflects the configured enforcement policy —
the action the current mode and budget state would trigger (`block` only in
`block` mode over a hard limit, `handoff` when `handoff` mode sees pressure or
an exceeded limit, `warn` for any other crossing, otherwise `continue`) — not a
semantic judgment that the task should stop being worked on. It reads the same
accumulators the enforcement path uses, so status and reminders cannot
disagree; unknown sessions report zeros. The tool is registered by the budget
plugin, so it is absent when that plugin is not loaded.

### The payload

**This payload is a public interface.** Other tools may read it. Within a major
version: existing fields keep their names, types and meaning; new fields may be
added; a removed field is first kept as a documented alias (see `state`) and only
dropped in a major bump. `null` means "not configured" and never "zero". Two
guarantees a consumer can rely on without reading the source: `peak` is always at
least as severe as `current`, and reading this payload never changes it — status
is free of side effects, so polling it cannot latch a severity or consume a
crossing.

```json
{
  "session": { "scope": "current-session", "context": 8631, "contextLimit": 1000000 },
  "budget": {
    "scope": "session-tree",
    "toolCalls": 58,
    "cost": { "used": 1.42, "limit": 5 },
    "effectiveTokens": { "used": 412000, "limit": null }
  },
  "state": "PRESSURE",
  "policy": { "current": "ATTENTION", "peak": "PRESSURE", "driver": "calls" },
  "recommendation": "warn"
}
```

| Field | Meaning |
|---|---|
| `session.context` | Context tokens in **this** session only — a window is not a tree |
| `session.contextLimit` | The model window, or `null` when it could not be resolved. Never guessed; context pressure is simply not evaluated |
| `budget.*` | Rolls up the **whole session tree**: root plus every descendant (subagents included) |
| `budget.toolCalls` | **Weighted** calls, not raw — see [weighted vs. raw](#weighted-vs-raw-calls) |
| `*.limit` | `null` means unconfigured, which is distinct from a limit of zero |
| `policy.current` | Severity **right now**, recomputed from the axes on every call. It can fall |
| `policy.peak` | Highest severity this session has **ever** reached. Monotone; never falls |
| `policy.driver` | Which axis (`calls`, `budget`, `context`) produced `current` — the number to look at first |
| `state` | Deprecated alias of `policy.peak`, kept for existing readers |
| `recommendation` | `continue \| warn \| handoff \| block`, derived from `peak` |

**`current` vs. `peak` is the distinction to get right.** A session that
crossed the context warn line at call 90, handed the heavy work to a subagent,
and is now writing a summary reports `current: "HEALTHY"` with
`peak: "PRESSURE"`. Both are true and they answer different questions: *is
anything wrong this instant* versus *has this session already paid*. The
`recommendation` follows `peak`, because the money is already spent and advice
that relaxes on one cheap tool call is advice that never lands.

`peak` is monotone on purpose. A metric hovering at 0.799/0.801 of the window
would otherwise re-arm and re-fire every other tool call, and a reminder that
repeats becomes wallpaper — the failure the boundary dedupe exists to prevent.

### Weighted vs. raw calls

The plugin keeps **two** call counts and they are allowed to disagree:

```text
raw calls        →  behavioral checkpoints   (announce @25, boundary @40, audit @60,
                    per session                 and the policy machine's calls axis)

weighted calls   →  budget accounting        (TOKEN_NORM_MAX_TOOL_CALLS,
                    per session tree            and budget.toolCalls in the status payload)
```

So a header reading `calls 37` alongside `budget.toolCalls: 52` is correct, not
a bug: 37 is how long *this conversation* has run, while 52 is what the *whole
tree* has consumed after weighting. They diverge for three reasons — subagent
calls count toward the tree but not this session, `TOKEN_NORM_TOOL_WEIGHTS` /
`TOKEN_NORM_PHASE_WEIGHTS` scale the budget number only, and cheap tools count
toward neither.

Weights deliberately never touch the raw count, so configuring them can never
delay or advance a reminder. See
[configuration](configuration.md#budgets-opt-in-measured) for the syntax.
