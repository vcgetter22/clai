# clai for Mac

A menu bar app: today's AI spend next to the clai tally, and a panel with the month so far, the forecast, what your plan is worth, a 30-day chart, where the money went and the engine's tips. Download: https://getclai.vercel.app

It is a native SwiftUI app (`MenuBarExtra`, macOS 14 Sonoma or later; Liquid Glass on macOS 26) over the same engine as the CLI: the app bundle carries Node 24 LTS and a single-file build of `@claii/cli`, and every refresh runs `clai snapshot --scan` and decodes its JSON. Data lives where the CLI keeps it (`~/.clai`, or `$CLAI_HOME`), so the app and `clai report` always agree. Background: docs/decisions.md (2026-10-19).

## Layout
- `Sources/ClaiKit`: Foundation only. The snapshot model (schema 1, mirrors `apps/server/src/snapshot.ts`), number formatting identical to `@claii/core`, the process runner, the engine wrapper, Mach-O architecture checks, release-version parsing. Tests run on macOS and Linux.
- `Sources/Clai`: the app. `AppModel` (refresh, live updates, actions), `Services` (preferences, FSEvents log watcher, login item, local dashboard launcher, menu bar icon), and the views (`PanelView`, `HeroBubble`, `Cards`, `SettingsView`, `Components`, `Theme`).
- `Tests/ClaiKitTests/Fixtures/snapshot.json`: written by `apps/server/src/snapshot.test.ts` from the real engine; the Swift tests decode it, so a shape change on either side fails a test. It is also the app's sample data (`--demo`).
- `scripts/package.sh`, `scripts/smoke-test.sh`, `scripts/screenshots.sh`, `scripts/render-icon.mjs`; `Info.plist`; `Resources/AppIcon.svg` and `.png`.

## Develop
```bash
npm ci && npm run build && npm run bundle:engine     # engine at apps/mac/build/engine
cd apps/mac
swift test                                           # ClaiKit (also works on Linux)
CLAI_ENGINE_SCRIPT=$PWD/build/engine/clai.mjs swift run Clai          # your real data, Homebrew/system node
CLAI_DEMO_SNAPSHOT=Tests/ClaiKitTests/Fixtures/snapshot.json swift run Clai --demo   # sample data, no engine
```
Launch flags: `--demo` (sample snapshot), `--window` (panel in a normal window), `--render <dir>` (draw the panel to `panel-light.png` and `panel-dark.png` and quit), `--open-panel` (click the menu bar item after launch).

## Package
```bash
apps/mac/scripts/package.sh       # build/dist: clai-mac-{arm64,x64}.{dmg,zip}, checksums.txt
ARCH=arm64 apps/mac/scripts/smoke-test.sh
```
`package.sh` builds a universal Swift binary, then one app per architecture with that architecture's Node (downloaded from nodejs.org and checked against SHASUMS256.txt; its notarized Node.js signature is kept). It signs ad hoc unless `MACOS_SIGNING_IDENTITY` names a Developer ID Application identity in the keychain, and notarizes when `APPLE_ID`, `APPLE_TEAM_ID` and `APPLE_APP_PASSWORD` are also set.

## Release
`.github/workflows/mac.yml` runs on pushes that touch the app or the engine: npm build, `swift test`, `package.sh`, the smoke test, screenshots (uploaded as artifacts). Pushing a tag `mac-v<version>` (the version in `apps/cli/package.json`) also publishes a GitHub release with the DMGs, zips and checksums. getclai.vercel.app redirects `/download/mac` and `/download/mac-intel` to the latest release, and its `install.sh` installs from it.

To ship notarized builds, add these repository secrets: `MACOS_CERTIFICATE_P12` (base64 of the exported Developer ID Application certificate and key), `MACOS_CERTIFICATE_PASSWORD`, `MACOS_SIGNING_IDENTITY` (e.g. `Developer ID Application: Name (TEAMID)`), `APPLE_ID`, `APPLE_TEAM_ID`, `APPLE_APP_PASSWORD` (an app-specific password). Until then users confirm the first launch once in System Settings → Privacy & Security, or install with `curl -fsSL https://getclai.vercel.app/install.sh | sh`.
