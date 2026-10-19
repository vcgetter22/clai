# Decision log

Short records of the choices that shape clai, with the evidence behind them. Newest last.

## 2026-09-03: Metadata-only is an architectural boundary
Connectors pre-filter transcript lines and read only usage fields, ids and timestamps; export importers count tokens and discard text; nothing else is parsed. Reason: the market analysis rates trust for a company-wide collector as the single biggest unlock or blocker for team sales, and a toggle is not a guarantee.

## 2026-09-03: Official sources only, no consumer OAuth reuse
Anthropic prohibits third-party use of consumer OAuth tokens (enforced 2026-04-04). Community tools that read `~/.claude/.credentials.json` and call `api.anthropic.com/api/oauth/usage` are therefore off the table for a company, as are `chatgpt.com/backend-api/wham/usage` and `cursor.com/api/usage`. clai uses local files the tools write, vendor Admin/Analytics APIs, data exports and (later) Claude Code's OpenTelemetry export.

## 2026-09-03: Node `node:sqlite`, no native modules
Node 22.13+ ships SQLite. `npx @claii/cli` must work without compilers or prebuilt binaries; a Postgres adapter behind the same `EventStore` interface serves the hosted product.

## 2026-09-03: Subscription usage is valued at API list price
Called "API-equivalent" everywhere in the UI, with a tooltip. It is the only way to compare a $200 plan with pay-as-you-go and it is the number people already quote in the rate-limit threads.

## 2026-09-03: Dedup Claude Code transcripts by (message.id, requestId) and merge by maximum
Claude Code writes one JSONL line per streamed content block. Verified on this machine: Claude Code's own `stats-cache.json` daily counters equal the sum over every line, so its `/stats` runs at about 2x billed tokens. Also verified: in 4% of messages later lines carry larger `output_tokens` (5 then 1136), so taking the first line (as ccusage does) undercounts output; on this machine that was 13.1M vs 21.2M output tokens and $3,716 vs $3,878 over 30 days. clai keeps one event per request and takes the field-wise maximum across its lines.

## 2026-09-03: Codex usage from cumulative deltas
`token_count` events repeat on rate-limit refreshes; deltas of `total_token_usage` with reset detection are robust. OpenAI's input counts include cached and cache-write tokens, which are split out. `rate_limits.plan_type` labels the plan.

## 2026-09-03: Pricing catalog = curated seed + generated research layer + user overrides
Anthropic entries are hand-verified against the official pricing page; other providers come from a generated JSON produced from vendor pages (99 of 126 verified) and are marked unverified where not. Findings applied: Sonnet 5 $2/$10 made permanent (2026-09-01); Anthropic 4.6+ models bill 1M context flat; Sonnet 4/4.5 keep the >200K beta premium (still on Vertex pricing); Gemini cache reads are 0.1x; OpenAI GPT-5.4+ show a long-context column without a published threshold, priced at the base tier until confirmed; DeepSeek retired `deepseek-chat`/`deepseek-reasoner` for V4; Copilot moved to AI credits and a new NDJSON metrics API (2026).

## 2026-09-03: Tiers Free / Plus $7 / Team $5 per seat / Business custom
From the pricing benchmarks (Raycast Pro $8-10, Helicone Team $799 flat, Langfuse $29-2,499, SaaS-management by quote). Charge where data crosses a boundary: devices, people, systems.

## 2026-09-03: Team server is the same code as the CLI
One engine, one schema, one API contract (`docs/dashboard-api.md`) for local and team modes; the hosted service is the team server on Postgres with billing. Avoids the "two products, two data models" failure mode the competitive analysis identified.

## 2026-09-04: Hosted service architecture
The hosted Plus/Team service is the team server on Postgres (Supabase, eu-central-1) behind one Vercel function (fra1) with the dashboard served same-origin; Stripe Payment Link first, entitlement only by webhook. In this repo that means: one uniformly async `EventStore` interface with `SqliteEventStore` behind `@claii/store/sqlite` (first published as 0.2.0), team-server SQL moved into store methods, `createApi` taking a principal resolver and public-route allowlist, and a device-code `clai login`. Tenant isolation, billing, retention and auth details are recorded in the private `clai-cloud` repository (`docs/decisions.md` there). Found while planning and fixed the same day: `bootstrapTeam` used `require()` in an ES module, so every `CLAI_ADMIN_TOKEN` start crashed.

