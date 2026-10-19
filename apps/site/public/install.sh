#!/bin/sh
# clai for Mac installer.
#   curl -fsSL https://getclai.vercel.app/install.sh | sh
#
# Downloads the latest release for this Mac's CPU from GitHub, checks its SHA-256 against the
# release's checksums.txt, puts clai.app in /Applications (or ~/Applications), and opens it.
# Source: https://github.com/vcgetter22/clai/blob/main/apps/site/public/install.sh
set -eu

REPO="vcgetter22/clai"
BASE="https://github.com/$REPO/releases/latest/download"

say() { printf '%s\n' "$*"; }
fail() { printf 'clai: %s\n' "$*" >&2; exit 1; }

[ "$(uname -s)" = "Darwin" ] || fail "clai for Mac runs on macOS. Elsewhere, use the command line version: npx @claii/cli scan"
version="$(sw_vers -productVersion)"
[ "${version%%.*}" -ge 14 ] || fail "clai for Mac needs macOS 14 Sonoma or later; this Mac runs $version."

case "$(uname -m)" in
  arm64) arch=arm64 ;;
  x86_64)
    # A shell running under Rosetta on Apple silicon still gets the Apple silicon build.
    if [ "$(sysctl -in sysctl.proc_translated 2>/dev/null || echo 0)" = "1" ]; then arch=arm64; else arch=x64; fi ;;
  *) fail "This Mac's CPU ($(uname -m)) is not supported." ;;
esac

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

say "Downloading clai for Mac ($arch)..."
curl -fL --progress-bar -o "$tmp/clai.zip" "$BASE/clai-mac-$arch.zip"
curl -fsSL -o "$tmp/checksums.txt" "$BASE/checksums.txt"
expected="$(grep " clai-mac-$arch.zip\$" "$tmp/checksums.txt" | cut -d ' ' -f 1)"
actual="$(shasum -a 256 "$tmp/clai.zip" | cut -d ' ' -f 1)"
if [ -z "$expected" ] || [ "$expected" != "$actual" ]; then
  fail "The download does not match the release checksum, so nothing was installed."
fi

ditto -x -k "$tmp/clai.zip" "$tmp/app"
dest="/Applications"
[ -w "$dest" ] || dest="$HOME/Applications"
mkdir -p "$dest"
if pgrep -x clai >/dev/null 2>&1; then
  pkill -x clai || true
  sleep 1
fi
rm -rf "$dest/clai.app"
ditto "$tmp/app/clai.app" "$dest/clai.app"
say "Installed $dest/clai.app"
open "$dest/clai.app"
say "clai is in your menu bar. Usage data stays on this Mac."
