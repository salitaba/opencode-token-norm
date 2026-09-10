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

## Contents

- [What it does](#what-it-does)
- [Install](#install)
- [Why add Token Norm?](#why-add-token-norm)
- [How it works](#how-it-works)
- [Observed behavior](#observed-behavior)
- [Configuration](#configuration)
- [Run the audit yourself](#run-the-audit-yourself)
- [Further reading](#further-reading)
- [License](#license)

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

The default enforcement is behavioral: it puts the rule directly in the agent's
execution path; opt-in `block` mode adds mechanical refusal. Every threshold is
logged, configurable, and independently disableable.

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

Restart OpenCode. The command copies a self-contained build into
`~/.config/opencode/plugins/` and the audit script into
`~/.config/opencode/scripts/`; uninstall with `npx opencode-token-norm uninstall`.
Requires Node ≥ 22 and an OpenCode build with plugin support; `python3` is
optional, used for the audit checkpoint only. Requirements, verification, and
troubleshooting are in the
[install notes](https://github.com/salitaba/opencode-token-norm/blob/main/docs/install.md).

## Why add Token Norm?

| Capability | Statusline / dashboard | Token rule in `AGENTS.md` | token-norm |
|---|---|---|---|
| Who reads it | you, at the edge of the screen | the model, as one more instruction | the model, stapled to output it is already reading |
| When it fires | live, but outside the agent's context | only if the agent chooses to reread it | at 25 / 40 / 60 calls, in-band |
| Audit checkpoint | you run it, or you don't | "run the audit periodically" | already run — read-only, every 60 calls |
| Stale "do everything" overrides | invisible | nothing revokes them | a new task past 40 calls expires them |
| Session split | out-of-band, three manual steps | "split at phase boundaries" | one `handoff` call, fresh session pre-filled |
| Can block a tool call | no | no | no, unless opt-in `block` mode |

**Soft enforcement, stated plainly.** By default the plugin never blocks a tool
call, edits its arguments, or fails one — it changes what the agent can't miss,
not what it can do. Only opt-in `block` mode refuses non-cheap tool calls while
over budget. A determined agent can still ignore every reminder. The bet is that the
numbers arriving in-band, at the moment of spend, change the plan; if the bet
fails, you still get the honest receipt.

None of this replaces the others: `AGENTS.md` still defines what "on budget"
means, and a dashboard is still the passive record — this is the runtime layer
between them. It was built against a concrete failure: a token budget written
into `AGENTS.md`, in context for the whole session, and then 184 tool calls and
3.0M effective fresh tokens spent on a task that should have been three sessions
([call by call](https://github.com/salitaba/opencode-token-norm/blob/main/docs/post-mortem.md)).

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

- **Task boundary detection.** Past `BOUNDARY_AT` calls (default 40), a new user
  message revokes any stale "do everything" override, and the next tool call
  carries the reminder — once per user message, keyed on identity.
  [why](https://github.com/salitaba/opencode-token-norm/blob/main/docs/design.md#task-boundary-detection)
- **Cost statement at 25 calls.** Once per session, the plugin demands the
  remaining calls, the caps now in effect, and which slice could ship immediately
  behind a handoff.
  [why 25](https://github.com/salitaba/opencode-token-norm/blob/main/docs/design.md#why-25-and-why-once-per-session)
- **Audit checkpoint every 60 calls.** The plugin runs the audit itself —
  read-only against OpenCode's sqlite DB — and staples the numbers to output the
  agent is already reading.
  [the metric](https://github.com/salitaba/opencode-token-norm/blob/main/docs/design.md#the-effective-fresh-metric)
- **Compaction context.** Compaction is the one moment an agent provably re-reads
  its own rules, so the plugin injects the call count into it.
- **The `handoff` tool.** Persists the note before the TUI switch, opens a fresh
  session, pre-fills and submits the prompt; refused for subagents.
  [design decisions](https://github.com/salitaba/opencode-token-norm/blob/main/docs/design.md#handoff-design-decisions)
- **On-demand status.** `token_norm_status` returns tool calls, context, cost and
  effective-token usage plus the current `continue | warn | handoff | block`
  recommendation, as read-only JSON.

Full mechanism descriptions, with the exact reminder text and audit output:
[how it works](https://github.com/salitaba/opencode-token-norm/blob/main/docs/how-it-works.md).

## Observed behavior

On one real machine since 2026-09-08: 205 sessions, 227 cost-statement
reminders, 69 audits, 583 boundaries, 74 handoffs. After a handoff, **64 of 71
(90%)** matched sessions stopped within 5 minutes (median 4 seconds), and **none
continued past an hour**. On spend the data is honest but weak — a single user,
no control group — and **we do not claim the plugin reduced tokens**. Method and
limitations: [evaluation notes](https://github.com/salitaba/opencode-token-norm/blob/main/docs/evaluation.md).

## Configuration

All optional, all environment variables. Three thresholds —
`TOKEN_NORM_ANNOUNCE_AT`, `TOKEN_NORM_AUDIT_EVERY`, `TOKEN_NORM_BOUNDARY_AT` —
plus two kill switches: `TOKEN_NORM_BUDGET=0` disables the counting half, and
`TOKEN_NORM_HANDOFF=0` drops the `handoff` tool. The guardrails — thresholds
and mode — are on by default; the measured budgets (`TOKEN_NORM_MAX_COST`,
`TOKEN_NORM_MAX_EFFECTIVE_TOKENS`, `TOKEN_NORM_MAX_TOOL_CALLS`,
`TOKEN_NORM_CONTEXT_WARN`, `TOKEN_NORM_CONTEXT_LIMIT`) are opt-in, and unset
means unenforced. All options and defaults:
[configuration](https://github.com/salitaba/opencode-token-norm/blob/main/docs/configuration.md).

## Run the audit yourself

The audit script ships inside the package and reads the same DB the plugin does:

```sh
python3 node_modules/opencode-token-norm/scripts/usage-audit.py --last
```

Modes `--session`, `--top` and `--receipt` (each accepts `--json`), the
paste-ready receipt, and the `effective fresh tokens` formula are in the
[audit notes](https://github.com/salitaba/opencode-token-norm/blob/main/docs/audit.md).

## Pairs with your `AGENTS.md`

This plugin replaces none of your rules. It makes three of them unskippable and
leaves the rest to you — read windows, smallest test target, subagent delegation,
output caps. A counter cannot know any of those. The reminders are written to
point back at the file that does.

## Further reading

- [**Design notes**](https://github.com/salitaba/opencode-token-norm/blob/main/docs/design.md)
  — why the thresholds are where they are, the task-boundary model, the handoff
  decisions, session-state and safety boundaries, and what the effective-fresh
  number actually measures.
- [**Advice vs. enforcement**](https://github.com/salitaba/opencode-token-norm/blob/main/docs/advice-vs-enforcement.md)
  — the rule-by-rule case for why a norm sitting in context is not a norm, and
  the answer to "isn't this just prompt engineering?"
- [**Post-mortem**](https://github.com/salitaba/opencode-token-norm/blob/main/docs/post-mortem.md)
  — the session that audited itself, reported 3.0M tokens of waste, and kept
  going anyway. Every threshold here traces back to a specific moment in it.

## Links

- [Source](https://github.com/salitaba/opencode-token-norm) · [Issues](https://github.com/salitaba/opencode-token-norm/issues) · [npm](https://www.npmjs.com/package/opencode-token-norm)
- [Changelog](https://github.com/salitaba/opencode-token-norm/blob/main/CHANGELOG.md) · [Contributing](https://github.com/salitaba/opencode-token-norm/blob/main/CONTRIBUTING.md) · [Security](https://github.com/salitaba/opencode-token-norm/blob/main/SECURITY.md)
- If this plugin saved you tokens, a star helps others find it.

## License

MIT
