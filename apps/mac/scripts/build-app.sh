#!/usr/bin/env bash
# Builds clai.app for Apple silicon and Intel in one bundle, then clai-mac.zip, clai-mac.dmg and
# checksums.txt in apps/mac/build/dist.
#
#   apps/mac/scripts/build-app.sh                 # on a Mac with Xcode or the Command Line Tools
#   VERSION=1.2.3 apps/mac/scripts/build-app.sh
#
# Signing: ad hoc by default. With MACOS_SIGNING_IDENTITY (a "Developer ID Application" identity in
# the keychain) the app gets a Developer ID signature and the hardened runtime; with APPLE_ID,
# APPLE_TEAM_ID and APPLE_APP_PASSWORD as well, the zip and the disk image are notarized.
set -euo pipefail

MAC="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${OUT:-$MAC/build}"
DIST="$OUT/dist"
APP="$OUT/clai.app"
VERSION="${VERSION:-1.0.0}"
BUILD_NUMBER="${BUILD_NUMBER:-${GITHUB_RUN_NUMBER:-1}}"

log() { printf '\n==> %s\n' "$*"; }

rm -rf "$APP" "$DIST" "$OUT/dmg"
mkdir -p "$DIST"

log "Swift build, one architecture at a time"
for arch in arm64 x86_64; do
  swift build --package-path "$MAC" -c release --arch "$arch" --product Clai
done
ARM_BIN="$(swift build --package-path "$MAC" -c release --arch arm64 --show-bin-path)/Clai"
X86_BIN="$(swift build --package-path "$MAC" -c release --arch x86_64 --show-bin-path)/Clai"

log "clai.app $VERSION ($BUILD_NUMBER)"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
lipo -create "$ARM_BIN" "$X86_BIN" -output "$APP/Contents/MacOS/clai"
lipo -info "$APP/Contents/MacOS/clai"
sed -e "s/__VERSION__/$VERSION/" -e "s/__BUILD__/$BUILD_NUMBER/" "$MAC/Info.plist" > "$APP/Contents/Info.plist"
plutil -lint "$APP/Contents/Info.plist"
printf 'APPL????' > "$APP/Contents/PkgInfo"

ICONSET="$OUT/AppIcon.iconset"
rm -rf "$ICONSET"
mkdir -p "$ICONSET"
for size in 16 32 128 256 512; do
  sips -z "$size" "$size" "$MAC/Resources/AppIcon.png" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
  sips -z $((size * 2)) $((size * 2)) "$MAC/Resources/AppIcon.png" --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"

log "Sign"
xattr -cr "$APP"
if [[ -n "${MACOS_SIGNING_IDENTITY:-}" ]]; then
  codesign --force --timestamp --options runtime --sign "$MACOS_SIGNING_IDENTITY" "$APP"
else
  codesign --force --sign - "$APP"
fi
codesign --verify --deep --strict --verbose=2 "$APP"

notarize() {
  [[ -n "${MACOS_SIGNING_IDENTITY:-}" && -n "${APPLE_ID:-}" && -n "${APPLE_TEAM_ID:-}" && -n "${APPLE_APP_PASSWORD:-}" ]] || return 0
  xcrun notarytool submit "$1" --apple-id "$APPLE_ID" --team-id "$APPLE_TEAM_ID" --password "$APPLE_APP_PASSWORD" --wait
}

log "Zip"
ditto -c -k --sequesterRsrc --keepParent "$APP" "$DIST/clai-mac.zip"
if [[ -n "${MACOS_SIGNING_IDENTITY:-}" && -n "${APPLE_ID:-}" ]]; then
  notarize "$DIST/clai-mac.zip"
  xcrun stapler staple "$APP"
  rm "$DIST/clai-mac.zip"
  ditto -c -k --sequesterRsrc --keepParent "$APP" "$DIST/clai-mac.zip"
fi

log "Disk image"
mkdir -p "$OUT/dmg"
cp -R "$APP" "$OUT/dmg/"
ln -s /Applications "$OUT/dmg/Applications"
hdiutil create -volname "clai" -srcfolder "$OUT/dmg" -ov -format UDZO "$DIST/clai-mac.dmg" >/dev/null
if [[ -n "${MACOS_SIGNING_IDENTITY:-}" ]]; then
  codesign --force --timestamp --sign "$MACOS_SIGNING_IDENTITY" "$DIST/clai-mac.dmg"
  if [[ -n "${APPLE_ID:-}" ]]; then
    notarize "$DIST/clai-mac.dmg"
    xcrun stapler staple "$DIST/clai-mac.dmg"
  fi
fi

(cd "$DIST" && shasum -a 256 clai-mac.zip clai-mac.dmg > checksums.txt)
cat "$DIST/checksums.txt"
du -h "$DIST"/*
