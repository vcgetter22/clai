# clai

AI usage tracker for the Mac: a native menu bar app that reads the usage logs AI coding tools keep on the Mac (Claude Code, Claude Cowork, Codex, Gemini CLI, Qwen Code, OpenCode), adds Claude's cloud usage (plan limits from Claude Code's status line; an organization's usage report from Anthropic's analytics API), prices every request at API list price and shows today, the month, the last 30 days and plan value. Free, open source, local. Started over on 2026-10-30 (`docs/decisions.md`); the earlier Node CLI, team server and dashboard live only in git history.

## Commands
- `cd apps/mac && swift test`: ClaiCore's tests (macOS or Linux; Linux needs only a Swift toolchain). Keep them green.
- `swift run Clai` (macOS): the app from source. Flags: `--report` (print what clai counts and quit), `--sample` (sample data), `--window` (open the window), `--open-panel` (open the panel after launch), `--render <dir>` (draw the panel to PNGs and quit), `--status-line` (Claude Code's status line command once connected: saves plan limits, runs the user's own command). `CLAI_HOME=<dir>` reads logs under that folder instead of your home and keeps the ledger there.
- `apps/mac/scripts/build-app.sh`: universal `clai.app`, `clai-mac.dmg`, `clai-mac.zip`, `checksums.txt` in `apps/mac/build/dist`. `apps/mac/scripts/smoke-test.sh` checks the packaged app.
- After changing `Sources/ClaiCore/Prices.swift`: `UPDATE_PRICES_JSON=1 swift test --filter SitePriceList` rewrites `apps/site/public/prices.json` (a test fails while they differ).
- CI: `.github/workflows/mac.yml` (macos-26: tests, build, smoke test, screenshots; Linux: core tests). A `mac-v<version>` tag publishes a GitHub release, and so does a manual run of the workflow with `release: <version>` (it creates the tag). `apps/mac/release-notes/<version>.md` goes into the release notes.

## Layout
- `apps/mac/Sources/ClaiCore`: Foundation only. `Readers/` (one file per tool), `Scanner` (finds files, reads only what changed, one event per request), `Ledger` (totals per UTC quarter hour in `~/Library/Application Support/clai/ledger.json`; days follow the Mac's time zone), `Cloud/` (`OrgUsage`: Anthropic's usage report, `cloud.json`, minus what local logs hold; `ClaudeLimits`: plan limits from the status line, the `settings.json` edit), `Pricing` + `Prices` (the price list), `Summary`, `Format`, `Report`.
- `apps/mac/Sources/Clai`: the app. `main.swift`, `AppDelegate`, `StatusItemController` (NSStatusItem, popover, window), `AppState` (scheduling, settings, daily online check), `LogWatcher` (FSEvents), SwiftUI views (`PanelView`, `SettingsView`, `Theme`), `Renderer`.
- `apps/site`: getclai.vercel.app (Vercel project `getclai`, root directory `apps/site`, static files, no build step).
- `docs/decisions.md`, `docs/design.md`.

## Names
Product "clai", lowercase. GitHub `vcgetter22/clai`. Bundle id `io.github.vcgetter22.clai`. Site getclai.vercel.app. clai is its own product and is never presented as part of cobank.ai.

## Rules that do not bend
1. Metadata only: readers take token counts, model ids, timestamps and ids. Never parse into memory beyond the usage fields, store, log or send prompt or response content. SQLite sources are read with `json_extract` so content stays in the database.
2. Official sources only: files the tools write on this Mac, data a tool documents for scripts (Claude Code's status line JSON), and Anthropic's documented usage report with a key the user pastes. No reading other apps' login tokens or cookies, no undocumented endpoints, nothing about usage sent anywhere.
3. Never make macOS ask for permission: read only the tools' own folders, never Desktop, Documents, Downloads, iCloud, other apps' containers or removable volumes (`FileFinder.isSafe`), no Keychain (keys live in clai's folder, mode 0600), no Apple Events.
4. Token convention (`Tokens`): `input` is uncached input (subtract cached tokens and cache writes where a vendor counts them inside input), `output` includes reasoning, cache reads and writes are separate.
5. Every request has one key across all files, so a request logged twice (streamed lines, resumed, forked or archived copies) counts once. Reading is incremental and idempotent. Cloud usage that local logs also hold (Claude Code, Cowork) is subtracted, never added twice.
6. Costs carry their basis: listed price, priced like a family member (new model), the tool's logged cost, or no price. Usage is valued at API list price and labelled "API-equivalent". Never show an unknown as $0.
7. The price list (`Prices.swift`, mirrored in `apps/site/public/prices.json`) comes from the vendors' pricing pages; prices that change on a date get a `since` row.
8. Tests use fixtures in temp dirs, never the network. Keep `swift test` green on Linux and macOS.

## Working style
Small readers, one per tool, each with fixture tests of the real line shapes. No pricing or counting in the app target; it shows what ClaiCore computes. Prefer editing over rewriting. Commit only when asked. User-facing work follows `docs/design.md`.
