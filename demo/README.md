# Demo recording

Regenerates the assets used by the project README:

- `docs/assets/token-norm-demo.gif`
- `docs/assets/token-norm-demo.mp4`

## Usage

```sh
npm install        # once
demo/regenerate.sh
```

Prerequisites on `PATH`: `node`/`npm`, `go`, `git`, `ffmpeg`, and `ttyd`
(`vhs` requires it). The script also needs an authenticated opencode: it copies
`~/.local/share/opencode/auth.json` into the throwaway recording HOME and
deletes that copy on exit. Override the source with `OPENCODE_AUTH=/path/to/auth.json`.
The auth file is never committed.

What the script does:

1. builds the plugin (`npm run build`) so `dist/index.js` exists;
2. stages `demo/app` into `demo/.work/run` with an isolated `HOME`
   (`demo/.work/home`, seeded from `demo/nested-home` + your `auth.json`) so the
   real global opencode config cannot interfere with the plugin. The first run
   also warms opencode's TUI runtime once (~1 min) so the recording starts fast;
3. clones and patches vhs `v0.12.0`, then builds `demo/.work/bin/vhs`
   (skip with `VHS_BIN=/path/to/vhs` if you already have a patched build);
4. records `demo/record.tape` (~4 minutes, then idle time is trimmed);
5. exports the MP4 and GIF into `docs/assets/`.

Export window and speed can be tuned with env vars. `SS=auto` samples the take
at 4fps and starts at the first sustained bright frame (skipping the startup
splash), so the exported assets never open on dead screen:

| Var | Default | Meaning |
| --- | --- | --- |
| `SS` | `auto` | seconds skipped at the start; `auto` detects the first content frame |
| `DUR` | `37` | seconds of footage exported (covers the demo through the handoff) |
| `SPEED` | `0.5` | playback speed factor (`0.5` = 2x in the assets) |

Tool-call thresholds are set on the recording shell via `TOKEN_NORM_ANNOUNCE_AT`
(4), `TOKEN_NORM_BOUNDARY_AT` (6) and `TOKEN_NORM_AUDIT_EVERY` (6), matching the
scenario in `demo/record.tape`.

## Why a patched vhs?

vhs `v0.12.0` cancels the render context during teardown and then calls
`v.Render(ctx)` (`evaluator.go:187`), so ffmpeg dies instantly; `Render` also
swallows the ffmpeg error and returns `nil` (`vhs.go`). The recording "succeeds"
with an empty output file.

`vhs-v0.12.0-render-ctx.patch` renders with a fresh `context.Background()` and
propagates the ffmpeg error. Remove the patch once upstream is fixed — check
`go list -m -versions github.com/charmbracelet/vhs`.
