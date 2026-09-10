# opencode-token-norm

**Your token rules are advice. This makes them mechanical.**

You wrote a token budget into `AGENTS.md`. It loads into every session. The agent
reads it, agrees with it, and then runs 184 tool calls and 3.0M effective tokens
on a task that should have been three sessions.

That is not a prompting failure. Rules that survive are the ones that do not
depend on the agent choosing to follow them. This plugin does not add advice —
it **counts**, and at thresholds it staples an instruction onto tool output the
agent is already reading.

Two halves:

- **`TokenNormBudget`** — counts tool calls, fires un-skippable reminders at
  thresholds, and runs the usage audit *for* the agent so there is no step to defer.
- **`TokenNormHandoff`** — a `handoff` tool that makes the session split a single
  tool call instead of three manual steps.

---

## Install

```json
// ~/.config/opencode/opencode.json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-token-norm"]
}
```

Restart OpenCode. Pin a version if you want stability:

```json
{ "plugin": ["opencode-token-norm@0.1.0"] }
```

Requires OpenCode with plugin support (`@opencode-ai/plugin` ≥ 1.15.12).
The audit checkpoint additionally needs `python3` — without it, the reminder
still fires and tells the agent to run the audit manually.

---

## What it actually does

### 1. Task boundary detection (the one nobody has)

The expensive failure is not a long task. It is a **new** task inheriting an old
task's context and an old task's permission.

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
task is provably big and forces the statement then: remaining calls, caps in
effect, and which part could ship now behind a handoff.

### 3. Audit checkpoint every 60 calls — **already run**

"Run this command and report the number" is advice, and advice at a checkpoint
loses to the task in flight every time. One session was told to audit at call 79,
kept working, and produced the number only when the user asked afterwards.

So the plugin runs it. The command is cheap, deterministic, and opens OpenCode's
sqlite DB **read-only**. The agent gets the result stapled to its tool output:

```
TOKEN NORM -- 60 tool calls. Audit checkpoint (ran for you):

totals  : input 23k  output 15k  cache_read 891k  cache_write 87k
effective fresh tokens: 220k   (input + 0.1·cache_read + 1.25·cache_write — the money number)
calls   : 22   context/call min 23k med 49k max 61k
cache   : 23x fresh tokens — bloat driver ok

In your NEXT message, before continuing the task: report the effective-token
number and the cache multiplier to the user, and say whether you are splitting.
```

No step to defer. Only a fact to report.

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
  done:  "Diagnosed: TokenValidator.isExpired() at src/auth/token.ts:88 uses < not <=",
  next:  "Change the comparison, add a boundary test at exactly expiresAt",
  files: ["src/auth/token.ts:88", "src/auth/__tests__/token.test.ts"],
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
  from the live agent list, so agents you add later classify correctly.
- **Structured args, not a freeform summary.** `task`/`done`/`next`/`files`/`notes`
  forces the agent to name real paths and real identifiers it verified — the next
  session cannot see the scrollback.

---

## Safety

- Never blocks a tool call, never edits args, never throws. A wrong threshold
  guess costs a few lines of text, not a broken session.
- The audit opens `~/.local/share/opencode/opencode.db` **read-only** and never writes.
- No network calls. No telemetry. Nothing leaves your machine.
- Handoff notes are written to `~/.local/share/opencode/handoff/`.

---

## Configuration

All optional, all environment variables.

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

Cheap tools do not count because reads and greps are how you *avoid* waste —
scaring the agent off them makes sessions more expensive, not less.

---

## Run the audit yourself

```bash
python3 node_modules/opencode-token-norm/scripts/usage-audit.py --last
python3 node_modules/opencode-token-norm/scripts/usage-audit.py --receipt
python3 node_modules/opencode-token-norm/scripts/usage-audit.py --receipt <session-id>
python3 node_modules/opencode-token-norm/scripts/usage-audit.py --top 5
python3 node_modules/opencode-token-norm/scripts/usage-audit.py --top 5 --json
```

`effective fresh tokens = input + 0.1·cache_read + 1.25·cache_write` — the number
that maps to money. Raw `cache_read` does not.

---

## Pairs with

A rules file the reminders can point at. The plugin enforces; your `AGENTS.md`
still supplies the specifics (read windows, smallest test target, subagent
delegation, output caps).

---

## License

MIT
