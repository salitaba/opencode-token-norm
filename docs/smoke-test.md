# Manual smoke test

The unit suite mocks the runtime that matters most: the OpenCode event
lifecycle, the TUI switch, the sqlite schema, and the Python audit. Run this
checklist against a real OpenCode build before a release, or after touching
`handoff.ts` or the event hooks. Ten minutes, one scratch project.

Use environment overrides to shrink the thresholds so nothing takes 60 calls.
Every step assumes the build under test is the one OpenCode loads — link or
install it first (`npm run install:local` from a clone, or the equivalent wrapper
described in the README), then restart OpenCode.

## 1. Loaded and logging

- Set `TOKEN_NORM_ANNOUNCE_AT=3`.
- Start a session, make three tool calls, check
  `~/.local/share/opencode/token-norm.log` for an `announce-threshold` line.
- An empty log after a short session is a failure here, not "nothing crossed a
  threshold".

## 2. Cost statement (once)

- Continue the same session. The third tool output should carry the
  `TOKEN NORM -- 3 tool calls` reminder with the cost-statement demand.
- Keep making calls: the reminder must not appear again.

## 3. Task boundary (once per message)

- Set `TOKEN_NORM_BOUNDARY_AT=2` and restart.
- Make two tool calls, then send a new user message.
- The next tool output must carry `This is a TASK BOUNDARY`.
- Make another tool call: no second boundary for the same message.
- Send a different user message: one new boundary. If it repeats per tool call,
  the message-identity dedupe has regressed.

## 4. Audit checkpoint

- Set `TOKEN_NORM_AUDIT_EVERY=3` and restart.
- At the third call, the output must contain the audit table
  (`effective fresh tokens`, `totals`, `calls`).
- Rename `python3` on `PATH` (or set `TOKEN_NORM_PYTHON=definitely-missing`) and
  restart: the checkpoint must still fire and print the "did not run" fallback
  with the manual command — never break the session.

## 5. Handoff, the real TUI

- Ask the agent to call `handoff` with real values.
- Verify, in order:
  1. a note appears in `~/.local/share/opencode/handoff/` (0600 on POSIX) before
     the screen changes;
  2. a new session opens and its prompt is pre-filled (and submitted by default);
  3. the old session receives no further tool calls;
  4. a success toast is shown.
- Repeat with `submit: false`: the prompt is pre-filled but not submitted.
- Run the same test twice within one second if you can: two note files, no
  overwrite.

## 6. Subagent refusal

- Delegate a task to a subagent (for example `explore`) that attempts `handoff`.
- Expect the refusal text: no new session, no note file, no screen hijack.

## 7. Compaction context

- In a session with a few tool calls, trigger compaction.
- The rebuilt context must include `Session budget at compaction` with the call
  count.

## 8. Budgets and modes

- Set `TOKEN_NORM_MAX_TOOL_CALLS=3` and restart.
- At the third budgeted call, the tool output must carry the budget status block
  (`TOKEN NORM -- BUDGET`, `Tool calls: 3 / 3`). It must not repeat on call four.
- Set `TOKEN_NORM_MODE=observe` and restart: the status block must NOT appear,
  but `token-norm.log` must contain a `budget crossing` line with the used/limit
  values.
- Set `TOKEN_NORM_MODE=block` with `TOKEN_NORM_MAX_TOOL_CALLS=3` and restart:
  the next non-cheap tool call after the third must be refused with
  `TOKEN NORM block`, while `todowrite` and `handoff` still work.
- Set `TOKEN_NORM_MODE=handoff` with a low limit, cross it, then finish a todo
  (or let the session idle): the next tool output must append
  `HANDOFF RECOMMENDED` with the touched files and the skeleton.

### Context-pressure validation

The context formula (`input + cache.read + cache.write + output`) is the one
number that has no unit test behind it. It was checked offline against recorded
sessions in `~/.local/share/opencode/opencode.db` (2026-09-11), comparing the
plugin's `contextNow` at the last pre-compaction main step with OpenCode's own
`tokens.total` for that step — the number OpenCode's overflow check
(`SessionCompaction.isOverflow`) consumes:

| Session prefix | Provider / model | contextNow | tokens.total | diff |
|---|---|---|---|---|
| `ses_0583a7938` | openai / gpt-5.6-luna | 352,295 | 352,304 | −0.003% |
| `ses_03e0920fa` | openai / gpt-5.6-luna | 352,690 | 352,817 | −0.04% |
| `ses_039a059c4` | openai / gpt-5.6-luna | 351,982 | 352,533 | −0.16% |
| `ses_fea7683d3` | opencode-go / deepseek-v4-flash | 268,439 | 268,439 | 0% |

All deltas are the last step's `reasoning` tokens (0–551 here): OpenCode stores
`total = input + output + reasoning + cache.read + cache.write` while the plugin
formula omits `reasoning`. Across 61,050 recorded step-finish parts the identity
held for 99.8% (remainder: zero-token steps).

Do **not** validate against the compaction summarize call's prompt. Since
OpenCode 1.18.x compaction is tail-based (`part type:"compaction"` with
`auto`/`overflow`/`tail_start_id`): it summarizes the head and keeps recent
turns, so the summarize prompt ran 87k–198k in these sessions while the live
context was 268k–352k. The proactive pre-flight estimate
(`SessionCompaction.compactIfNeeded`) is computed in memory and is not persisted
to the DB or the log, so it cannot be replayed offline.

To validate against a compaction in a live session:

- Run in `observe` mode. Leave `TOKEN_NORM_CONTEXT_LIMIT` unset to exercise the
  model-limit lookup (requires a known provider/model), or set it to force a
  small window.
- Work until a `budget crossing` line with `context` appears in the log, and
  compare its `used` value with the last pre-compaction step reported by
  `usage-audit.py --session <id>`.
- If the model lookup finds no limit, context pressure stays off by design; set
  `TOKEN_NORM_CONTEXT_LIMIT` explicitly.

Live check (plugin 0.8.0, OpenCode 1.18.30, 2026-09-12): `budget crossing at 2
calls: context 8.6k/1.0M` (limit from the provider lookup, nothing injected); the
crossing `used` 8,631 matched `usage-audit.py --session` `first_call_total` and
that step's `tokens.total` exactly. A step's tokens are persisted only after its
tool returns, so one tool call can never log a context crossing and the crossing
always compares against the newest persisted step — record in `compatibility.md`.

## 9. Kill switches

- `TOKEN_NORM_BUDGET=0`: restart, confirm no counting reminders; the `handoff`
  tool still works.
- `TOKEN_NORM_HANDOFF=0`: restart, confirm the `handoff` tool is gone.

Record which OS and OpenCode build you ran this on when reporting results, and
add a row to [docs/compatibility.md](compatibility.md) — that table is the
real-world evidence behind the README's compatibility claims.
