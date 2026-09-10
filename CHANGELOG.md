# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `npm run install:local` (`scripts/install-local.mjs`): loads this package as a local OpenCode plugin. Workaround for OpenCode builds ≥ 1.17 that silently skip npm-spec plugins ([opencode#48379](https://github.com/anomalyco/opencode/issues/48379)); verified end to end on 1.18.30.

### Changed

- README: document the local-install fallback and the npm-spec compatibility caveat.

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

[Unreleased]: https://github.com/salitaba/opencode-token-norm/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/salitaba/opencode-token-norm/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/salitaba/opencode-token-norm/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/salitaba/opencode-token-norm/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/salitaba/opencode-token-norm/releases/tag/v0.1.0
