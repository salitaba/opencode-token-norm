# Manual smoke test

The unit suite mocks the runtime that matters most: the OpenCode event
lifecycle, the TUI switch, the sqlite schema, and the Python audit. Run this
checklist against a real OpenCode build before a release, or after touching
`handoff.ts` or the event hooks. Ten minutes, one scratch project.

Use environment overrides to shrink the thresholds so nothing takes 60 calls.
Every step assumes the build under test is the one OpenCode loads — link or
install it first, then restart OpenCode.

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

## 8. Kill switches

- `TOKEN_NORM_BUDGET=0`: restart, confirm no counting reminders; the `handoff`
  tool still works.
- `TOKEN_NORM_HANDOFF=0`: restart, confirm the `handoff` tool is gone.

Record which OS and OpenCode build you ran this on when reporting results —
the compatibility matrix in the README depends on it.
