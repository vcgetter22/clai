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
- Folders: `~/.claude/projects`, `~/.config/claude/projects`, other accounts' `~/.claude-*/projects` (`CLAUDE_CONFIG_DIR`), and the Claude app's sessions, which keep each session's transcripts in its own `.claude/projects`: the Code tab under `claude-code-sessions`, Cowork under `local-agent-mode-sessions`.
- An API message id (`msg_…`) is one request across all files. Streamed lines of a response are merged field by field (maximum), so a later, larger `output_tokens` wins. Resumed sessions and `/btw` replays count once.
- Gateway ids are qualified by request id; without one, the consecutive lines of a streamed reply share its first line's time.
- `<synthetic>` and API-error lines are skipped.
- Subagent replies are read from `progress` lines too.
- `usage.iterations` other than `message` are billed on top: advisor calls under the advisor's model, server-side compaction under the reply's model.
- Cowork's `audit.jsonl` is read alongside its transcripts; its lines carry `_audit_timestamp`.
- `journal.jsonl` holds orchestration notes and is skipped.
- `usage.speed == "fast"` is priced at the model's fast multiple: 2× from Opus 4.8, 6× for Opus 4.6 and 4.7.

**Codex**
- A `token_count` counts its `last_token_usage` only when the running total moved. Repeats on rate-limit updates and estimates after compaction (no input, no output) add nothing. Older files without `last`, and responses cut short (Codex adds them to the total but keeps the previous `last`), use the growth of the total.
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
- Subagents write `subagents/<session>/agent-<id>.jsonl` without a model; it is read from `agent-<id>.meta.json` beside the file.
- Prices are Alibaba Cloud's international list prices for the models Qwen Code uses now, with their 256K tier; Qwen Code marks prompts for the explicit cache, whose hits cost 10% of input. Models with more tiers (`qwen3-coder-plus`, retired on 2026-10-10, and `qwen3-coder-flash`) and the free Qwen OAuth `coder-model` (an alias for different models over time, ended 2026-04-15) have no price and show "–".

**OpenCode**
- Reads `opencode.db`, both the `message` and the `session_message` tables on every read (1.15 to 1.19 have both and still write to `message`), through `json_extract`, plus the older JSON files.
- OpenCode before 1.3.17 (April 2026) logged reasoning inside output for OpenAI-style providers, so that old history counts reasoning twice; current months are not affected.
- Replies are keyed by time, model and tokens, because forks and migrations copy rows under new ids.
- For models clai has no price for, the tool's own `cost` is shown, labelled "cost as logged".

**Not counted (no usage logs on the Mac)**
- Cursor, GitHub Copilot, chats on claude.ai, chatgpt.com and gemini.google.com, and cloud agents.
- Copilot CLI, Amp, Cline and others log usage in less regular ways and can come later, one small reader each.

## 2026-10-30: A ledger that outlives the logs
Claude Code deletes transcripts after `cleanupPeriodDays` (30 by default) and Gemini CLI deletes chats after 30 days, so the logs alone cannot show last month. clai keeps totals per UTC quarter hour, tool, model and price tier in `~/Library/Application Support/clai/ledger.json`.

- **Quarter hours, not days.** Every time zone is a whole number of quarter hours from UTC, so a quarter hour falls on one day in any zone. Days are worked out in the Mac's zone of the moment. With day rows, a trip moved requests near midnight into the neighbouring day while the stored day kept them: counted twice, for good (found in review).
- Each launch reads every log from the start: 1.7 GB of transcripts took 1.1 s in a benchmark. clai keeps one event per request in memory and reads only what changed after that.
- For each quarter hour and tool, the count with more requests wins. A fresh count of logs still on disk replaces the stored one, so a price or classification change never adds anything twice. A quarter hour whose logs are gone keeps its stored total.
- `Ledger.readersVersion` is bumped when a reader changes what it counts. The next launch then lets the logs lower stored totals, but only where they are complete: the tools delete whole files, oldest first, so nothing written after the oldest remaining file's last change is missing. Before that point the larger count stays, because a long session can leave some of a day's requests behind.
- A file clai cannot read is never written over. A damaged one is renamed `ledger-unreadable-<time>.json` and clai starts over; one from a newer clai (a higher `format`) is left alone. Rows of tools a newer clai added are kept.
- Written at most every 5 minutes and loaded on the scan queue. A heavy year is about 44,000 rows (4.5 MB); usage not yet written is still in the logs, which the next launch reads again.

