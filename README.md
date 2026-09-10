# opencode-token-norm

[![npm version](https://img.shields.io/npm/v/opencode-token-norm)](https://www.npmjs.com/package/opencode-token-norm)
[![npm downloads](https://img.shields.io/npm/dm/opencode-token-norm)](https://www.npmjs.com/package/opencode-token-norm)
[![license](https://img.shields.io/npm/l/opencode-token-norm)](https://github.com/salitaba/opencode-token-norm/blob/main/LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/salitaba/opencode-token-norm?style=social)](https://github.com/salitaba/opencode-token-norm)
[![GitHub release](https://img.shields.io/github/v/release/salitaba/opencode-token-norm)](https://github.com/salitaba/opencode-token-norm/releases/latest)
[![release workflow](https://github.com/salitaba/opencode-token-norm/actions/workflows/release.yml/badge.svg)](https://github.com/salitaba/opencode-token-norm/actions/workflows/release.yml)
[![test](https://github.com/salitaba/opencode-token-norm/actions/workflows/test.yml/badge.svg)](https://github.com/salitaba/opencode-token-norm/actions/workflows/test.yml)

**Your token rules are advice. This makes them mechanical.**

![token-norm demo: the agent gets counted, audited, and handed off](https://raw.githubusercontent.com/salitaba/opencode-token-norm/main/docs/assets/token-norm-demo.gif)

*Demo (18s at 2x): the plugin counts calls and staples the audit onto tool output, then the agent calls `handoff` and lands in a fresh session with the note pre-filled. [Full-speed MP4](https://raw.githubusercontent.com/salitaba/opencode-token-norm/main/docs/assets/token-norm-demo.mp4).*

**Observed on real sessions:** 74 `handoff` calls; **90%** ended the old session
within 5 minutes. ([how that was measured](https://github.com/salitaba/opencode-token-norm/blob/main/docs/evaluation.md))

An [OpenCode](https://opencode.ai) plugin that counts budgeted tool calls,
staples reminders onto the output it is already reading, runs the token audit on
its behalf, and collapses the session split into one tool call.

## What it does

- **Counts budgeted tool calls and marks task boundaries.** Past `BOUNDARY_AT` calls
  (default 40), a new user message revokes any stale "do everything" override —
  the failure no dashboard can see.
- **Demands the cost statement at 25 calls**, once per session, at the first
  moment the task is provably big.
- **Runs the usage audit itself every 60 calls** and staples the numbers to tool
  output, so auditing is a fact to report rather than a step to defer.
- **Ships a `handoff` tool** that persists a structured note, opens a fresh
  session, and pre-fills the prompt in one call.

The enforcement is behavioral: it puts the rule directly in the agent's execution
path. Every threshold is logged, configurable, and independently disableable.

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

## Install

```sh
npx opencode-token-norm
```

Restart OpenCode. That is the whole install — the command copies a self-contained
build into `~/.config/opencode/plugins/` and the audit script into
`~/.config/opencode/scripts/`. Uninstall with `npx opencode-token-norm uninstall`.

It installs as a local plugin file rather than an npm plugin entry because
OpenCode builds ≥ 1.17 can silently never initialize npm-spec plugins
([#48379](https://github.com/anomalyco/opencode/issues/48379)); once that is
fixed, `opencode plugin opencode-token-norm --global` is equivalent.

Requires Node ≥ 22 and an OpenCode build with plugin support. `python3` is only
used for the audit checkpoint; without it nothing breaks — the reminder still
fires and tells the agent to run the audit itself.

| Component | Supported |
|---|---|
| OpenCode | V1 plugin API (`@opencode-ai/plugin` 1.x). Built against 1.18.x, requires ≥ 1.15.12. The V2 plugin API is not targeted yet |
| Node | ≥ 22 (CI tests 22) |
| Python | 3.x, optional — audit checkpoint only |
| OS | Linux, macOS, Windows (CI) |

Per-build verification results live in [docs/compatibility.md](docs/compatibility.md).
The unit suite mocks the OpenCode runtime, so that table is the real-world
evidence behind these claims.

**Check it loaded.** Nothing surfaces until call 25, so a silent install looks
like a working one. Thresholds are logged; an empty log after a short session
means nothing crossed one, not that the plugin is missing:

```console
$ tail ~/.local/share/opencode/token-norm.log
2026-09-10T11:47:02.913Z ses_f75afcd6 announce-threshold at 25 calls (bash 14, read 9, grep 4)
```

**If it doesn't work.** In order of likelihood:

- `sh: opencode-token-norm: not found` — you ran `npx` from inside a clone of
  this repo; npm resolves the local package name instead of downloading it. Run
  the command from any other directory.
- `npx` unavailable, or the registry is blocked — `npm i -g opencode-token-norm`
  then run `opencode-token-norm`, or `npm i opencode-token-norm` in a project and
  run `npx opencode-token-norm` from there.
- Nothing appears after a restart — confirm
  `~/.config/opencode/plugins/opencode-token-norm.js` exists, then work through
  the [smoke test](docs/smoke-test.md). If `opencode.json` still lists
  `opencode-token-norm` under `plugin`, remove that entry — a future fixed
  runtime would otherwise load it twice.
- Developing on the plugin itself? After `npm run build`,
  `npm run install:local` rebuilds the bundle and reinstalls it.

**Turning it off needs no uninstall.** `TOKEN_NORM_BUDGET=0` disables the
counting half; `TOKEN_NORM_HANDOFF=0` drops the `handoff` tool. Restart to apply.

## Why add Token Norm?

| Capability | Statusline / dashboard | Token rule in `AGENTS.md` | token-norm |
|---|---|---|---|
| Who reads it | you, at the edge of the screen | the model, as one more instruction | the model, stapled to output it is already reading |
| When it fires | live, but outside the agent's context | only if the agent chooses to reread it | at 25 / 40 / 60 calls, in-band |
| Audit checkpoint | you run it, or you don't | "run the audit periodically" | already run — read-only, every 60 calls |
| Stale "do everything" overrides | invisible | nothing revokes them | a new task past 40 calls expires them |
| Session split | out-of-band, three manual steps | "split at phase boundaries" | one `handoff` call, fresh session pre-filled |
| Can block a tool call | no | no | **no** |

**Soft enforcement, stated plainly.** The plugin never blocks a tool call, edits
its arguments, or fails one — it changes what the agent can't miss, not what it
can do. A determined agent can still ignore every reminder. The bet is that the
numbers arriving in-band, at the moment of spend, change the plan; if the bet
fails, you still get the honest receipt.

None of this replaces the others: `AGENTS.md` still defines what "on budget"
means, and a dashboard is still the passive record — this is the runtime layer
between them. It was built against a concrete failure: a token budget written
into `AGENTS.md`, in context for the whole session, and then 184 tool calls and
3.0M effective fresh tokens spent on a task that should have been three sessions
([call by call](https://github.com/salitaba/opencode-token-norm/blob/main/docs/post-mortem.md)).

The plugin adds no advice. It counts, and staples the instruction onto output the
agent cannot skip past — it cannot make the agent obey, only put the rule
directly in its execution path — and that turns out to be most of the gap.
([Design reasoning](https://github.com/salitaba/opencode-token-norm/blob/main/docs/design.md)
· [rule-by-rule case](https://github.com/salitaba/opencode-token-norm/blob/main/docs/advice-vs-enforcement.md).)

## Contents

- [What it does](#what-it-does)
- [Install](#install)
- [Why add Token Norm?](#why-add-token-norm)
- [How it works](#how-it-works)
  - [1. Task boundary detection](#1-task-boundary-detection-the-missing-enforcement)
  - [2. Cost statement at 25 calls](#2-cost-statement-at-25-calls--once-per-session)
  - [3. Audit checkpoint every 60 calls](#3-audit-checkpoint-every-60-calls--already-run)
  - [4. Compaction context](#4-compaction-context)
  - [5. The `handoff` tool](#5-the-handoff-tool)
- [Observed behavior](#observed-behavior)
- [Safety](#safety)
- [Configuration](#configuration)
- [Run the audit yourself](#run-the-audit-yourself)
- [Pairs with your `AGENTS.md`](#pairs-with-your-agentsmd)
- [Further reading](#further-reading)
- [Links](#links)
- [License](#license)

## How it works

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

### 1. Task boundary detection (the missing enforcement)

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
[the design notes](https://github.com/salitaba/opencode-token-norm/blob/main/docs/design.md#task-boundary-detection).

### 2. Cost statement at 25 calls — **once per session**

At 25 calls — the first moment the task is provably big — the plugin demands the
cost statement: remaining calls, the caps now in effect, and which slice could
ship immediately behind a handoff. Once per session: the statement exists to
change the plan, and the plan only changes once.
([Why 25](https://github.com/salitaba/opencode-token-norm/blob/main/docs/design.md#why-25-and-why-once-per-session).)

### 3. Audit checkpoint every 60 calls — **already run**

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
[the metric](https://github.com/salitaba/opencode-token-norm/blob/main/docs/design.md#the-effective-fresh-metric).
(`calls` in the audit counts model turns; the 60 in the header counts tool calls.)

### 4. Compaction context

Compaction is the one moment an agent provably re-reads its own rules, so the
plugin injects the call count into it. *"You are 180 calls deep"* changes
behavior. *"Be frugal"* does not.

### 5. The `handoff` tool

The norm says split at phase boundaries. It rarely happens: splitting means
leaving the TUI, opening a session, and re-typing context by hand — three manual
steps at the exact moment the warm session feels cheapest to continue.
([Why friction wins](https://github.com/salitaba/opencode-token-norm/blob/main/docs/design.md#handoff-design-decisions).)

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
[the design notes](https://github.com/salitaba/opencode-token-norm/blob/main/docs/design.md#handoff-design-decisions).

---

## Observed behavior

The logs from one real machine show the guardrails firing, not just loading —
since 2026-09-08:

```text
205 sessions
227 budget reminders
 69 audits
583 boundaries
 74 handoffs
```

The strongest behavioral signal is what happens after a handoff: **64 of 71
(90%)** matched sessions stopped within 5 minutes of the note being written
(median: 4 seconds), and **none continued past an hour**. The fresh session did
the work; the old one actually ended.

On spend, the data is honest but weak: a single user, no control group, and the
"after" window is dominated by building this plugin, so before/after medians flip
direction depending on the cohort filter. **We do not claim the plugin reduced
tokens.** Method and limitations:
[evaluation notes](https://github.com/salitaba/opencode-token-norm/blob/main/docs/evaluation.md).

---

## Safety

- **It never blocks.** The budget half does not deny a tool call, edit its
  arguments, or fail one. A wrong threshold guess costs you a few lines of text,
  never a broken session.
- **One caveat, stated plainly.** The audit checkpoint runs synchronously and can
  stall OpenCode's event loop for up to 20s on a slow database, so it may briefly
  delay a tool result at the checkpoint.
- **Read-only.** The audit opens OpenCode's session DB (`$XDG_DATA_HOME/opencode`
  or `~/.local/share/opencode`) in read-only mode and never writes to it.
- **In-memory counters.** Call counts live in the plugin process, keyed by
  session, and reset when OpenCode restarts — a resumed long session undercounts
  until thresholds are crossed again. Counts are never persisted, and deleted
  sessions are evicted
  ([why](https://github.com/salitaba/opencode-token-norm/blob/main/docs/design.md#session-state-and-process-boundaries)).
- **Nothing leaves your machine.** No network calls, no telemetry. Handoff notes
  are written to `~/.local/share/opencode/handoff/` (follows `XDG_DATA_HOME`;
  override with `TOKEN_NORM_HANDOFF_DIR`).

---

## Configuration

All optional, all environment variables, and the defaults are the ones the
sessions above argued for. Three thresholds — `TOKEN_NORM_ANNOUNCE_AT`,
`TOKEN_NORM_AUDIT_EVERY`, `TOKEN_NORM_BOUNDARY_AT` — plus two kill switches,
`TOKEN_NORM_BUDGET` and `TOKEN_NORM_HANDOFF`. The measured budgets are opt-in:
set one and the plugin staples a status block onto tool output the first time
each metric crosses it (`TOKEN_NORM_MODE` controls how hard that bites). The
rest are paths you will probably never touch.

<details>
<summary>All options</summary>

| Variable | Default | Meaning |
|---|---|---|
| `TOKEN_NORM_ANNOUNCE_AT` | `25` | Calls before the cost-statement reminder |
| `TOKEN_NORM_AUDIT_EVERY` | `60` | Calls between audit checkpoints |
| `TOKEN_NORM_BOUNDARY_AT` | `40` | Session size above which a new user message is a task boundary |
| `TOKEN_NORM_MODE` | `warn` | `observe` logs only; `warn` injects; `handoff` adds a skeleton at a pause; `block` refuses non-cheap tools |
| `TOKEN_NORM_MAX_COST` | unset | USD budget from provider cost |
| `TOKEN_NORM_MAX_EFFECTIVE_TOKENS` | unset | Fresh-token budget (input + 0.1×cache read + 1.25×cache write) |
| `TOKEN_NORM_MAX_TOOL_CALLS` | unset | Budgeted tool calls; cheap tools excluded |
| `TOKEN_NORM_CONTEXT_WARN` | `0.8` | Fraction of the context window that counts as pressure |
| `TOKEN_NORM_CONTEXT_LIMIT` | model limit | Override the window size in tokens |
| `TOKEN_NORM_CHEAP_TOOLS` | `todowrite,question,skill` | Tools that do not count toward the budget |
| `TOKEN_NORM_HANDOFF_DIR` | `~/.local/share/opencode/handoff` | Where handoff notes are written |
| `TOKEN_NORM_LOG` | `~/.local/share/opencode/token-norm.log` | Threshold event log |
| `TOKEN_NORM_PYTHON` | `python3` | Interpreter for the audit script |
| `TOKEN_NORM_AUDIT_SCRIPT` | bundled | Override the audit script path |
| `TOKEN_NORM_SETTLE_MS` | `350` | Minimum wait after `session_new` before pre-filling (floor) |
| `TOKEN_NORM_SWITCH_WAIT_MS` | `2000` | Max wait for the new session before appending the prompt |
| `TOKEN_NORM_BUDGET` | `1` | Set `0` to disable the budget half |
| `TOKEN_NORM_HANDOFF` | `1` | Set `0` to disable the handoff tool |

</details>

Every `~/.local/share` above follows `XDG_DATA_HOME` when it is set.

The cheap set defaults to `todowrite`, `question`, and `skill`: planning and
asking should never burn the budget, since both usually *save* calls. Reads and
greps do count, because context is the thing you are paying for. To exempt them
anyway:

```sh
TOKEN_NORM_CHEAP_TOOLS=todowrite,question,skill,read,grep,glob
```

The variable replaces the default set rather than extending it, so list every
tool you want exempt.

---

## Run the audit yourself

The audit script ships inside the package, and reads the same DB the plugin does.
In a project where you installed it (`npm i opencode-token-norm`), run it from
that project root:

```sh
A=node_modules/opencode-token-norm/scripts/usage-audit.py

python3 $A --last                  # most recently updated session
python3 $A --session <session-id>  # one specific session (what the plugin runs)
python3 $A --top 5                 # rank the 5 most recent by effective tokens
python3 $A --receipt               # shareable snapshot, most recent session
python3 $A --receipt <session-id>  # ...or a named one
```

Those four modes are mutually exclusive, and each accepts `--json` for the raw
numbers — pipe the audit into your own tooling rather than parsing the table.
Session IDs come from `--top`, or from the `token-norm.log` lines above.

The one number to read is `effective fresh tokens = input + 0.1·cache_read +
1.25·cache_write` — a cost-weighted input, not a dollar amount. The formula and
its multipliers are explained in
[the metric](https://github.com/salitaba/opencode-token-norm/blob/main/docs/design.md#the-effective-fresh-metric);
actual spend is the provider-reported `cost_usd`, which some gateways report as `0`.

### Shareable receipt

`--receipt` prints a paste-ready snapshot of any session — the same numbers, laid
out for a screenshot. The verdict is honest rather than flattering: median
context past 60k earns `watch`, past 120k earns `HIGH`, and nothing rounds in
your favor. Color is applied only on a TTY, so piping to a file is already plain
text; `--no-color` or `NO_COLOR=1` forces it in a terminal too.

Run it on your worst session. That verdict argues the case better than any
benchmark could.

```text
============================================================
                  OPENCODE SESSION RECEIPT
============================================================
  Token norm: boundary dedupe regression
  ses_f75afcd6dffeRZXwjB7EgV2czv
  cc/claude-opus-5 · 9router-anthropic · 2026-09-10 11:47
------------------------------------------------------------
                   EFFECTIVE FRESH TOKENS
                            687k
       input 56k + cache read ×0.1 394k + cache write ×1.25 237k
           of 4.2M raw input · cache discount 84%
------------------------------------------------------------
  cache ratio       40x  cache read ÷ (input+output)
  tool calls        52   bash 37 · read 9 · todowrite 2
  context / call    84k median · 122k peak
  system floor      27k (first call)
  output            44k
------------------------------------------------------------
  verdict           watch — context creeping past 60k
============================================================
  enforce the budget, not the advice
  npm i opencode-token-norm
============================================================
```

---

## Pairs with your `AGENTS.md`

This plugin replaces none of your rules. It makes three of them unskippable and
leaves the rest to you — read windows, smallest test target, subagent delegation,
output caps. A counter cannot know any of those. The reminders are written to
point back at the file that does.

---

## Further reading

- [**Design notes**](https://github.com/salitaba/opencode-token-norm/blob/main/docs/design.md)
  — why the thresholds are where they are, the advice-vs-enforcement thesis, the
  task-boundary model, the handoff decisions, and what the effective-fresh number
  actually measures.
- [**Advice vs. enforcement**](https://github.com/salitaba/opencode-token-norm/blob/main/docs/advice-vs-enforcement.md)
  — the rule-by-rule case for why a norm sitting in context is not a norm, and
  the answer to "isn't this just prompt engineering?"
- [**Post-mortem**](https://github.com/salitaba/opencode-token-norm/blob/main/docs/post-mortem.md)
  — the session that audited itself, reported 3.0M tokens of waste, and kept
  going anyway. Every threshold here traces back to a specific moment in it.

---

## Links

- [Source](https://github.com/salitaba/opencode-token-norm) · [Issues](https://github.com/salitaba/opencode-token-norm/issues) · [npm](https://www.npmjs.com/package/opencode-token-norm)
- [Changelog](https://github.com/salitaba/opencode-token-norm/blob/main/CHANGELOG.md) · [Contributing](https://github.com/salitaba/opencode-token-norm/blob/main/CONTRIBUTING.md) · [Security](https://github.com/salitaba/opencode-token-norm/blob/main/SECURITY.md)
- If this plugin saved you tokens, a star helps others find it.

---

## License

MIT
