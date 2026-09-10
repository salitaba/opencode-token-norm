#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEMO="$ROOT/demo"
WORK="$DEMO/.work"
RUN="$WORK/run"
HOME_DIR="$WORK/home"
ASSETS="$ROOT/docs/assets"
VHS_VERSION="${VHS_VERSION:-v0.12.0}"
VHS_BIN="${VHS_BIN:-$WORK/bin/vhs}"

SS="${SS:-auto}"       # seconds to skip at the start; "auto" = first frame with content
DUR="${DUR:-37}"       # seconds of footage to export (covers the demo through the handoff)
SPEED="${SPEED:-0.5}"  # 0.5 = 2x playback in the exported assets

# First frame with sustained bright text (YMAX >= 200 for 3 samples at 4fps),
# skipping the startup splash: only content after 5s counts. Prints seconds or nothing.
detect_ss() {
  ffmpeg -v error -i "$1" -vf "fps=4,signalstats,metadata=print:file=-" -f null - 2>/dev/null |
    awk '
      /^frame:/ { t = $3; sub(/^pts_time:/, "", t); t += 0 }
      /YMAX=/   { split($0, a, "="); if (a[2] + 0 >= 200 && t >= 5) { if (run == 0) first = t; run++; if (run >= 3) { print first; exit } } else run = 0 }
    ' || true
}

for tool in go git npm ffmpeg ttyd; do
  if ! command -v "$tool" >/dev/null; then
    echo "missing required tool: $tool" >&2
    if [ "$tool" = ttyd ]; then
      echo "vhs needs ttyd on PATH (e.g. apt install ttyd, brew install ttyd)" >&2
    fi
    exit 1
  fi
done

echo "==> building plugin (npm run build)"
(cd "$ROOT" && npm run build)

echo "==> staging isolated HOME and demo app"
rm -rf "$RUN"
mkdir -p "$RUN" "$HOME_DIR/.config/opencode" "$HOME_DIR/.local/share/opencode"
cp -R "$DEMO/app" "$RUN/app"
ln -sfn "$ROOT/dist/index.js" "$RUN/app/.opencode/plugins/token-norm.js"
cp "$DEMO/nested-home/.config/opencode/opencode.json" "$HOME_DIR/.config/opencode/opencode.json"

AUTH="${OPENCODE_AUTH:-$HOME/.local/share/opencode/auth.json}"
if [ ! -f "$AUTH" ]; then
  echo "opencode auth not found: $AUTH" >&2
  echo "run 'opencode auth login' or set OPENCODE_AUTH=/path/to/auth.json" >&2
  exit 1
fi
cp "$AUTH" "$HOME_DIR/.local/share/opencode/auth.json"
cleanup() { rm -f "$HOME_DIR/.local/share/opencode/auth.json"; }
trap cleanup EXIT

if [ ! -d "$HOME_DIR/.config/opencode/node_modules" ]; then
  echo "==> warming opencode runtime (first run only, ~1 min)"
  if command -v script >/dev/null; then
    (cd "$RUN/app" && HOME="$HOME_DIR" timeout -k 10 60 script -qec "opencode" /dev/null >/dev/null 2>&1 || true)
  else
    echo "warning: 'script' not found; first on-screen boot may be slow" >&2
  fi
fi

if [ ! -x "$VHS_BIN" ]; then
  echo "==> building patched vhs $VHS_VERSION"
  mkdir -p "$WORK/bin"
  if [ ! -d "$WORK/vhs-src/.git" ]; then
    rm -rf "$WORK/vhs-src"
    git clone --depth 1 --branch "$VHS_VERSION" https://github.com/charmbracelet/vhs "$WORK/vhs-src"
  fi
  if ! grep -q "v.Render(context.Background())" "$WORK/vhs-src/evaluator.go"; then
    (cd "$WORK/vhs-src" && patch -p1 < "$DEMO/vhs-v0.12.0-render-ctx.patch")
  fi
  (cd "$WORK/vhs-src" && go build -o "$VHS_BIN" .)
fi

echo "==> recording (this takes a few minutes)"
export HOME="$HOME_DIR"
export TOKEN_NORM_ANNOUNCE_AT="${TOKEN_NORM_ANNOUNCE_AT:-4}"
export TOKEN_NORM_BOUNDARY_AT="${TOKEN_NORM_BOUNDARY_AT:-6}"
export TOKEN_NORM_AUDIT_EVERY="${TOKEN_NORM_AUDIT_EVERY:-6}"
(cd "$RUN" && "$VHS_BIN" "$DEMO/record.tape")

if [ "$SS" = auto ]; then
  DETECTED="$(detect_ss "$RUN/take.mp4")"
  if [ -n "$DETECTED" ]; then
    SS="$DETECTED"
    echo "==> auto-detected content start at ${SS}s"
  else
    echo "warning: no content detected; exporting from 0s" >&2
    SS=0
  fi
fi

echo "==> exporting docs/assets/token-norm-demo.{mp4,gif}"
mkdir -p "$ASSETS"
ffmpeg -y -ss "$SS" -i "$RUN/take.mp4" -t "$DUR" \
  -c:v libx264 -crf 20 -preset slow -pix_fmt yuv420p -movflags +faststart \
  "$ASSETS/token-norm-demo.mp4"
ffmpeg -y -ss "$SS" -t "$DUR" -i "$RUN/take.mp4" \
  -vf "setpts=${SPEED}*PTS,fps=12,scale=900:-1:flags=lanczos,palettegen=max_colors=64:stats_mode=diff" \
  "$RUN/palette.png"
ffmpeg -y -ss "$SS" -t "$DUR" -i "$RUN/take.mp4" -i "$RUN/palette.png" \
  -lavfi "setpts=${SPEED}*PTS,fps=12,scale=900:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=none" \
  "$ASSETS/token-norm-demo.gif"

ls -lh "$ASSETS/token-norm-demo.gif" "$ASSETS/token-norm-demo.mp4"
