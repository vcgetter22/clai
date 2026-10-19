#!/usr/bin/env bash
# Builds clai for Mac: one app bundle per CPU architecture (a universal Swift binary plus that
# architecture's Node runtime and the bundled engine), then a DMG and a zip of each, and checksums.
#
#   npm ci && npm run build            # once: the engine bundle needs the built dashboard
#   apps/mac/scripts/package.sh        # macOS with Xcode 16+ (Xcode 26 for Liquid Glass)
#
# Output in apps/mac/build/dist: clai-mac-arm64.dmg, clai-mac-x64.dmg, matching .zip files and
# checksums.txt. Signing: ad hoc by default; with MACOS_SIGNING_IDENTITY set (a "Developer ID
# Application" identity in the keychain) the app gets a Developer ID signature with the hardened
# runtime, and with APPLE_ID, APPLE_TEAM_ID and APPLE_APP_PASSWORD also set it is notarized.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
MAC="$ROOT/apps/mac"
OUT="${OUT:-$MAC/build}"
DIST="$OUT/dist"
VERSION="${VERSION:-$(node -p "require('$ROOT/apps/cli/package.json').version")}"
BUILD_NUMBER="${BUILD_NUMBER:-${GITHUB_RUN_NUMBER:-1}}"
# Node.js LTS that runs the engine inside the app (node:sqlite needs 22.13 or later).
NODE_VERSION="${NODE_VERSION:-24.22.0}"
ARCHS="${ARCHS:-arm64 x64}"

log() { printf '\n\033[1;32m==>\033[0m %s\n' "$*"; }

rm -rf "$DIST"
mkdir -p "$OUT" "$DIST"

log "Engine bundle"
node "$ROOT/scripts/bundle-engine.mjs" "$OUT/engine"

log "Swift build (universal)"
SWIFT_FLAGS=(-c release --arch arm64 --arch x86_64)
(cd "$MAC" && swift build "${SWIFT_FLAGS[@]}")
BIN_DIR="$(cd "$MAC" && swift build "${SWIFT_FLAGS[@]}" --show-bin-path)"
lipo -info "$BIN_DIR/Clai"

log "Icon"
ICONSET="$OUT/AppIcon.iconset"
rm -rf "$ICONSET"
mkdir -p "$ICONSET"
for size in 16 32 128 256 512; do
  sips -z "$size" "$size" "$MAC/Resources/AppIcon.png" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
  double=$((size * 2))
  sips -z "$double" "$double" "$MAC/Resources/AppIcon.png" --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$OUT/AppIcon.icns"

sign_app() {
  local app="$1"
  # Node keeps the Developer ID signature and notarization of the Node.js project; only the app
  # around it is signed here (no --deep, which would replace it).
  codesign --verify --strict "$app/Contents/Helpers/node"
  if [[ -n "${MACOS_SIGNING_IDENTITY:-}" ]]; then
    codesign --force --timestamp --options runtime --sign "$MACOS_SIGNING_IDENTITY" "$app"
  else
    codesign --force --sign - "$app"
  fi
  codesign --verify --deep --strict --verbose=2 "$app"
}

notarize() {
  local file="$1"
  if [[ -n "${MACOS_SIGNING_IDENTITY:-}" && -n "${APPLE_ID:-}" && -n "${APPLE_TEAM_ID:-}" && -n "${APPLE_APP_PASSWORD:-}" ]]; then
    xcrun notarytool submit "$file" --apple-id "$APPLE_ID" --team-id "$APPLE_TEAM_ID" --password "$APPLE_APP_PASSWORD" --wait
    return 0
  fi
  return 1
}

curl -fsSL -o "$OUT/SHASUMS256.txt" "https://nodejs.org/dist/v$NODE_VERSION/SHASUMS256.txt"

for arch in $ARCHS; do
  log "clai.app $VERSION for $arch (Node $NODE_VERSION)"
  STAGE="$OUT/$arch"
  APP="$STAGE/clai.app"
  rm -rf "$STAGE"
  mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Helpers" "$APP/Contents/Resources"

  cp "$BIN_DIR/Clai" "$APP/Contents/MacOS/clai"
  sed -e "s/__VERSION__/$VERSION/" -e "s/__BUILD__/$BUILD_NUMBER/" "$MAC/Info.plist" > "$APP/Contents/Info.plist"
  plutil -lint "$APP/Contents/Info.plist"
  cp "$OUT/AppIcon.icns" "$APP/Contents/Resources/AppIcon.icns"
  cp -R "$OUT/engine" "$APP/Contents/Resources/engine"
  cp "$MAC/Tests/ClaiKitTests/Fixtures/snapshot.json" "$APP/Contents/Resources/demo-snapshot.json"
  cp "$ROOT/LICENSE" "$APP/Contents/Resources/LICENSE"

  TARBALL="node-v$NODE_VERSION-darwin-$arch.tar.xz"
  if [[ ! -f "$OUT/$TARBALL" ]]; then
    curl -fsSL -o "$OUT/$TARBALL" "https://nodejs.org/dist/v$NODE_VERSION/$TARBALL"
  fi
  (cd "$OUT" && grep " $TARBALL\$" SHASUMS256.txt | shasum -a 256 -c -)
  tar -xJf "$OUT/$TARBALL" -C "$STAGE" "node-v$NODE_VERSION-darwin-$arch/bin/node" "node-v$NODE_VERSION-darwin-$arch/LICENSE"
  mv "$STAGE/node-v$NODE_VERSION-darwin-$arch/bin/node" "$APP/Contents/Helpers/node"
  mv "$STAGE/node-v$NODE_VERSION-darwin-$arch/LICENSE" "$APP/Contents/Resources/engine/NODE-LICENSE"
  rm -rf "$STAGE/node-v$NODE_VERSION-darwin-$arch"
  chmod 755 "$APP/Contents/Helpers/node" "$APP/Contents/MacOS/clai"

  sign_app "$APP"

  ZIP="$DIST/clai-mac-$arch.zip"
  ditto -c -k --keepParent "$APP" "$ZIP"
  if notarize "$ZIP"; then
    xcrun stapler staple "$APP"
    rm "$ZIP"
    ditto -c -k --keepParent "$APP" "$ZIP"
  fi

  DMG_ROOT="$STAGE/dmg"
  mkdir -p "$DMG_ROOT"
  cp -R "$APP" "$DMG_ROOT/"
  ln -s /Applications "$DMG_ROOT/Applications"
  DMG="$DIST/clai-mac-$arch.dmg"
  hdiutil create -volname "clai" -srcfolder "$DMG_ROOT" -ov -format ULMO "$DMG" >/dev/null
  if [[ -n "${MACOS_SIGNING_IDENTITY:-}" ]]; then
    codesign --force --timestamp --sign "$MACOS_SIGNING_IDENTITY" "$DMG"
    if notarize "$DMG"; then xcrun stapler staple "$DMG"; fi
  fi
  du -sh "$APP" "$DMG" "$ZIP"
done

(cd "$DIST" && shasum -a 256 clai-mac-* > checksums.txt && cat checksums.txt)
log "Done: $DIST"
