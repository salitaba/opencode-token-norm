# OpenCode compatibility

Targets the V1 plugin API (`@opencode-ai/plugin` ≥ 1.15.12); the V2 plugin API
is not targeted yet. The unit suite mocks the runtime that matters most — event
lifecycle, TUI switching, sqlite, Python audit — so real-runtime behavior is
tracked here. Run [the manual smoke test](smoke-test.md) against a build before
a release and add one row per run.

| OpenCode build | OS | Node | Result | Date | Notes |
|---|---|---|---|---|---|
| _template_ | _Linux_ | _22_ | _pass/fail_ | _YYYY-MM-DD_ | _deviations, issue links_ |

## Runtime assumptions

- `session.created` is emitted for the new primary (parentless) session, and
  `info.time.created` is a number — required by the V1 `Session` type in
  `@opencode-ai/plugin` ≥ 1.15.12. A `session.created` without a timestamp is
  treated as unverifiable: the waiter ignores it and falls back to the bounded
  timeout (`no session.created` in the log), so a stale event can never resolve
  the wrong switch. If a build ever stops sending the field, handoffs get slower
  but stay correct — record it here.
- `tui.executeCommand("session_new")` returns once the command is dispatched,
  not once the session is mounted, so the plugin waits for the event with a
  settle floor and a 2s fallback (`TOKEN_NORM_SWITCH_WAIT_MS`).
