# clai

**Your AI usage, priced, in the menu bar.** clai for Mac reads the logs that AI coding tools already keep on your Mac, adds Claude's usage in the cloud, prices every request at the vendor's API list price, and shows today, this month, the last 30 days and what your plan is worth.

- **Works with** Claude Code, Claude Cowork, Codex (CLI, IDE extension and app), Gemini CLI, Qwen Code and OpenCode.
- **Claude in the cloud.** Your Claude plan limits, which count claude.ai, the apps and cloud sessions, and, for a Claude Console or Claude Enterprise organization, Anthropic's usage report: claude.ai chats, cloud sessions, Cowork, Claude Design, Slack and the API, priced by the hour.
- **Local and private.** No account, no telemetry. clai reads token counts, model names and times, never prompts, code or replies. Nothing about your usage leaves your Mac.
- **Honest numbers.** Every request is priced at the list price of the day it ran (cache reads and writes, fast mode, long prompts, web searches included) and labelled *API-equivalent*. With a subscription you pay the plan; the figure shows what the same work would cost on the API.
- **History that stays.** Claude Code and Gemini CLI delete old logs after 30 days; clai keeps its own totals.
- **One small app.** Native Swift, a 2 MB download, Apple silicon and Intel, macOS 13 or later.

## Install

Download from **https://getclai.vercel.app**, or in Terminal:

```bash
curl -fsSL https://getclai.vercel.app/install.sh | sh
```

clai is not notarized by Apple yet. The first time you open a downloaded copy, macOS says it cannot check it; open System Settings → Privacy & Security and click **Open Anyway**. The Terminal install avoids that prompt (files `curl` downloads are not quarantined) and checks the download against the release's SHA-256 checksum.

clai lives in the menu bar. The first launch also opens its panel in a window, and opening clai again always brings that window back, so it can be found even when the menu bar item is hidden behind the camera notch. Quit with ⌘Q in the window or a right click on the menu bar item.

To update, run the Terminal command again (it quits clai and replaces it), or quit clai and drag the new copy into Applications; macOS does not replace a running app. clai 0.4 kept its data in `~/.clai`, which this version does not use.

## What clai reads

| Tool | Where | What |
|---|---|---|
| Claude Code (CLI, IDE extensions, the Claude app's Code tab) | `~/.claude/projects`, `~/.config/claude/projects`, `~/.claude-*/projects`, `~/Library/Application Support/Claude/claude-code-sessions` | `message.usage` of assistant lines |
| Claude Cowork | `~/Library/Application Support/Claude/local-agent-mode-sessions` | the same, per session |
| Codex (CLI, IDE extension, app) | `~/.codex/sessions`, `~/.codex/archived_sessions` | `token_count` events, plan limits |
| Gemini CLI | `~/.gemini/tmp/*/chats` | `tokens` of model replies |
| Qwen Code | `~/.qwen/projects/*/chats`, `~/.qwen/projects/*/subagents` | `usageMetadata` of assistant records |
| OpenCode | `~/.local/share/opencode` (`opencode.db` and the older JSON files) | `tokens` and `cost` of assistant messages |

Each request is counted once, even when a tool writes it several times (streamed replies, resumed or forked sessions, archived copies). clai never looks inside Desktop, Documents, Downloads, iCloud Drive or other apps' containers, so macOS never asks for folder access.

## Claude in the cloud

Chats on claude.ai and Claude Code sessions in the cloud leave no logs on your Mac. clai uses Anthropic's two official sources for them, both off until you turn them on in Settings:

- **Claude plan limits** (Pro, Max, Ultra). How much of your 5-hour and weekly limits you have used, which counts everything your plan covers: claude.ai, the Claude apps, cloud sessions, Cowork and Claude Code. Claude Code hands these numbers to its [status line](https://code.claude.com/docs/en/statusline); turning on **Show Claude plan limits** makes clai that status line command. clai saves the limits and runs your own status line command as before, and turning the switch off puts your setting back. They update while you use Claude Code in Terminal.
- **Organization usage report** (Claude Console or Claude Enterprise). Anthropic's [Usage and Cost Analytics API](https://platform.claude.com/docs/en/manage-claude/usage-cost-analytics-api) reports an organization's tokens per hour, model and product. Paste an Admin API key (Console, [Admin keys](https://platform.claude.com/settings/admin-keys)) or an Analytics API key with `read:analytics` (Enterprise, [Organization settings → API](https://claude.ai/admin-settings/api-access)), and clai shows Claude Code (cloud), Claude Cowork (cloud), Claude apps and Claude API next to your local tools. Claude Code and Cowork usage your Mac's logs already hold is taken off, so nothing counts twice. Enter your e-mail address to count your own usage in a shared organization. clai reads the report every 30 minutes; Anthropic completes it a few hours late.

Individual Pro and Max plans have no usage report, so clai cannot price their claude.ai chats or cloud sessions; the plan limits are the figure that includes them. A cloud session you continue on your Mac with `claude --teleport` is counted from its transcript.

Not counted: chats on chatgpt.com and gemini.google.com, Cursor, GitHub Copilot, and OpenAI's and Google's cloud agents.

To see what clai counts on your Mac:

```bash
/Applications/clai.app/Contents/MacOS/clai --report
```

## Where clai keeps things

- `~/Library/Application Support/clai/ledger.json`: totals per quarter hour, tool and model (token counts and request counts).
- `~/Library/Application Support/clai/prices.json`: the latest price list, if a newer one than the app's was fetched.
- `~/Library/Application Support/clai/cloud.json`: the organization's usage report as clai last read it; `anthropic-org.json`: its key (readable by you only).
- `~/Library/Application Support/clai/claude-limits.json`: Claude's plan limits; `claude-status-line.json`: the status line setting clai replaced in `~/.claude/settings.json`.
- `~/Library/Preferences/io.github.vcgetter22.clai.plist`: your settings.

Once a day clai fetches the price list from getclai.vercel.app/prices.json and asks GitHub for a newer release. With an organization connected, it asks api.anthropic.com for the organization's usage report every 30 minutes, with your key. Nothing about your usage is sent anywhere, and all of these can be turned off in Settings.

To remove clai: turn off **Show Claude plan limits** in Settings if you turned it on (that restores your Claude Code status line), quit clai, then delete `/Applications/clai.app` and `~/Library/Application Support/clai`.

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
