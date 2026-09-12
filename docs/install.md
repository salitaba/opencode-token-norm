# Install

```sh
npx opencode-token-norm
```

Restart OpenCode. That is the whole install — the command copies a self-contained
build into `~/.config/opencode/plugins/` and the audit script into
`~/.config/opencode/scripts/`. Uninstall with `npx opencode-token-norm uninstall`.

To see exactly which paths would be written before anything is, add `--dry-run`
(it also works on `uninstall`):

```console
$ npx opencode-token-norm --dry-run
Token Norm install plan

  plugin       create  ~/.config/opencode/plugins/opencode-token-norm.js
  audit script create  ~/.config/opencode/scripts/usage-audit.py

No files outside ~/.config/opencode are created, modified, or removed.
Nothing is added to your shell profile, PATH, or opencode config.

--dry-run: nothing was written.
```

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
`doctor` answers the question directly:

```console
$ npx opencode-token-norm doctor
Token Norm doctor

  ✓ node              22.14.0
  ✓ opencode          1.18.30
  ✓ package bundle    0.11.0 at .../dist/plugin.js
  ✓ plugin installed  ~/.config/opencode/plugins/opencode-token-norm.js (matches this package)
  ✓ audit script      ~/.config/opencode/scripts/usage-audit.py
  ✓ settings          mode=warn, announce@25 boundary@40 audit@60
  ✓ python3           Python 3.12.3
  ✓ opencode db       ~/.local/share/opencode/opencode.db (read-only access)
  ✓ config            no duplicate plugin registration

Status: ready
```

It exits non-zero only when the plugin is **not working** — a missing bundle, a
Node too old, no plugin installed. Everything you may have chosen on purpose is a
warning that still exits 0: no `python3` (audits skipped, nothing else affected),
no OpenCode on `PATH`, no DB yet. Two checks are worth knowing about:

- **`plugin installed … matches this package`** compares the sha256 of the
  installed file against the bundle in the package. A copied loose file has no
  registry integrity story behind it, so this is the only way to tell a current
  install from a stale one left by an older version. `differs from this package`
  means rerun the install to update.
- **`settings`** is read through the plugin's own config parser, not a second copy
  of the key list, so it reports the same rejections and typo warnings the plugin
  will actually apply — including `TOKEN_NORM_*` keys that are not real settings.

Thresholds are also logged; an empty log after a short session means nothing
crossed one, not that the plugin is missing:

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
- Nothing appears after a restart — run `npx opencode-token-norm doctor` first; it
  checks the installed file, the audit script, your settings and the duplicate
  registration in one pass. If it reports `Status: ready`, work through the
  [smoke test](smoke-test.md).
- Developing on the plugin itself? After `npm run build`,
  `npm run install:local` rebuilds the bundle and reinstalls it.

## Turning it off

No uninstall needed. `TOKEN_NORM_BUDGET=0` disables the counting half;
`TOKEN_NORM_HANDOFF=0` drops the `handoff` tool. Restart to apply. The full list
of switches is in [configuration.md](configuration.md).
