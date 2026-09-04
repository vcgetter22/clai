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
