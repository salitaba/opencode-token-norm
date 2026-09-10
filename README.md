# opencode-token-norm

[![npm version](https://img.shields.io/npm/v/opencode-token-norm)](https://www.npmjs.com/package/opencode-token-norm)
[![npm downloads](https://img.shields.io/npm/dm/opencode-token-norm)](https://www.npmjs.com/package/opencode-token-norm)
[![license](https://img.shields.io/npm/l/opencode-token-norm)](https://github.com/salitaba/opencode-token-norm/blob/main/LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/salitaba/opencode-token-norm?style=social)](https://github.com/salitaba/opencode-token-norm)
[![GitHub release](https://img.shields.io/github/v/release/salitaba/opencode-token-norm)](https://github.com/salitaba/opencode-token-norm/releases/latest)

**Your token rules are advice. This makes them mechanical.**

An [OpenCode](https://opencode.ai) plugin that counts your agent's tool calls,
staples reminders onto the output it is already reading, runs the token audit on
its behalf, and collapses the session split into one tool call.

![token-norm demo: the agent gets counted, audited, and handed off](https://raw.githubusercontent.com/salitaba/opencode-token-norm/main/docs/assets/token-norm-demo.gif)

*Demo (18s at 2x): the plugin counts calls and staples the audit onto tool output, then the agent calls `handoff` and lands in a fresh session with the note pre-filled. [Full-speed MP4](https://raw.githubusercontent.com/salitaba/opencode-token-norm/main/docs/assets/token-norm-demo.mp4).*

You wrote a token budget into `AGENTS.md`. It loads into every session. The agent
reads it, agrees with it, and then spends 184 tool calls and 3.0M effective
tokens — real dollars — on a task that should have been three sessions.
([What that session actually did, call by call](https://github.com/salitaba/opencode-token-norm/blob/main/docs/post-mortem.md).)

Writing the rule better does not fix that. The rules that hold are the ones that
do not depend on the agent choosing to follow them, which is why "cap bash
output" never fails — a plugin rewrites the command and nobody has to remember.
The two rules with no mechanism are the two that break.

So this plugin adds no advice. It **counts**, and at thresholds it staples the
instruction onto tool output the agent cannot skip past. It cannot make the agent
obey. It can make the rule impossible to not see, and that turns out to be most
of the gap.
([Advice vs. enforcement, rule by rule](https://github.com/salitaba/opencode-token-norm/blob/main/docs/advice-vs-enforcement.md).)

Two halves, either one disableable:

- **`TokenNormBudget`** — counts tool calls, staples in-band reminders at
  thresholds, and runs the usage audit *for* the agent, leaving it a fact to
  report rather than a step to defer.
- **`TokenNormHandoff`** — a `handoff` tool that collapses the session split from
  three manual steps into one call.

---

## Contents

- [Install](#install)
- [What it actually does](#what-it-actually-does)
  - [1. Task boundary detection](#1-task-boundary-detection-the-missing-enforcement)
  - [2. Cost statement at 25 calls](#2-cost-statement-at-25-calls--once-per-session)
  - [3. Audit checkpoint every 60 calls](#3-audit-checkpoint-every-60-calls--already-run)
  - [4. Compaction context](#4-compaction-context)
  - [5. The `handoff` tool](#5-the-handoff-tool)
- [Safety](#safety)
- [Configuration](#configuration)
- [Run the audit yourself](#run-the-audit-yourself)
- [Pairs with your `AGENTS.md`](#pairs-with-your-agentsmd)
- [Further reading](#further-reading)

---

## Install

```sh
opencode plugin opencode-token-norm --global
```

Restart OpenCode. That is the whole install — the command registers the package
in `~/.config/opencode/opencode.json` and OpenCode caches it at startup.

Requires an OpenCode build with plugin support (`@opencode-ai/plugin` ≥ 1.15.12),
and `python3` for the audit checkpoint. Without python3 nothing breaks: the
reminder still fires, and tells the agent to run the audit itself. To run the
audit by hand you also want the package installed in a project — see below;
needs Node ≥ 22.

**Check it loaded.** Nothing surfaces until call 25, so a silent install looks
exactly like a working one. Every threshold the plugin fires is logged, so after
a session long enough to trigger one:

```console
$ tail ~/.local/share/opencode/token-norm.log
2026-09-10T11:47:02.913Z ses_f75afcd6 announce-threshold at 25 calls (bash 14, read 9, grep 4)
```

An empty file after a six-call session means it is working, not missing — nothing
crossed a threshold.

**Turning it off does not require uninstalling.** `TOKEN_NORM_BUDGET=0` disables
the counting half; `TOKEN_NORM_HANDOFF=0` drops the `handoff` tool. Both take
effect on restart.

---

## What it actually does

### 1. Task boundary detection (the missing enforcement)

The expensive failure is not a long task. It is a **new** task inheriting an old
task's context *and* an old task's permission. Dashboards and statuslines report
that after the session ends, when the money is gone; this interrupts the agent
while the spend is still avoidable.

A real session: 195k tokens deep, the norm in context the whole time, the agent
ran the audit and reported *"77x cache, bloat HIGH"* — then kept going. The
reason is not laziness. A second request (*"now do all of them"*) was read as a
continuation of the `do everything` override granted for the first. Overrides are
per-task; nothing enforced that.

Now, when a new user message arrives in a session already past `BOUNDARY_AT`
calls (default 40), the next tool call carries this:

```text
TOKEN NORM -- new request arrived 47 tool calls deep. This is a TASK BOUNDARY.
A prior "do everything" / "don't ask" was scoped to the PREVIOUS task. It does not carry.
...
Do NOT justify continuing with "finishing here beats reloading cold". That reasoning
is always available, feels free only because this context is already warm, and is the
exact rationalization the norm exists to block.
```

That last paragraph is the load-bearing one. Every agent talks itself past a
split with some version of *"reloading cold costs more than finishing here."* The
argument is always available and almost always wrong: the marginal call feels
free precisely because the context is already warm.

The reminder fires **once per user message**, keyed on message identity — not a
detail. `message.updated` fires many times for the same message, and an early
build keyed on call count instead, which went stale after one tool call and
re-armed: 61 copies of this warning in a single session. That is worse than
silence. A warning on every tool call becomes wallpaper, and the agent learns to
skip *every* system-reminder, audit included. Cry wolf once per wolf.

### 2. Cost statement at 25 calls — **once per session**

The norm wants the cost statement **before** a big task starts. The agent cannot
give one then; it does not know the size yet. So the plugin waits for the first
moment the task is provably big and demands the statement there: calls remaining
and what will drive them, the caps now in effect, and which slice could ship
immediately behind a handoff.

Once per session, not once per threshold. The statement exists to change the
plan, and the plan only changes once.

### 3. Audit checkpoint every 60 calls — **already run**

"Run this command and report the number" is advice, and advice at a checkpoint
loses to the task in flight every time. One session was told to audit at call 79,
kept working, and produced the number only when the user thought to ask — long
after the spend it was meant to prevent.

So the plugin runs the audit itself. The command is cheap, deterministic, and
opens OpenCode's sqlite DB **read-only**. The result arrives stapled to output
the agent is already reading:

```text
TOKEN NORM -- 60 tool calls. Audit checkpoint (ran for you):

totals  : input 23k  output 15k  cache_read 891k  cache_write 87k
effective fresh tokens: 221k   (input + 0.1·cache_read + 1.25·cache_write — the money number)   cost $0.89
calls   : 22   context/call min 23k med 49k max 61k
cacheR  : per-call med 45k  (first-call total 23k = system floor)
cache   : 23x cache read ÷ (input+output) — bloat driver ok

In your NEXT message, before continuing the task: report the effective-token
number and the cache multiplier to the user, and say whether you are splitting.
```

No step left to defer — only a fact to report. (`calls` in the audit counts model
turns; the 60 in the header counts tool calls.)

### 4. Compaction context

Compaction is the one moment an agent provably re-reads its own rules, so the
plugin injects the call count into it. *"You are 180 calls deep"* changes
behavior. *"Be frugal"* does not.

### 5. The `handoff` tool

The norm says split at phase boundaries. It rarely happens, because splitting
means leaving the TUI, opening a new session, and re-typing the context by hand —
three manual steps demanded at exactly the moment the warm session feels cheapest
to continue. The rule loses to friction, not to disagreement.

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

**Design decisions worth knowing:**

- **Auto-submitted by default.** The handoff starts the fresh session with no
  user action, which is the point of making the split frictionless. Pass
  `submit: false` to stop at the pre-filled prompt when you want a beat to
  redirect before any tokens burn.
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
- **Nothing leaves your machine.** No network calls, no telemetry. Handoff notes
  are written to `~/.local/share/opencode/handoff/` (follows `XDG_DATA_HOME`;
  override with `TOKEN_NORM_HANDOFF_DIR`).

---

## Configuration

All optional, all environment variables, and the defaults are the ones the
sessions above argued for. Three thresholds — `TOKEN_NORM_ANNOUNCE_AT`,
`TOKEN_NORM_AUDIT_EVERY`, `TOKEN_NORM_BOUNDARY_AT` — plus two kill switches,
`TOKEN_NORM_BUDGET` and `TOKEN_NORM_HANDOFF`. The rest are paths you will
probably never touch.

<details>
<summary>All options</summary>

| Variable | Default | Meaning |
|---|---|---|
| `TOKEN_NORM_ANNOUNCE_AT` | `25` | Calls before the cost-statement reminder |
| `TOKEN_NORM_AUDIT_EVERY` | `60` | Calls between audit checkpoints |
| `TOKEN_NORM_BOUNDARY_AT` | `40` | Session size above which a new user message is a task boundary |
| `TOKEN_NORM_CHEAP_TOOLS` | `todowrite,question,skill` | Tools that do not count toward the budget |
| `TOKEN_NORM_HANDOFF_DIR` | `~/.local/share/opencode/handoff` | Where handoff notes are written |
| `TOKEN_NORM_LOG` | `~/.local/share/opencode/token-norm.log` | Threshold event log |
| `TOKEN_NORM_PYTHON` | `python3` | Interpreter for the audit script |
| `TOKEN_NORM_AUDIT_SCRIPT` | bundled | Override the audit script path |
| `TOKEN_NORM_SETTLE_MS` | `350` | Wait after `session_new` before pre-filling the prompt |
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

One number carries the section:

```text
effective fresh tokens = input + 0.1·cache_read + 1.25·cache_write
```

That is what maps to money. Raw `cache_read` does not, which is why a session can
look enormous and cost little — or look modest and not. The audit also reports
the session's `cost_usd` straight from OpenCode's local DB when the provider
supplied one; some gateways report 0, and there the effective-token figure is
your only signal. Multipliers follow Anthropic cache pricing.

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
  Core package test coverage: kernel + messaging suites
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

- [**Advice vs. enforcement**](https://github.com/salitaba/opencode-token-norm/blob/main/docs/advice-vs-enforcement.md)
  — the rule-by-rule case for why a norm sitting in context is not a norm, and
  the answer to "isn't this just prompt engineering?"
- [**Post-mortem**](https://github.com/salitaba/opencode-token-norm/blob/main/docs/post-mortem.md)
  — the session that audited itself, reported 3.0M tokens of waste, and kept
  going anyway. Every threshold here traces back to a specific moment in it.

---

## Links

- [Source](https://github.com/salitaba/opencode-token-norm) · [Issues](https://github.com/salitaba/opencode-token-norm/issues) · [npm](https://www.npmjs.com/package/opencode-token-norm)
- If this plugin saved you tokens, a star helps others find it.

---

## License

MIT
