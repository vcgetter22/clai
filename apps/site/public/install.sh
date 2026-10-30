#!/bin/sh
# clai for Mac installer.
#   curl -fsSL https://getclai.vercel.app/install.sh | sh
#
# Downloads the latest release from GitHub (one app for Apple silicon and Intel), checks its SHA-256
# against the release's checksums.txt, puts clai.app in /Applications (or ~/Applications), and opens it.
# Source: https://github.com/vcgetter22/clai/blob/main/apps/site/public/install.sh
set -eu

REPO="vcgetter22/clai"
BASE="https://github.com/$REPO/releases/latest/download"

say() { printf '%s\n' "$*"; }
fail() { printf 'clai: %s\n' "$*" >&2; exit 1; }

[ "$(uname -s)" = "Darwin" ] || fail "clai is a Mac app; this computer is not a Mac."
version="$(sw_vers -productVersion)"
[ "${version%%.*}" -ge 13 ] || fail "clai needs macOS 13 Ventura or later; this Mac runs $version."

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

say "Downloading clai for Mac..."
curl -fL --progress-bar -o "$tmp/clai.zip" "$BASE/clai-mac.zip"
curl -fsSL -o "$tmp/checksums.txt" "$BASE/checksums.txt"
expected="$(grep " clai-mac.zip\$" "$tmp/checksums.txt" | cut -d ' ' -f 1)"
actual="$(shasum -a 256 "$tmp/clai.zip" | cut -d ' ' -f 1)"
if [ -z "$expected" ] || [ "$expected" != "$actual" ]; then
  fail "The download does not match the release checksum, so nothing was installed."
fi

ditto -x -k "$tmp/clai.zip" "$tmp/app"
[ -d "$tmp/app/clai.app" ] || fail "The download has no clai.app in it, so nothing was installed."
dest="/Applications"
[ -w "$dest" ] || dest="$HOME/Applications"
mkdir -p "$dest"
# A running clai quits first (it saves after every read, so nothing is lost).
if pgrep -x clai >/dev/null 2>&1; then
  pkill -x clai || true
  sleep 1
fi
rm -rf "$dest/clai.app"
ditto "$tmp/app/clai.app" "$dest/clai.app"
say "Installed $dest/clai.app"
open "$dest/clai.app"
say "clai is in your menu bar. Usage data stays on this Mac."
