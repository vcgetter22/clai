# Decision log

Short records of the choices that shape clai, with the evidence behind them. Newest last. Decisions before 2026-10-30 belong to the first version and are in git history (`git show 55265fb:docs/decisions.md`).

## 2026-10-30: Start over: clai is one native Mac app
The founder could not tell where the problems came from and asked to start from scratch, keeping only the idea: an AI usage tracker that works with all the major AIs, as a simple, clean menu bar app that works for everyone. The first version had too many moving parts:

- a SwiftUI shell that ran a bundled Node 24 engine as a subprocess;
- SQLite through `node:sqlite`;
- a CLI, a team server, a web dashboard and a hosted service;
- 30 MB downloads per architecture.

Known failures:

- a fresh Mac could not open the app, and it could only be quit from Activity Monitor;
- folder-access prompts;
- `$0` in the menu bar;
- Gemini CLI counted only with an opt-in telemetry file;
- Opus 5.5 priced as Opus 5.

The new clai is the Mac app alone, in Swift: no subprocess, no database, no server. The CLI (`@claii/*` on npm), the team server and the dashboard are retired; they remain in git history. The hosted `clai-cloud` service lives in its own repository and is not part of this one. The site (getclai.vercel.app) is kept.

## 2026-10-30: What carries over
These carry over from the first version:

- **Metadata only:** token counts, model ids, times and ids; never content.
- **Official sources only:** files the tools write. clai does not reuse consumer login tokens. Anthropic's terms: "developers may not collect, store, or intermediate Claude.ai credentials or session tokens" (code.claude.com/docs/en/legal-and-compliance).
- **Valuation:** usage is valued at API list price and labelled API-equivalent.
- **Counting:** one count per request.
- **Design:** the Apple-native look of the Mac app (docs/design.md).

## 2026-10-30: How the readers count
Researched against the tools' source and the open-source trackers (ccusage, CodexBar, splitrail, tokscale) on this date.

**Claude Code and Cowork**
- An API message id (`msg_…`) is one request across all files. Streamed lines of a response are merged field by field (maximum), so a later, larger `output_tokens` wins. Resumed sessions and `/btw` replays count once.
- Gateway ids are qualified by request id.
- `<synthetic>` and API-error lines are skipped.
- Subagent replies are read from `progress` lines too.
- Advisor iterations (`usage.iterations[type=advisor_message]`) are billed on top, under the advisor's model.
- Cowork's `audit.jsonl` is read alongside its transcripts.
- `journal.jsonl` holds orchestration notes and is skipped.
- `usage.speed == "fast"` is priced at the model's fast multiple: 2× from Opus 4.8, 6× for Opus 4.6 and 4.7.

**Codex**
- A `token_count` counts its `last_token_usage` only when the running total moved. Repeats on rate-limit updates and estimates after compaction (no input, no output) add nothing. Older files without `last` use the growth of the total.
- Keys are the token numbers themselves, so forks that copy the parent's lines, and copies in `archived_sessions`, count once.
- `input_tokens` includes cached tokens and cache writes. The cache writes are billed at 1.25× from GPT-5.6.
- `service_tier` `priority`/`fast` is priced at the Fast tier. It comes from `turn_context`, `thread_settings_applied` or `config.toml`.
- Plan limits come from `rate_limits` with `limit_id` `codex`.
- `.jsonl.zst` (compressed old rollouts, off by default in Codex) are not read.

**Gemini CLI**
- Reads JSONL recordings, including subagent chats and `$set` checkpoints, plus the older JSON documents. Messages are keyed by session and id.
- `input` includes `cached`, `thoughts` are output, `tool` is input.

**Qwen Code**
- Reads `usageMetadata`. Output is the candidates plus whatever of the total is neither prompt nor candidates, so OpenAI-compatible backends, which put thoughts inside the candidates, are not counted twice.
- Branch copies share a `uuid`.

**OpenCode**
- Reads `opencode.db`, both the `message` and the `session_message` tables, through `json_extract`, plus the older JSON files.
- Replies are keyed by time, model and tokens, because forks and migrations copy rows under new ids.
- For models clai has no price for, the tool's own `cost` is shown, labelled "cost as logged".

