#!/usr/bin/env bash
# Screenshots of the running app with sample data (CI uploads them): the panel under the menu bar
# item, and the window shown on the first launch.
set -uo pipefail

MAC="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${OUT:-$MAC/build}"
BIN="${APP:-$OUT/clai.app}/Contents/MacOS/clai"
mkdir -p "$OUT/screens"

shoot() {
  local name="$1"; shift
  "$BIN" --sample "$@" &
  local pid=$!
  sleep 5
  screencapture -x "$OUT/screens/$name.png" && echo "captured $name"
  kill "$pid" 2>/dev/null
  wait "$pid" 2>/dev/null
}

shoot screen-panel --open-panel
shoot screen-window --window
ls -la "$OUT/screens"
