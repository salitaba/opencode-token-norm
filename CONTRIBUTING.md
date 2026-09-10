# Contributing

Thanks for taking the time to contribute to opencode-token-norm.

## Development setup

Requires Node.js 22 or newer.

```bash
git clone https://github.com/salitaba/opencode-token-norm.git
cd opencode-token-norm
npm install
npm run build
```

- `npm run typecheck` type-checks without emitting.
- `npm test` runs the Vitest suite: threshold reminders, boundary dedupe, and handoff semantics.
- `npm run build` emits `dist/` (gitignored; CI builds it on release).

## Project layout

| Path | Contents |
| --- | --- |
| `src/index.ts` | Plugin entrypoint and exports |
| `src/session-budget.ts` | Tool-call counting and threshold reminders |
| `src/handoff.ts` | The `handoff` tool |
| `src/audit.ts` | Usage audit integration |
| `src/config.ts`, `src/log.ts` | Config and logging helpers |
| `scripts/usage-audit.py` | Session usage/cost audit |
| `test/` | Vitest regression tests for thresholds, boundaries, and handoff |
| `docs/RELEASING.md` | Release process (maintainers) |

## Making changes

1. Fork the repo and create a branch from `main`.
2. Keep each pull request focused on one change.
3. Follow the existing commit style: `feat:`, `fix:`, `docs:`, `chore:`.
4. Run `npm run typecheck`, `npm test`, and `npm run build` before opening a pull request.
5. Add user-facing changes to `CHANGELOG.md` under `## [Unreleased]`; maintainers move them into a version section at release time.
6. Describe how you tested the change in OpenCode (see the install section of the README).

## Reporting issues

Use the issue templates. For security vulnerabilities, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.