**Not counted (no usage logs on the Mac)**
- Cursor, GitHub Copilot, chats on claude.ai, chatgpt.com and gemini.google.com, and cloud agents.
- Copilot CLI, Amp, Cline and others log usage in less regular ways and can come later, one small reader each.

## 2026-10-30: A ledger of daily totals that outlives the logs
Claude Code deletes transcripts after `cleanupPeriodDays` (30 by default) and Gemini CLI deletes chats after 30 days, so the logs alone cannot show last month. clai keeps totals per day, tool, model and price tier in `~/Library/Application Support/clai/ledger.json`.

- Each launch reads every log from the start: 1.7 GB of transcripts took 1.5 s in a benchmark. clai keeps one event per request in memory and reads only what changed after that.
- For each day and tool, the count with more requests wins. A fresh count of logs still on disk replaces the stored one, so a price or classification change never adds a day twice. A day whose logs are gone keeps its stored total.
- `Ledger.readersVersion` is bumped when a reader changes what it counts. The next launch then recounts every day that still has logs.

## 2026-10-30: Prices in the app and at getclai.vercel.app/prices.json
The price list is Swift code (`Prices.swift`), checked against the vendors' pricing pages on 2026-10-30, and the same list is published as `apps/site/public/prices.json`; a test keeps them equal. The app fetches it once a day, so a new model or a price change reaches every copy without an app update.

- **Dated prices.** A price that changes on a date gets a `since` row: Sonnet 5.5 cache reads from 2026-10-07, Gemini 4 Argon from 2026-12-01, 3.6/3.8 Flash from 2027-01-01. Usage is priced at the price of its day.
- **New models.** A model id clai does not know is priced like the nearest older version of its family (Opus 5.6 like Opus 5.5, never like Opus 5) and marked "priced like …". A model with no family match shows its tokens and no price.

## 2026-10-30: AppKit status item and popover, not MenuBarExtra
`MenuBarExtra` has well-documented failures:

- labels that stop updating after sleep;
- no way to open it from code;
- Settings windows that open behind other apps;
- invisible items on macOS 26 with separate Spaces.

So clai is plain AppKit. `main.swift`, an `NSStatusItem` with a stable `autosaveName`, and an `NSPopover` whose SwiftUI content exists only while it is open. The popover is dismissed by clicks elsewhere and Escape, because a `.transient` popover closes on the first mouse move in full-screen Spaces.

Ways to reach the app:
- A window opens on the first launch, whenever clai is opened again, and two seconds after launch if the item is not visible (behind the notch, or not allowed in the menu bar).
- A right click on the item gives Quit; ⌘Q works while the window is open.
- A second copy hands over to the running one, unless it is newer.

When reads happen:
- FSEvents on the tools' folders, plus a safety read every 5 minutes, on wake, at midnight and on time-zone changes.
- Reads run on one serial background queue.
- The menu bar title is written only when it changes; macOS 26 aborts on a stream of identical writes.

## 2026-10-30: No API keys, no Claude plan limits for now
Admin-key spend (Anthropic, OpenAI, OpenRouter, Cursor, Copilot) is left out:

- Anthropic admin keys carry full organization access.
- The cost endpoints bucket by UTC day only.
- API spend would double count Claude Code usage that runs on an API key.
- With ad hoc signing, every update would ask for Keychain access again.

Claude's 5-hour and weekly limits have one official local source: the `rate_limits` that Claude Code (2.1.80+) passes to a statusLine command. Reading it would mean wrapping the user's statusLine. That is a possible later step; reading Claude's OAuth usage endpoint is not. Codex writes its limits to its own logs, and clai shows them.

## 2026-10-30: Distribution without a Developer ID
- **Build.** One universal app, made by building each architecture and joining them with `lipo`. Needs macOS 13 or later, about 3 MB.
- **Signing.** Signed ad hoc until there is a Developer ID; the workflow signs and notarizes as soon as the secrets exist.
- **Gatekeeper.** The download needs Open Anyway once. `curl … | sh` avoids it (curl does not quarantine) and checks the SHA-256.
- **Updates.** The update check shows a notice and a download link. Sparkle 2 with EdDSA signatures works without a Developer ID and would make updates one click; it is the next step if updates become frequent.