## 2026-10-19: clai and cobank.ai stay separate; clai lives on vercel.app
The founder dropped the plan to fold clai into cobank.ai: the two stay separate products for good. Nothing in clai names cobank.ai. The hosted service keeps its vercel.app domain, `https://clai-cloud.vercel.app` (the `clai-cloud` Vercel project; `clai login` defaults to it), and the public site with the Mac download is `https://getclai.vercel.app` (Vercel project `getclai`, built from `apps/site` in this repo; `clai.vercel.app` belongs to someone else). Support goes through GitHub issues until clai has its own mail address.

## 2026-10-19: clai for Mac is a native SwiftUI menu bar app over the same engine
The founder asked for clai as a refined Mac app in the menu bar. It is SwiftUI (`apps/mac`, `MenuBarExtra`), not Electron or a web view, so it looks and behaves like a Mac app and stays small. The numbers still come from the one TypeScript engine: the app ships Node 24 LTS and a single-file bundle of the CLI (`scripts/bundle-engine.mjs`) and runs `clai snapshot --scan`, whose JSON (schema 1) is the whole contract; a Swift port of the connectors and pricing would have been a second engine that drifts (see "Team server is the same code as the CLI"). The store is the CLI's (`~/.clai`), so CLI and app always agree. Refresh is a short-lived process per scan (about 0.2 s of engine start, then only new log lines), on a timer and a few seconds after FSEvents sees the tools' log folders change; nothing stays resident except while the local dashboard is open. Downloads are per architecture (Apple silicon, Intel; about 30 MB each, almost all Node) rather than one 60 MB universal app. Node keeps its own notarized Node.js Foundation signature. Until the founder has an Apple Developer ID the app is signed ad hoc, and the site explains the one-time "Open Anyway" step and offers `curl ... | sh`, which skips Gatekeeper because curl does not quarantine; the workflow signs with Developer ID and notarizes as soon as the secrets exist. Builds run on GitHub's `macos-26` runners (free for this public repo); a `mac-v*` tag publishes the DMGs and zips as a GitHub release and getclai.vercel.app redirects `/download/mac` and `/download/mac-intel` to the latest one.

## 2026-10-19: The Mac app and its site may be bubbly
The founder wants clai for Mac to look and feel Apple-native but "a bit more flashy-bubbly". For the Mac app and getclai.vercel.app only, this supersedes design rules 2 and 8 (no gradients, glass or glow; nothing loops or floats): materials and Liquid Glass (macOS 26), a ledger-green to mint gradient bubble behind the month's figure, decorative soap bubbles, springy hover and press, figures that count up once. What does not change: the hero is a real number with its basis, ledger green is the one accent and amber/red keep their meaning, copy stays specific, privacy is stated in the flow, both themes are designed, and reduced motion turns the movement off. The CLI and dashboard keep the ledger look. Details in docs/design-principles.md, "clai for Mac and getclai.vercel.app".

## 2026-10-19: No bubbles; the Mac app and its site get quieter
After using 0.4.0 the founder found flashy-bubbly overdone and asked to lose the bubbles and make the app more serious. This narrows the entry above. The app and getclai.vercel.app keep the native materials (Liquid Glass on macOS 26, translucent cards) and one ledger-green card behind the month's figure, now a plain green-to-deep-green fill. Gone: soap bubbles, blobs, gloss, glow, the mint and teal gradient, parallax, springy hover and press, figures counting up from zero and cards rising in. Type is SF Pro, not rounded, and rule 8 holds again for the app and the site: nothing loops, floats or bounces; motion is a value changing, page navigation and the site's one-time fade-in. The icon is the tally on a ledger-green squircle. Same day, after the founder saw "$0" in the menu bar next to the right numbers in the panel: the menu bar shows the month so far by default (the panel's headline), because on a morning without usage today's figure is $0, which reads like a fault; today and icon-only stay in Settings. App releases take their version from the `mac-v*` tag, so an app-only release (0.4.1) needs no npm bump.
