#!/usr/bin/env bash
# Screenshots of the running app (CI uploads them): the panel and Settings with sample data, the
# window shown on the first launch, and the panel of a Mac without any AI tool logs.
set -uo pipefail

MAC="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${OUT:-$MAC/build}"
BIN="${APP:-$OUT/clai.app}/Contents/MacOS/clai"
mkdir -p "$OUT/screens"

shoot() {
  local name="$1"; shift
  "$@" &
  local pid=$!
  sleep 5
  screencapture -x "$OUT/screens/$name.png" && echo "captured $name"
  kill "$pid" 2>/dev/null
  wait "$pid" 2>/dev/null
}

EMPTY="$(mktemp -d)"
shoot screen-panel "$BIN" --sample --open-panel
shoot screen-settings "$BIN" --sample --open-panel --settings
shoot screen-window "$BIN" --sample --window
shoot screen-empty env CLAI_HOME="$EMPTY" "$BIN" --open-panel
rm -rf "$EMPTY"
ls -la "$OUT/screens"
