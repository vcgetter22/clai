#!/usr/bin/env bash
# Best-effort screenshots of the real app on a CI Mac (needs a logged-in GUI session and screen
# capture permission, which GitHub's macOS runners usually have): the panel in a window with
# real materials, and the whole screen with the panel open from the menu bar.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
OUT="${OUT:-$ROOT/apps/mac/build}"
ARCH="${ARCH:-$(uname -m | sed 's/x86_64/x64/')}"
APP="$OUT/$ARCH/clai.app"
SHOTS="$OUT/screens"
mkdir -p "$SHOTS"

for appearance in light dark; do
  if [[ "$appearance" == dark ]]; then
    osascript -e 'tell application "System Events" to tell appearance preferences to set dark mode to true' || true
  else
    osascript -e 'tell application "System Events" to tell appearance preferences to set dark mode to false' || true
  fi
  "$APP/Contents/MacOS/clai" --window --demo > "$SHOTS/window-$appearance.log" 2>&1 &
  pid=$!
  sleep 6
  wid="$(grep -o 'CLAI_WINDOW_ID=[0-9]*' "$SHOTS/window-$appearance.log" | cut -d= -f2 | head -1)"
  if [[ -n "$wid" ]]; then
    screencapture -x -o -l"$wid" "$SHOTS/window-$appearance.png" || true
  fi
  kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null

  "$APP/Contents/MacOS/clai" --demo --open-panel > "$SHOTS/menubar-$appearance.log" 2>&1 &
  pid=$!
  sleep 7
  screencapture -x "$SHOTS/screen-$appearance.png" || true
  kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null
done
osascript -e 'tell application "System Events" to tell appearance preferences to set dark mode to false' || true
ls -la "$SHOTS"
