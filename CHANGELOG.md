# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Config diagnostics: a malformed or misspelled `TOKEN_NORM_*` setting is
  reported once at load (log line plus a toast) instead of silently falling back
  to its default. Covers non-numeric or non-positive thresholds and budgets, an
  out-of-range `TOKEN_NORM_CONTEXT_WARN`, a kill switch set to anything but `0`
  or `1`, an empty `TOKEN_NORM_CHEAP_TOOLS`, and unrecognized `TOKEN_NORM_*`
  keys. Values still fall back rather than failing the session.
- Handoff integration-test matrix: child-session events, a late `session.created`,
  the settle floor, `appendPrompt`/`submitPrompt` failures, and concurrent
  handoffs.

### Changed

- `TOKEN_NORM_SETTLE_MS` and `TOKEN_NORM_SWITCH_WAIT_MS` are read in `config.ts`
  like every other setting, so they are validated and diagnosed too.
- The opencode client and event payloads are no longer typed as `any`. `src/host.ts`
  declares narrow interfaces covering only the host fields this plugin actually
  reads, so a renamed or removed host method now fails at build time instead of
  disappearing into a runtime catch.

### Fixed

- `session.deleted` events missing `info.id`, and user messages missing
  `sessionID`, no longer throw into the event handler's catch-all (which also
  skipped handoff arming and the task-boundary check for that event).

## [0.7.2] - 2026-09-11

### Fixed

- Deleted-session suppression survives eviction: an id evicted from the bounded
  deleted window could be resurrected by a late `step-finish`, re-counting spend
  already folded into its parent. Deleted ids are now also recorded in a
  fixed-size filter with no false negatives, and a live-entry check lets a
  restarted `session.created` through. Adds the seeded usage-ledger invariant
  suite (`test/budget-state.invariants.test.ts`) covering the eviction
  regression.

## [0.7.1] - 2026-09-11

### Added

- Event-order tests for the budget plugin (`test/event-order.test.ts`): reminder
  priority within a single call (boundary > announce > audit, each suppressed
  reminder deferred to the next call), boundary injection points across an
  interleaved event stream, counter and step-usage alignment through
  `token_norm_status`, and handoff arming order (a pause before pressure does
  not arm; a pause after pressure does).

## [0.7.0] - 2026-09-11

### Added

- Medium and long benchmark fixtures (`03-many-bugs`, `04-long-sweep`), per-call
  timing metrics (`gap`, `exec`) in the harness, and the pilot 2 write-up with a
  provider-free latency microbench in `docs/benchmark.md`.

### Changed

- `token_norm_status` now labels its scopes: `budget` (`toolCalls`, `cost`,
  `effectiveTokens`) rolls up the session tree, while `session.context` is the
  current session's window. The JSON shape changed accordingly:
  `session.toolCalls` moved to `budget.toolCalls`, and both groups carry a
  `scope` field, so the tree rollup is no longer ambiguous.
- The status provider is injected per plugin instance via
  `createStatusTool(provider)` instead of a module-global registry, so two
  plugin instances in one process can no longer shadow each other's reader.

## [0.6.0] - 2026-09-11

### Added

- `token_norm_status`: a read-only tool that reports the session's tool calls,
  context usage, cost and effective tokens against the configured limits, plus
  the `continue | warn | handoff | block` recommendation enforcement would give
  right now. It reads the same accumulators as the reminders, so the two cannot
  disagree; unknown sessions report zeros, and the tool is absent when the
  budget plugin is not loaded.
- Benchmark harness (`bench/run.mjs`) with two fixture tasks, plus the pilot
  methodology and results write-up in `docs/benchmark.md`.

## [0.5.3] - 2026-09-11

### Fixed

- Child-session rollups no longer stop at a fixed 20-level depth: `rootOf`
  walks parent links to the true root, with a cycle guard instead of a cap.
- `session.deleted` aggregates instead of tombstoning: the deleted session's
  totals fold into its parent and the entry is dropped, so a long-lived server
  keeps no ledger entry per deleted session. Live children reparent to the
  grandparent, and a bounded window of deleted ids still swallows late events.
- Documented that the model context-limit cache lives for the process: provider
  config changes need a restart or `TOKEN_NORM_CONTEXT_LIMIT`.

## [0.5.2] - 2026-09-11

### Fixed

- `handoff` disarms its session-switch waiter on every exit path, not just the
  timeout: a thrown `executeCommand` or any other error now clears it via
  `try/finally`, so a late `session.created` can no longer satisfy a stale
  resolver and clear the next handoff's waiter before its own session exists.
- README no longer claims the plugin "adds no advice"; the accurate claim is
  that it does not rely on agent-authored advice as its enforcement mechanism.

## [0.5.1] - 2026-09-11

### Fixed

