#!/usr/bin/env bash
# Checks the packaged app on this Mac: a universal, signed bundle for macOS 13 and later; a report
# from sample logs with the expected total; the ledger it writes; the status line command; a launch
# that stays up; and the offscreen render of the panel.
#
#   apps/mac/scripts/build-app.sh && apps/mac/scripts/smoke-test.sh
set -euo pipefail

MAC="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${OUT:-$MAC/build}"
APP="${APP:-$OUT/clai.app}"
BIN="$APP/Contents/MacOS/clai"

fail() { echo "smoke test failed: $*" >&2; exit 1; }
step() { printf '\n--- %s\n' "$*"; }

step "Bundle"
archs="$(lipo -archs "$BIN")"
echo "architectures: $archs"
[[ "$archs" == *arm64* && "$archs" == *x86_64* ]] || fail "expected arm64 and x86_64, got $archs"
codesign --verify --deep --strict "$APP" || fail "signature does not verify"
[[ "$(/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$APP/Contents/Info.plist")" == "io.github.vcgetter22.clai" ]] || fail "bundle id"
[[ "$(/usr/libexec/PlistBuddy -c 'Print LSUIElement' "$APP/Contents/Info.plist")" == "true" ]] || fail "LSUIElement"
vtool -show-build "$BIN" | grep -E 'minos 13\.0' >/dev/null || fail "minimum macOS is not 13.0"
test -s "$APP/Contents/Resources/AppIcon.icns" || fail "no icon"

step "Sample logs"
HOME_DIR="$(mktemp -d)"
trap 'rm -rf "$HOME_DIR"' EXIT
NOW="$(date -u -v-2M +%Y-%m-%dT%H:%M:%S.000Z)"
mkdir -p "$HOME_DIR/.claude/projects/-Users-me-project" "$HOME_DIR/.codex/sessions/2026/10/30"
# Claude Code: one Opus 4.6 request with 1M uncached input tokens ($5.00), written twice (streamed).
line='{"type":"assistant","timestamp":"'"$NOW"'","sessionId":"s","requestId":"req_1","message":{"id":"msg_1","model":"claude-opus-4-6","content":[{"type":"text","text":"..."}],"usage":{"input_tokens":1000000,"output_tokens":0,"cache_read_input_tokens":0,"cache_creation_input_tokens":0}}}'
printf '%s\n%s\n' "$line" "$line" > "$HOME_DIR/.claude/projects/-Users-me-project/s.jsonl"
# Codex: one GPT-5.2-Codex response with 1M uncached input tokens ($1.75).
{
  echo '{"timestamp":"'"$NOW"'","type":"turn_context","payload":{"model":"gpt-5.2-codex"}}'
  echo '{"timestamp":"'"$NOW"'","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":1000000,"cached_input_tokens":0,"output_tokens":0,"total_tokens":1000000},"last_token_usage":{"input_tokens":1000000,"cached_input_tokens":0,"output_tokens":0,"total_tokens":1000000}}}}'
} > "$HOME_DIR/.codex/sessions/2026/10/30/rollout-2026-10-30T09-00-00-0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b.jsonl"

step "Report"
report="$(CLAI_HOME="$HOME_DIR" "$BIN" --report)"
echo "$report"
grep -q 'so far: \$6.75 API-equivalent' <<<"$report" || fail "expected \$6.75 this month"
grep -q 'Claude Code' <<<"$report" || fail "Claude Code missing"
grep -q 'Codex' <<<"$report" || fail "Codex missing"
test -s "$HOME_DIR/Library/Application Support/clai/ledger.json" || fail "the ledger was not written"

step "Status line"
# Claude Code runs `clai --status-line` with its status line JSON: clai saves the plan limits and
# prints what the user's own status line command prints.
SUPPORT="$HOME_DIR/Library/Application Support/clai"
mkdir -p "$SUPPORT"
printf '%s' '{"command":"clai --status-line","previous":"{\"type\":\"command\",\"command\":\"printf my-status-line\"}"}' > "$SUPPORT/claude-status-line.json"
status='{"model":{"id":"claude-opus-5-5"},"rate_limits":{"five_hour":{"used_percentage":23.5,"resets_at":1893456000},"seven_day":{"used_percentage":41.2,"resets_at":1893456000}}}'
out="$(printf '%s' "$status" | CLAI_HOME="$HOME_DIR" "$BIN" --status-line)"
[[ "$out" == "my-status-line" ]] || fail "the status line printed '$out'"
grep -q '"used":23.5' "$SUPPORT/claude-limits.json" || fail "the limits were not saved"
CLAI_HOME="$HOME_DIR" "$BIN" --report | grep -q 'Claude limits: 24% of 300 min' || fail "the report has no Claude limits"
echo "status line passed through, limits saved"

step "Launch"
CLAI_HOME="$HOME_DIR" "$BIN" &
pid=$!
sleep 8
kill -0 "$pid" 2>/dev/null || fail "the app quit or crashed after launch"
kill "$pid"
wait "$pid" 2>/dev/null || true
echo "stayed up for 8 seconds"

step "Render"
"$BIN" --render "$OUT/screens"
test -s "$OUT/screens/panel-light.png" || fail "no light render"
test -s "$OUT/screens/panel-dark.png" || fail "no dark render"

echo
echo "smoke test passed"
