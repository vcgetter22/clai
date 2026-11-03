# clai for Mac

The app: a menu bar item with this month's API-equivalent spend, and a panel with today, last month, the pace, a 30-day chart, the month by tool and by model, plan value, and Claude's and Codex's plan limits. Settings live in the same panel, including Claude in the cloud: the plan limits (through Claude Code's status line) and an organization's usage report (Anthropic's analytics API). Download: https://getclai.vercel.app

## Layout
- `Sources/ClaiCore` (Foundation only; tests run on macOS and Linux)
  - `Readers/`: one reader per tool (Claude Code and Cowork, Codex, Gemini CLI and Qwen Code, OpenCode). Each lists its files and turns lines or documents into one `UsageEvent` per request, with a key that is the same wherever the tool repeats the request.
  - `Scanner.swift`: finds the files, reads only what changed (appended lines, rewritten documents), keeps one event per request, and updates the ledger; adds the cloud lines for the summary.
  - `Cloud/OrgUsage.swift`: Anthropic's Usage and Cost Analytics API (query, pages, client), the stored report (`cloud.json`) and the cloud lines it gives once this Mac's Claude Code and Cowork logs are taken off.
  - `Cloud/ClaudeLimits.swift`: Claude's plan limits from Claude Code's status line JSON, the edit of `~/.claude/settings.json` that connects clai's status line command, and `clai --status-line` itself.
  - `Ledger.swift`: totals per UTC quarter hour, tool, model and price tier in `~/Library/Application Support/clai/ledger.json`; for each quarter hour and tool the count with more requests wins, so history outlives deleted logs, and days are worked out in whatever time zone the Mac is in.
  - `Pricing.swift`, `Prices.swift`: the price list (dated prices, fast mode, cache writes, long-context tiers) and how logged model ids are matched to it.
  - `Summary.swift`, `Format.swift`, `Report.swift`, `Files.swift`, `Time.swift`, `SampleData.swift`.
- `Sources/Clai` (macOS): `main.swift`, `AppDelegate` (launch, single instance, window on first launch and reopen), `StatusItemController` (NSStatusItem, popover, right-click menu, window), `AppState` (reads on a serial background queue, settings, daily online check, login item), `LogWatcher` (FSEvents), `PanelView`, `SettingsView`, `Theme`, `Renderer`.
- `scripts/build-app.sh`, `scripts/smoke-test.sh`, `scripts/screenshots.sh`; `Info.plist`; `Resources/AppIcon.png` (and its SVG).

## Develop
```bash
swift test                              # ClaiCore, macOS or Linux
swift run Clai                          # your real data
swift run Clai --sample --window        # sample data in a window
swift run Clai --report                 # print what clai counts and quit
CLAI_HOME=/tmp/fixture swift run Clai   # read logs under /tmp/fixture instead of your home
swift run Clai --render /tmp/shots      # draw the panel (sample data) to PNGs and quit
echo '{"rate_limits":{"five_hour":{"used_percentage":12,"resets_at":1893456000}}}' | swift run Clai --status-line
                                        # what Claude Code runs as its status line once connected
```

## Package and release
```bash
scripts/build-app.sh                    # build/dist: clai-mac.dmg, clai-mac.zip, checksums.txt
scripts/smoke-test.sh                   # checks the packaged app on this Mac
```
`build-app.sh` builds arm64 and x86_64 separately, joins them with `lipo`, writes the bundle (Info.plist with `VERSION` and `BUILD_NUMBER`, the icon) and signs it ad hoc, or with `MACOS_SIGNING_IDENTITY` (a Developer ID Application identity) and the hardened runtime; with `APPLE_ID`, `APPLE_TEAM_ID` and `APPLE_APP_PASSWORD` it also notarizes and staples the zip and the disk image.

`.github/workflows/mac.yml` runs the tests on macOS and Linux, builds the app, runs the smoke test and takes screenshots (artifacts `clai-mac` and `screenshots`). Pushing a tag `mac-v<version>` builds that version and publishes a GitHub release; getclai.vercel.app/download/mac and the install script always fetch the latest release.

To ship Developer ID signed, notarized builds, add these repository secrets: `MACOS_CERTIFICATE_P12` (base64 of the exported certificate and key), `MACOS_CERTIFICATE_PASSWORD`, `MACOS_SIGNING_IDENTITY` (e.g. `Developer ID Application: Name (TEAMID)`), `APPLE_ID`, `APPLE_TEAM_ID`, `APPLE_APP_PASSWORD` (app-specific password).
