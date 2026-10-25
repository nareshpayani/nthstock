#!/usr/bin/env bash
# Records the TFC-1 demo walkthrough video (T30, SPEC-TFC-1 §16, REQ-DEL-04) and writes it to
# apps/web/public/demo/walkthrough.mp4, which the site serves at /demo/walkthrough.mp4.
#
#   bash tools/demo/recordWalkthrough.sh                 # the production build, served locally
#   bash tools/demo/recordWalkthrough.sh https://nthstock-a13a5.web.app   # the live site
#
# With no URL it builds the web app exactly as the Firebase deploy does (msw mode, market open, no
# test controls) and serves it with `vite preview`. Needs ffmpeg for the H.264 encode (iPhone Safari
# plays H.264; Playwright records WebM).
set -euo pipefail
cd "$(dirname "$0")/../../apps/web"

base_url="${1:-}"
preview_pid=""
cleanup() { [ -n "$preview_pid" ] && kill "$preview_pid" 2>/dev/null || true; }
trap cleanup EXIT

if [ -z "$base_url" ]; then
  VITE_API_MODE=msw VITE_MOCK_MARKET_OPEN=true npx vite build --outDir dist-e2e-walkthrough --emptyOutDir
  npx vite preview --outDir dist-e2e-walkthrough --host 127.0.0.1 --port 4180 --strictPort >/dev/null 2>&1 &
  preview_pid=$!
  for _ in $(seq 1 30); do curl -sf -o /dev/null http://127.0.0.1:4180/login && break; sleep 1; done
  curl -sf -o /dev/null http://127.0.0.1:4180/login || { echo "vite preview did not start" >&2; exit 1; }
  base_url="http://127.0.0.1:4180"
fi

rm -rf test-results/walkthrough
WALKTHROUGH_BASE_URL="$base_url" npx playwright test -c playwright.walkthrough.config.ts
video="$(find test-results/walkthrough -name '*.webm' | head -n 1)"
[ -n "$video" ] || { echo "no video recorded under test-results/walkthrough" >&2; exit 1; }
mkdir -p public/demo
ffmpeg -v error -y -i "$video" -c:v libx264 -preset slow -crf 23 -pix_fmt yuv420p \
  -movflags +faststart -an public/demo/walkthrough.mp4
ffprobe -v error -show_entries format=duration -of csv=p=0 public/demo/walkthrough.mp4 |
  awk '{ printf "public/demo/walkthrough.mp4: %.0f s\n", $1 }'
