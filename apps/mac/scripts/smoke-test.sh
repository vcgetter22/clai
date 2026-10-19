#!/usr/bin/env bash
# Checks a packaged clai.app the way a user's Mac would run it: the embedded Node starts the
# bundled engine, a scan of a sample Claude Code transcript produces a snapshot, and the app
# itself launches and draws its panel. Run after package.sh on a Mac whose CPU matches ARCH.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
MAC="$ROOT/apps/mac"
OUT="${OUT:-$MAC/build}"
ARCH="${ARCH:-$(uname -m | sed 's/x86_64/x64/')}"
APP="$OUT/$ARCH/clai.app"
NODE="$APP/Contents/Helpers/node"
ENGINE="$APP/Contents/Resources/engine/clai.mjs"
VERSION="$(node -p "require('$ROOT/apps/cli/package.json').version")"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Run a command with a time limit (macOS has no `timeout`).
limit() { perl -e 'alarm shift; exec @ARGV' "$@"; }

echo "app: $APP"
file "$NODE" "$APP/Contents/MacOS/clai"
codesign --verify --deep --strict "$APP"
codesign -dv "$APP" 2>&1 | grep -E "Identifier|Signature|TeamIdentifier" || true

echo "engine version"
got="$(limit 30 "$NODE" --disable-warning=ExperimentalWarning "$ENGINE" --version)"
[[ "$got" == "$VERSION" ]] || { echo "expected $VERSION, got $got"; exit 1; }

echo "scan a sample Claude Code transcript"
mkdir -p "$WORK/home/.claude/projects/-Users-me-clai"
node -e '
const lines = [];
for (let i = 0; i < 4; i++) lines.push(JSON.stringify({ type: "assistant", sessionId: "s1", cwd: "/Users/me/clai", timestamp: new Date(Date.now() - i * 600e3).toISOString(), requestId: "req_" + i,
  message: { id: "msg_" + i, model: "claude-opus-5", role: "assistant", type: "message", content: [{ type: "text", text: "x" }],
    usage: { input_tokens: 1000, output_tokens: 2000, cache_read_input_tokens: 300000, cache_creation_input_tokens: 20000, cache_creation: { ephemeral_1h_input_tokens: 20000, ephemeral_5m_input_tokens: 0 } } } }));
require("fs").writeFileSync(process.argv[1], lines.join("\n") + "\n");
' "$WORK/home/.claude/projects/-Users-me-clai/s1.jsonl"
HOME="$WORK/home" CLAI_HOME="$WORK/clai" limit 60 "$NODE" --disable-warning=ExperimentalWarning "$ENGINE" snapshot --scan > "$WORK/snapshot.json"
node -e '
const s = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
const found = s.scan.sources.filter((x) => x.found).map((x) => x.id);
console.log(JSON.stringify({ schema: s.schema, events: s.events.total, today: s.today.usd, month: s.month.usd, found, watch: s.scan.watchPaths }));
if (s.schema !== 1 || s.events.total !== 4 || !(s.today.usd > 0) || !found.includes("claude-code")) process.exit(1);
' "$WORK/snapshot.json"

echo "app draws its panel (sample data, offscreen)"
limit 90 "$APP/Contents/MacOS/clai" --render "$OUT/screens"
ls -la "$OUT/screens"
test -s "$OUT/screens/panel-light.png"
test -s "$OUT/screens/panel-dark.png"

echo "app starts against the sample home and stays up"
HOME="$WORK/home" CLAI_HOME="$WORK/clai" "$APP/Contents/MacOS/clai" > "$WORK/app.log" 2>&1 &
pid=$!
sleep 8
if ! kill -0 "$pid" 2>/dev/null; then
  echo "clai exited early:"; cat "$WORK/app.log"; exit 1
fi
kill "$pid"
wait "$pid" 2>/dev/null || true
echo "smoke test passed"
