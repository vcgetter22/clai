# clai

**Your AI usage, priced, in the menu bar.** clai for Mac reads the logs that AI coding tools already keep on your Mac, prices every request at the vendor's API list price, and shows today, this month, the last 30 days and what your plan is worth.

- **Works with** Claude Code, Claude Cowork, Codex (CLI, IDE extension and app), Gemini CLI, Qwen Code and OpenCode.
- **Local and private.** No account, no telemetry. clai reads token counts, model names and times, never prompts, code or replies.
- **Honest numbers.** Every request is priced at the list price of the day it ran (cache reads and writes, fast mode, long prompts, web searches included) and labelled *API-equivalent*. With a subscription you pay the plan; the figure shows what the same work would cost on the API.
- **History that stays.** Claude Code and Gemini CLI delete old logs after 30 days; clai keeps the daily totals.
- **One small app.** Native Swift, a 2 MB download, Apple silicon and Intel, macOS 13 or later.

## Install

Download from **https://getclai.vercel.app**, or in Terminal:

```bash
curl -fsSL https://getclai.vercel.app/install.sh | sh
```

clai is not notarized by Apple yet. The first time you open a downloaded copy, macOS says it cannot check it; open System Settings → Privacy & Security and click **Open Anyway**. The Terminal install avoids that prompt (files `curl` downloads are not quarantined) and checks the download against the release's SHA-256 checksum.

clai lives in the menu bar. The first launch also opens its panel in a window, and opening clai again always brings that window back, so it can be found even when the menu bar item is hidden behind the camera notch. Quit with ⌘Q in the window or a right click on the menu bar item.

## What clai reads

| Tool | Where | What |
|---|---|---|
| Claude Code (CLI, IDE extensions, local sessions of the Claude app) | `~/.claude/projects`, `~/.config/claude/projects` | `message.usage` of assistant lines |
| Claude Cowork | `~/Library/Application Support/Claude/local-agent-mode-sessions` | the same, per session |
| Codex (CLI, IDE extension, app) | `~/.codex/sessions`, `~/.codex/archived_sessions` | `token_count` events, plan limits |
| Gemini CLI | `~/.gemini/tmp/*/chats` | `tokens` of model replies |
| Qwen Code | `~/.qwen/projects/*/chats` | `usageMetadata` of assistant records |
| OpenCode | `~/.local/share/opencode` (`opencode.db` and the older JSON files) | `tokens` and `cost` of assistant messages |

Each request is counted once, even when a tool writes it several times (streamed replies, resumed or forked sessions, archived copies). clai never looks inside Desktop, Documents, Downloads, iCloud Drive or other apps' containers, so macOS never asks for folder access.

Not counted, because they keep no usage logs on your Mac: chats on claude.ai, chatgpt.com and gemini.google.com, Cursor, GitHub Copilot, and agents that run in the vendor's cloud.

To see what clai counts on your Mac:

```bash
/Applications/clai.app/Contents/MacOS/clai --report
```

## Where clai keeps things

- `~/Library/Application Support/clai/ledger.json`: daily totals per tool and model (token counts and request counts).
- `~/Library/Application Support/clai/prices.json`: the latest price list, if a newer one than the app's was fetched.
- `~/Library/Preferences/io.github.vcgetter22.clai.plist`: your settings.

Once a day clai fetches the price list from getclai.vercel.app/prices.json and asks GitHub for a newer release. Nothing about your usage is sent, and both can be turned off in Settings.

To remove clai: quit it, delete `/Applications/clai.app` and `~/Library/Application Support/clai`.

## Build from source

```bash
git clone https://github.com/vcgetter22/clai && cd clai/apps/mac
swift test                            # macOS or Linux
swift run Clai                        # run the app from source (macOS)
scripts/build-app.sh                  # build/dist: clai-mac.dmg, clai-mac.zip, checksums.txt
```

Needs Swift 5.9 or later (Xcode 15+ or the Command Line Tools). Details in [apps/mac/README.md](apps/mac/README.md).

## Repository

- `apps/mac`: the app. `Sources/ClaiCore` reads the logs, prices requests and keeps the ledger (Foundation only, tested on macOS and Linux); `Sources/Clai` is the menu bar app (AppKit and SwiftUI).
- `apps/site`: getclai.vercel.app, static files, including `prices.json`.
- `docs/decisions.md`: why things are the way they are.

MIT License.