- `session.deleted` no longer un-spends the subtree: the session retires to a
  totals-only tombstone (linkage kept, history/detail freed) so root rollups
  and `block` enforcement keep counting real spend. Live grandchildren stay
  reachable through the tombstone. Late step/tool events for a deleted session
  are ignored instead of double-counting.
- README/design no longer claim the plugin never blocks: default never blocks,
  `block` mode is opt-in. Node row now matches the CI matrix (22, 24).

## [0.5.0] - 2026-09-11

### Added

- Measured budgets from provider `step-finish` events (cost, input/output/cache tokens), not just tool-call counts: `TOKEN_NORM_MAX_COST`, `TOKEN_NORM_MAX_EFFECTIVE_TOKENS`, `TOKEN_NORM_MAX_TOOL_CALLS`, and `TOKEN_NORM_CONTEXT_LIMIT`. The first crossing of each metric staples a status block onto tool output; cost/tokens/calls roll up across subagent sessions.
- `TOKEN_NORM_MODE` enforcement modes: `warn` (default, injects the status block), `observe` (logs crossings only, injects nothing), `handoff` (adds a skeleton at the next pause once over budget), and `block` (opt-in; refuses non-cheap tool calls while over budget — cheap tools and `handoff` stay available as the escape hatch).
- Context pressure: current window relative to the model's context limit, resolved from the client's provider config or overridden with `TOKEN_NORM_CONTEXT_LIMIT`; threshold `TOKEN_NORM_CONTEXT_WARN` (default `0.8`).
- Handoff recommendations include estimated attribution from output bytes (top tools, repeated reads, images) and touched files pre-filled from edit/write/patch tool args.

## [0.4.1] - 2026-09-11

### Fixed

- `handoff` no longer treats an untimed `session.created` event as the fresh session: events whose `time.created` is not a number are rejected as unverifiable, and the bounded timeout fallback still appends. Fixes a race where the handoff note could be appended to the wrong session.

### Added

- `docs/compatibility.md`: per-build compatibility matrix and runtime assumptions, linked from the README and smoke-test docs.

### Changed

- README: troubleshoot the one-command install — the npx-from-a-repo-clone resolution gotcha, offline/global fallbacks, and post-restart checks.

## [0.4.0] - 2026-09-10

### Added

- One-command install: `npx opencode-token-norm` copies a self-contained plugin bundle and the audit script into `~/.config/opencode/`; `npx opencode-token-norm uninstall` removes them. It installs as a local plugin file because OpenCode builds ≥ 1.17 can silently skip npm-spec plugins ([opencode#48379](https://github.com/anomalyco/opencode/issues/48379)); verified end to end on 1.18.30.
- `npm run install:local` for development checkouts: rebuilds the bundle and reinstalls it.

### Changed

- README install is the one-command `npx` flow. `opencode plugin opencode-token-norm --global` is documented as equivalent once npm-spec loading is fixed.

## [0.3.0] - 2026-09-10

### Changed

- `handoff` now submits the fresh session by default. The new session opens with the handoff note pre-filled in the prompt, so the user only has to press enter. Pass `submit: false` to keep the prompt unsubmitted.

## [0.2.1] - 2026-09-10

### Fixed

- `usage-audit.py` is now scoped to the current session when invoked by the plugin, and handles XDG paths and cost output correctly.

### Added

- Single-command install documented in the README.
- Demo recording tooling and assets under `docs/`.
- Sample session receipt in the README.

## [0.2.0] - 2026-09-10

### Added

- Shareable session receipt in `usage-audit.py`.
- Marketing and positioning docs.

## [0.1.0] - 2026-09-09

### Added

- Initial release: `TokenNormBudget`, which counts tool calls and staples reminders at thresholds, and `TokenNormHandoff`, which collapses the session split into a single tool call.

[Unreleased]: https://github.com/salitaba/opencode-token-norm/compare/v0.7.2...HEAD
[0.7.2]: https://github.com/salitaba/opencode-token-norm/compare/v0.7.1...v0.7.2
[0.7.1]: https://github.com/salitaba/opencode-token-norm/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/salitaba/opencode-token-norm/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/salitaba/opencode-token-norm/compare/v0.5.3...v0.6.0
[0.5.3]: https://github.com/salitaba/opencode-token-norm/compare/v0.5.2...v0.5.3
[0.5.2]: https://github.com/salitaba/opencode-token-norm/compare/v0.5.1...v0.5.2
[0.5.1]: https://github.com/salitaba/opencode-token-norm/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/salitaba/opencode-token-norm/compare/v0.4.1...v0.5.0
[0.4.1]: https://github.com/salitaba/opencode-token-norm/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/salitaba/opencode-token-norm/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/salitaba/opencode-token-norm/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/salitaba/opencode-token-norm/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/salitaba/opencode-token-norm/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/salitaba/opencode-token-norm/releases/tag/v0.1.0
