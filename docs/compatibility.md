# OpenCode compatibility

Targets the V1 plugin API (`@opencode-ai/plugin` ≥ 1.15.12); the V2 plugin API
is not targeted yet. The unit suite mocks the runtime that matters most — event
lifecycle, TUI switching, sqlite, Python audit — so real-runtime behavior is
tracked here. Run [the manual smoke test](smoke-test.md) against a build before
a release and add one row per run; rows record what actually ran, and a partial
run says which sections were not exercised.

| OpenCode build | OS | Node | Result | Date | Notes |
|---|---|---|---|---|---|
| 1.18.30 | Linux | 24 | pass | 2026-09-11 | Live sessions on plugin 0.5.0: announce @25, task-boundary @40 with one reminder per user-message id, audit @60, handoff note written before the TUI switch and the 2s `no session.created` fallback appended. Not exercised in this run: block/observe modes (§8), subagent refusal (§6), compaction context (§7). |
| 1.18.30 | Linux | 24 | pass (partial) | 2026-09-11 | Plugin 0.5.1 built fresh from HEAD e302b47 (bundle sha256 `3c5c6b65c455…`; the installed bundle predated `8e3340a` — no `finally` — so it was rebuilt and reinstalled before these runs). Twelve `opencode run` invocations (headless, scratch dir, real `9router/ocg/deepseek-v4-flash`; four via `run --attach` to two `opencode serve` processes for the pause-driven paths): §1 — `announce-threshold at 3 calls`; §2 — the 3-call reminder carried the cost-statement demand; §3 — 2 calls then a new user message: 0 boundaries in message 1, exactly one `This is a TASK BOUNDARY.` on message 2's first tool call, none on its second; §4 — audit table at 3 calls, and with `TOKEN_NORM_PYTHON=definitely-missing` the `usage-audit did not run` fallback printed the manual command and the session continued; §8 observe — `budget crossing at 4 calls: tool-calls 4/3` logged with zero `TOKEN NORM -- BUDGET` injected; §8 block — 4th non-cheap call refused with `TOKEN NORM block (mode=block): Tool calls 3 / 3.`, `todowrite` and `handoff` allowed (note written, then the bounded 2s `no session.created` fallback); §8 handoff mode — `handoff armed (pause + budget pressure)` after idle, then `TOKEN NORM -- HANDOFF RECOMMENDED` on the next tool call; §6 — subagent `general` refused with `handoff is not available to subagents (you are "general", mode: subagent).`, handoff dir unchanged (84→84); §7 — `POST /session/:id/summarize`, hook text incl. `This session has made 1 tool calls` persisted in the rebuilt summary part; §9 — `TOKEN_NORM_BUDGET=0`: zero reminders and handoff still wrote a note; `TOKEN_NORM_HANDOFF=0`: no handoff tool. Not exercised: §5 only — these processes are headless, so note-before-switch, pre-fill, submit, and the toast need an interactive session on the rebuilt plugin. |
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
