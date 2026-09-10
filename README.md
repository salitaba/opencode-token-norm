# opencode-token-norm

[![npm version](https://img.shields.io/npm/v/opencode-token-norm)](https://www.npmjs.com/package/opencode-token-norm)
[![npm downloads](https://img.shields.io/npm/dm/opencode-token-norm)](https://www.npmjs.com/package/opencode-token-norm)
[![license](https://img.shields.io/npm/l/opencode-token-norm)](https://github.com/salitaba/opencode-token-norm/blob/main/LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/salitaba/opencode-token-norm?style=social)](https://github.com/salitaba/opencode-token-norm)

**Your token rules are advice. This makes them mechanical.**

An [OpenCode](https://opencode.ai) plugin that counts tool calls, staples
reminders onto tool output at thresholds, runs the token audit for the agent, and
turns the session split into a single tool call.

![token-norm demo: the agent gets counted, audited, and handed off](https://raw.githubusercontent.com/salitaba/opencode-token-norm/main/docs/assets/token-norm-demo.gif)

*Demo (28s at 2x): the plugin counts calls and staples the audit onto tool output, then the agent calls `handoff` and lands in a fresh session with the note pre-filled. [Full-speed MP4](https://raw.githubusercontent.com/salitaba/opencode-token-norm/main/docs/assets/token-norm-demo.mp4).*

You wrote a token budget into `AGENTS.md`. It loads into every session. The agent
reads it, agrees with it, and then runs 184 tool calls and 3.0M effective tokens
— real dollars — on a task that should have been three sessions.

That is not a prompting failure. Rules that survive are the ones that do not
depend on the agent choosing to follow them. This plugin does not add advice —
it **counts**, and at thresholds it staples an instruction onto tool output the
agent is already reading. It cannot force the agent to obey; it can make the rule
impossible not to see.

Two halves:

- **`TokenNormBudget`** — counts tool calls, staples in-band reminders onto tool
  output at thresholds, and runs the usage audit *for* the agent so there is no
  step to defer.
- **`TokenNormHandoff`** — a `handoff` tool that makes the session split a single
  tool call instead of three manual steps.

---

## Install

Requires OpenCode with plugin support (`@opencode-ai/plugin` ≥ 1.15.12) and
Node ≥ 22.
The audit checkpoint additionally needs `python3` — without it, the reminder
still fires and tells the agent to run the audit manually.

```json
// ~/.config/opencode/opencode.json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-token-norm"]
}
```

Restart OpenCode. That config entry is the whole install — OpenCode fetches the
package. To run the audit script by hand instead, `npm i opencode-token-norm` in
a project (below).

---

## What it actually does

### 1. Task boundary detection (the missing enforcement)

The expensive failure is not a long task. It is a **new** task inheriting an old
task's context and an old task's permission. Usage dashboards and statuslines
report the damage after a session ends; this interrupts the agent at the
moment it happens.

Real session: 195k tokens deep, the agent had the norm in context, ran the audit,
reported *"77x cache, bloat HIGH"* — and continued anyway. Why? A second request
(*"now do all of them"*) was treated as a continuation of the `do everything`
override granted for the first. Overrides are per-task. Nothing enforced that.

When a new user message arrives in a session already past `BOUNDARY_AT` calls
(default 40), the next tool call carries:

```
TOKEN NORM -- new request arrived 47 tool calls deep. This is a TASK BOUNDARY.
A prior "do everything" / "don't ask" was scoped to the PREVIOUS task. It does not carry.
...
Do NOT justify continuing with "finishing here beats reloading cold". That reasoning
is always available, feels free only because this context is already warm, and is the
exact rationalization the norm exists to block.
```

That last line matters. Every agent talks itself past a split with *"reloading
cold costs more than finishing here."* It is always available and almost always
wrong — the marginal call feels free precisely because the context is warm.

### 2. Cost statement at 25 calls

The norm wants a cost statement **before** a big task. In practice the agent only
learns the true size once it is underway. So this fires at the first moment the
task is provably big and puts the statement in front of the agent then: remaining
calls, caps in effect, and which part could ship now behind a handoff.

### 3. Audit checkpoint every 60 calls — **already run**

"Run this command and report the number" is advice, and advice at a checkpoint
loses to the task in flight every time. One session was told to audit at call 79,
kept working, and produced the number only when the user asked afterwards.

So the plugin runs it. The command is cheap, deterministic, and opens OpenCode's
sqlite DB **read-only**. The agent gets the result stapled to its tool output:

```
TOKEN NORM -- 60 tool calls. Audit checkpoint (ran for you):

totals  : input 23k  output 15k  cache_read 891k  cache_write 87k
effective fresh tokens: 221k   (input + 0.1·cache_read + 1.25·cache_write — the money number)   cost $0.89
calls   : 22   context/call min 23k med 49k max 61k
cacheR  : per-call med 45k  (first-call total 23k = system floor)
cache   : 23x cache read ÷ (input+output) — bloat driver ok

In your NEXT message, before continuing the task: report the effective-token
number and the cache multiplier to the user, and say whether you are splitting.
```

No step to defer. Only a fact to report. (`calls` in the audit counts model
turns; the 60 above counts tool calls.)

### 4. Compaction context

Compaction is the one moment the agent provably re-reads its own rules. The
plugin injects the call count there, because *"you are 180 calls deep"* changes
behavior and *"be frugal"* does not.

### 5. The `handoff` tool

The norm says split at phase boundaries. It does not happen, because splitting
means leaving the TUI, opening a new session, and re-typing context by hand —
three manual steps at exactly the moment the warm session feels cheapest to continue.

One tool call instead:

```
handoff({
  task:  "Fix token expiry off-by-one in auth middleware",
  done:  "Diagnosed: TokenValidator.isExpired() at /repo/src/auth/token.ts:88 uses < not <=",
  next:  "Change the comparison, add a boundary test at exactly expiresAt",
  files: ["/repo/src/auth/token.ts:88", "/repo/src/auth/__tests__/token.test.ts"],
})
```

The plugin writes the note to disk, opens a new TUI session, and pre-fills the
prompt. You press enter.

**Design decisions worth knowing:**

- **Not auto-submitted by default.** An auto-submitted handoff starts burning
  tokens on a task you may have wanted to redirect — and the beat before enter
  is the entire point of splitting. Pass `submit: true` for unattended work.
- **Persisted before the TUI switch.** If the switch fails, the note still exists
  on disk. The reverse ordering loses it on exactly the failure that matters.
- **Refused for subagents.** Plugin tools register for every agent. A subagent
  calling `handoff` would hijack your screen mid-task. Subagent status is resolved
  from the live agent list, so agents you add later classify correctly. If that
  lookup fails, it allows the call rather than stranding a primary agent.
- **Structured args, not a freeform summary.** `task`/`done`/`next`/`files`/`notes`
  keep the note to real paths and verified identifiers — the next session cannot
  see the scrollback.

---

## Safety

- The budget half never denies or edits a tool call. The audit checkpoint runs
  synchronously and can stall OpenCode's event loop for up to 20s on a slow DB,
  so it may briefly delay a tool result; a wrong threshold guess costs a few lines
  of text, not a broken session.
- The audit opens OpenCode's session DB (`$XDG_DATA_HOME/opencode` or
  `~/.local/share/opencode`) **read-only** and never writes.
- No network calls. No telemetry. Nothing leaves your machine.
- Handoff notes are written to `~/.local/share/opencode/handoff/` (follows
  `XDG_DATA_HOME`; override with `TOKEN_NORM_HANDOFF_DIR`).

---

## Configuration

All optional, all environment variables. The five that matter most:
`TOKEN_NORM_ANNOUNCE_AT`, `TOKEN_NORM_AUDIT_EVERY`, `TOKEN_NORM_BOUNDARY_AT`,
and `TOKEN_NORM_BUDGET` / `TOKEN_NORM_HANDOFF` to switch either half off.

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

`~/.local/share` in the defaults follows `XDG_DATA_HOME` when set.

The default cheap set is `todowrite`, `question`, and `skill` — planning and
asking should not burn the budget. Reads and greps still count, because context
is what you are paying for; if you would rather not count them either, set
`TOKEN_NORM_CHEAP_TOOLS=todowrite,question,skill,read,grep,glob` (the variable
replaces the default set, it does not extend it).

---

## Run the audit yourself

The audit script ships inside the package. In a project where you installed it
(`npm i opencode-token-norm`), run it from that project root:

```bash
python3 node_modules/opencode-token-norm/scripts/usage-audit.py --last
python3 node_modules/opencode-token-norm/scripts/usage-audit.py --receipt
python3 node_modules/opencode-token-norm/scripts/usage-audit.py --receipt <session-id>
python3 node_modules/opencode-token-norm/scripts/usage-audit.py --top 5
python3 node_modules/opencode-token-norm/scripts/usage-audit.py --top 5 --json
```

`effective fresh tokens = input + 0.1·cache_read + 1.25·cache_write` — the number
that maps to money. Raw `cache_read` does not. The audit also pulls the session's
`cost_usd` from OpenCode's local DB when the provider reported one — some
gateways report 0, in which case the effective-token proxy is the signal. The
multipliers follow Anthropic cache pricing.

### Shareable receipt

`--receipt` prints a paste-ready snapshot of any session — same numbers, laid out
for a screenshot. The verdict is honest, not flattering: context that creeps past
60k says so. Colors appear only on a TTY; `--no-color` forces plain text.
Run it on your worst session — a screenshot of that verdict tells the story
better than any benchmark.

```
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

A rules file the reminders can point at. The plugin enforces; your `AGENTS.md`
still supplies the specifics (read windows, smallest test target, subagent
delegation, output caps).

## Links

- [Source](https://github.com/salitaba/opencode-token-norm) · [Issues](https://github.com/salitaba/opencode-token-norm/issues) · [npm](https://www.npmjs.com/package/opencode-token-norm)
- If this plugin saved you tokens, a star helps others find it.

---

## License

MIT
