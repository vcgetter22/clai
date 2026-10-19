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

# The real data path: the app runs its bundled engine against a sample home with three weeks of
# Claude Code transcripts, then an empty home for the first-run view.
WORK="$(mktemp -d)"
node -e '
const fs = require("fs"), path = require("path");
const home = process.argv[1];
for (const [project, scale] of [["clai", 1], ["site", 0.4]]) {
  const dir = path.join(home, ".claude/projects/-Users-me-" + project);
  fs.mkdirSync(dir, { recursive: true });
  const lines = [];
  for (let d = 0; d < 21; d++) {
    for (let r = 0; r < 6; r++) {
      const ts = new Date(Date.now() - d * 86400e3 - r * 1800e3);
      const id = project + "-" + d + "-" + r;
      lines.push(JSON.stringify({ type: "assistant", sessionId: project + "-" + d, cwd: "/Users/me/" + project, timestamp: ts.toISOString(), requestId: "req_" + id,
        message: { id: "msg_" + id, model: r % 3 === 0 ? "claude-sonnet-5" : "claude-opus-5", role: "assistant", type: "message", content: [{ type: "text", text: "x" }],
          usage: { input_tokens: Math.round(3000 * scale), output_tokens: Math.round(9000 * scale), cache_read_input_tokens: Math.round(900000 * scale), cache_creation_input_tokens: Math.round(40000 * scale), cache_creation: { ephemeral_1h_input_tokens: Math.round(40000 * scale), ephemeral_5m_input_tokens: 0 } } } }));
    }
  }
  fs.writeFileSync(path.join(dir, "session.jsonl"), lines.join("\n") + "\n");
}
' "$WORK/home"
mkdir -p "$WORK/empty"
for kind in live welcome; do
  home="$WORK/home"; [[ "$kind" == welcome ]] && home="$WORK/empty"
  HOME="$home" CLAI_HOME="$WORK/clai-$kind" "$APP/Contents/MacOS/clai" --open-panel > "$SHOTS/$kind.log" 2>&1 &
  pid=$!
  sleep 14
  screencapture -x "$SHOTS/screen-$kind.png" || true
  kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null
done
rm -rf "$WORK"
ls -la "$SHOTS"