## 2026-10-30: Readers never decode content
Rule 1 says readers parse nothing beyond the usage fields. Before a line or document is parsed, `JSON.metadata` copies it with every string value emptied unless its key is one the readers use (`type`, `id`, `model`, `timestamp`, `sessionId`, `requestId`, `speed`, `service_tier` and a few more). Prompts, replies, thinking and tool input are stepped over to their closing quote and never decoded. Keys, numbers and structure stay, so the readers are unchanged; the cold scan got faster. Token counts outside 0…10¹² read as 0, so a corrupt log can neither crash clai (the readers add counts up) nor inflate a total.

## 2026-10-30: An unknown is never $0
Requests of a model with no price and no logged cost are counted (requests, tokens) but have no cost. The summary counts them per tool, model, day and month; wherever a figure would be $0 only because of them it shows "–", and the month card says "N requests without a price". A model's basis is the best of its lines: list price, then logged cost, then none.

## 2026-10-30: Prices in the app and at getclai.vercel.app/prices.json
The price list is Swift code (`Prices.swift`), checked against the vendors' pricing pages on 2026-10-30, and the same list is published as `apps/site/public/prices.json`; a test keeps them equal. The app fetches it once a day, so a new model or a price change reaches every copy without an app update.

- **Dated prices.** A price that changes on a date gets a `since` row: Sonnet 5.5 cache reads from 2026-10-07, Gemini 4 Argon from 2026-12-01, 3.6/3.8 Flash from 2027-01-01. Usage is priced at the price of its day.
- **New models.** A model id clai does not know is priced like the nearest older version of its family (Opus 5.6 like Opus 5.5, never like Opus 5) and marked "priced like …". Words that never change a price (`preview`, `latest`, `thinking`) are not part of the family, so `gemini-3.5-pro` follows Gemini 3.1 Pro (`gemini-3.1-pro-preview`), not 2.5 Pro. A model with no family match shows its tokens and no price.
- **The published list is laid over the built-in one.** It can add models and change prices; a model or plan it leaves out keeps its built-in price. A list with a number that would break the panel (web searches over $1,000 per 1,000, a plan under $1, a long-context threshold of 0) is refused.

## 2026-10-30: AppKit status item and popover, not MenuBarExtra
`MenuBarExtra` has well-documented failures:

- labels that stop updating after sleep;
- no way to open it from code;
- Settings windows that open behind other apps;
- invisible items on macOS 26 with separate Spaces.

So clai is plain AppKit. `main.swift`, an `NSStatusItem` with a stable `autosaveName`, and an `NSPopover` whose SwiftUI content exists only while it is open. The popover is dismissed by clicks elsewhere and Escape, because a `.transient` popover closes on the first mouse move in full-screen Spaces.

Ways to reach the app:
- A window opens on the first launch, whenever clai is opened again, and two seconds after launch if the item is not visible: not allowed in the menu bar, off screen, or behind the camera notch. macOS reports an item hidden behind the notch as visible, so clai compares its frame with the gap between the screen's `auxiliaryTopLeftArea` and `auxiliaryTopRightArea`. Occlusion state would also flag an auto-hiding menu bar and display changes.
- A right click on the item gives Quit; ⌘Q works while the window is open.
- A second copy hands over to the running one, unless it is newer or the running one is in a temporary place (the disk image, or Downloads under App Translocation) and it is not: opened from Applications after the move, it takes over.
- The popover (`.applicationDefined`) closes on a click elsewhere, Escape, ⌘Tab (the app resigns active) and a change of Space.
- A login item is added again after an update or a move (a new signature can drop it), never after the user removed it in System Settings.

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
- **Build.** One universal app, made by building each architecture and joining them with `lipo`. Needs macOS 13 or later; the disk image is under 2 MB.
- **Signing.** Signed ad hoc until there is a Developer ID; the workflow signs and notarizes as soon as the secrets exist.
- **Gatekeeper.** The download needs Open Anyway once. `curl … | sh` avoids it (curl does not quarantine) and checks the SHA-256.
- **Updates.** The update check shows a notice and a download link. Sparkle 2 with EdDSA signatures works without a Developer ID and would make updates one click; it is the next step if updates become frequent.
