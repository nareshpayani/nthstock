#!/usr/bin/env bash
# Records the walkthrough videos (docs/runbooks/demo-walkthrough.md) and writes each one to
# apps/web/public/demo/<clip>.mp4, which the site serves at /demo/<clip>.mp4: the TFC-1 demo
# walkthrough on a phone (T30, SPEC-TFC-1 §16, REQ-DEL-04) and one clip per feature (NSTOCK-0390),
# each with a WebVTT captions track (<clip>.vtt) and a poster frame (<clip>.jpg).
#
#   bash tools/demo/recordWalkthrough.sh                       # every clip, production build
#   bash tools/demo/recordWalkthrough.sh -g "orderTicket|amo"  # only the clips whose id matches
#   bash tools/demo/recordWalkthrough.sh https://nthstock-a13a5.web.app -g walkthrough
#                                                              # the T30 take, on the live site
#
# With no URL it builds the web app as the Firebase deploy does (msw mode, market open), plus the
# invisible MSW test controls, so the after-market clip can move the clock to the next morning.
# It serves the build with `vite preview`. Needs ffmpeg for the H.264 encode (iPhone Safari plays
# H.264; Playwright records WebM).
set -euo pipefail
cd "$(dirname "$0")/../../apps/web"

base_url=""
grep_args=()
while [ $# -gt 0 ]; do
  case "$1" in
    -g | --grep) grep_args=(--grep "$2"); shift 2 ;;
    *) base_url="$1"; shift ;;
  esac
done

preview_pid=""
cleanup() { [ -n "$preview_pid" ] && kill "$preview_pid" 2>/dev/null || true; }
trap cleanup EXIT

if [ -z "$base_url" ]; then
  VITE_API_MODE=msw VITE_MOCK_MARKET_OPEN=true VITE_TEST_CONTROLS=true \
    npx vite build --outDir dist-e2e-walkthrough --emptyOutDir
  # A stale server on 4180 would make this preview exit and the clips record the old build.
  preview_log=test-results/walkthrough-preview.log
  mkdir -p test-results
  npx vite preview --outDir dist-e2e-walkthrough --host 127.0.0.1 --port 4180 --strictPort \
    >"$preview_log" 2>&1 &
  preview_pid=$!
  for _ in $(seq 1 30); do
    kill -0 "$preview_pid" 2>/dev/null || { cat "$preview_log" >&2; echo "vite preview exited" >&2; exit 1; }
    curl -sf -o /dev/null http://127.0.0.1:4180/login && break
    sleep 1
  done
  curl -sf -o /dev/null http://127.0.0.1:4180/login || { echo "vite preview did not start" >&2; exit 1; }
  base_url="http://127.0.0.1:4180"
fi

clips=test-results/walkthrough/clips
rm -rf test-results/walkthrough
# A clip that fails is reported but does not stop the others from being encoded.
WALKTHROUGH_BASE_URL="$base_url" npx playwright test -c playwright.walkthrough.config.ts \
  "${grep_args[@]}" || status=$?
compgen -G "$clips/*.webm" >/dev/null || { echo "no clip recorded under $clips" >&2; exit 1; }
mkdir -p public/demo
for video in "$clips"/*.webm; do
  name="$(basename "$video" .webm)"
  ffmpeg -v error -y -i "$video" -c:v libx264 -preset slow -crf 28 -pix_fmt yuv420p \
    -movflags +faststart -an "public/demo/$name.mp4"
  # The captions track, and a poster frame from 40% in for the guide's player.
  [ -f "$clips/$name.vtt" ] || { echo "$name has no captions track ($clips/$name.vtt)" >&2; exit 1; }
  cp "$clips/$name.vtt" "public/demo/$name.vtt"
  duration="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "public/demo/$name.mp4")"
  ffmpeg -v error -y -ss "$(awk -v d="$duration" 'BEGIN { print d * 0.4 }')" -i "public/demo/$name.mp4" \
    -frames:v 1 -vf scale=720:-2 -q:v 5 "public/demo/$name.jpg"
  awk -v name="$name" -v d="$duration" 'BEGIN { printf "public/demo/%s.mp4: %.0f s\n", name, d }'
done
exit "${status:-0}"
