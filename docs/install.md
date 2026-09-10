# Install

```sh
npx opencode-token-norm
```

Restart OpenCode. That is the whole install — the command copies a self-contained
build into `~/.config/opencode/plugins/` and the audit script into
`~/.config/opencode/scripts/`. Uninstall with `npx opencode-token-norm uninstall`.

It installs as a local plugin file rather than an npm plugin entry because
OpenCode builds ≥ 1.17 can silently never initialize npm-spec plugins
([#48379](https://github.com/anomalyco/opencode/issues/48379)); once that is
fixed, `opencode plugin opencode-token-norm --global` is equivalent.

## Requirements

Requires Node ≥ 22 and an OpenCode build with plugin support.

| Component | Supported |
|---|---|
| OpenCode | V1 plugin API (`@opencode-ai/plugin` 1.x). Built against 1.18.x, requires ≥ 1.15.12. The V2 plugin API is not targeted yet |
| Node | ≥ 22 (CI tests 22, 24) |
| Python | 3.x, optional — audit checkpoint only |
| OS | Linux, macOS, Windows (CI) |

`python3` is only used for the audit checkpoint; without it nothing breaks — the
reminder still fires and tells the agent to run the audit itself.

Per-build verification results live in [compatibility.md](compatibility.md). The
unit suite mocks the OpenCode runtime, so that table is the real-world evidence
behind these claims.

## Check it loaded

Nothing surfaces until call 25, so a silent install looks like a working one.
Thresholds are logged; an empty log after a short session means nothing crossed
one, not that the plugin is missing:

```console
$ tail ~/.local/share/opencode/token-norm.log
2026-09-10T11:47:02.913Z ses_f75afcd6 announce-threshold at 25 calls (bash 14, read 9, grep 4)
```

## If it doesn't work

In order of likelihood:

- `sh: opencode-token-norm: not found` — you ran `npx` from inside a clone of
  this repo; npm resolves the local package name instead of downloading it. Run
  the command from any other directory.
- `npx` unavailable, or the registry is blocked — `npm i -g opencode-token-norm`
  then run `opencode-token-norm`, or `npm i opencode-token-norm` in a project and
  run `npx opencode-token-norm` from there.
- Nothing appears after a restart — confirm
  `~/.config/opencode/plugins/opencode-token-norm.js` exists, then work through
  the [smoke test](smoke-test.md). If `opencode.json` still lists
  `opencode-token-norm` under `plugin`, remove that entry — a future fixed
  runtime would otherwise load it twice.
- Developing on the plugin itself? After `npm run build`,
  `npm run install:local` rebuilds the bundle and reinstalls it.

## Turning it off

No uninstall needed. `TOKEN_NORM_BUDGET=0` disables the counting half;
`TOKEN_NORM_HANDOFF=0` drops the `handoff` tool. Restart to apply. The full list
of switches is in [configuration.md](configuration.md).
