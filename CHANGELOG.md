# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/salitaba/opencode-token-norm/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/salitaba/opencode-token-norm/compare/v0.4.1...v0.5.0
[0.4.1]: https://github.com/salitaba/opencode-token-norm/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/salitaba/opencode-token-norm/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/salitaba/opencode-token-norm/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/salitaba/opencode-token-norm/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/salitaba/opencode-token-norm/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/salitaba/opencode-token-norm/releases/tag/v0.1.0
