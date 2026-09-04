# clai architecture

## Monorepo

```
packages/core        types, ids, time, pricing catalog + resolution + cost engine, aggregation, insights   (no deps)
packages/store       SQLite event store on node:sqlite (Node >= 22.13), settings, subscriptions, budgets, seats, tokens
packages/connectors  local-log connectors, provider API connectors, export importers, registry
apps/server          Hono API implementing docs/dashboard-api.md, static dashboard hosting, connector runner,
                     credentials file, team mode (tokens, ingest, scheduled pulls); exports createApp/listen
apps/cli             commander CLI; imports server for the local dashboard and the runner
apps/dashboard       Vite + React 19 + Recharts SPA; built dist served by cli and server
docs/                spec, API contract, connector matrix, market analysis, roadmap
research/            raw research with sources (data sources, pricing, market)
scripts/             merge-pricing.mjs (research catalog -> packages/core/src/pricing/catalog.research.json)
```

Build: `tsc -b` per package with project references; dashboard via Vite. Tests: vitest (core, store, connectors).

## Data flow

1. **Connector** yields `RawUsageEvent`s (usage fields only; never content).
2. **finalizeEvent** (core) derives a stable 24-hex id from `source + naturalKey`, resolves the model against the catalog, infers the provider for gateways (OpenRouter), computes cost, and normalizes usage.
3. **EventStore.upsertEvents** inserts or updates by id (idempotent). Provider cost reports arrive as separate "cost events" with `billedUsd` and zero tokens; totals prefer billed amounts only when every event in a cell is billed, otherwise computed values are used, so mixed cells never double count.
4. **Queries** run in SQL (`rows`, `totalsBy`, `sessions`, `actors`, `total`) grouped by local day (timezone stored per database, recomputable).
5. **Insights** operate on `AggRow[]` (day x provider x model x source x surface x billing x plan x actor x project x session) plus declared subscriptions, budgets and seats.
6. **API / CLI** share `computeSummary`, `computeInsights`, `breakdown` in `apps/server/src/summary.ts`, so the terminal and the dashboard always agree.

## Identity and dedup

- Claude Code writes one JSONL line per content block with identical `message.id` / `requestId` / `usage`, so the natural key is `(message.id, requestId)`; in-run and cross-run dedup are both id-based.
- Codex CLI usage is derived from deltas of the cumulative `total_token_usage` counter (robust to repeated `token_count` events and to counter resets after compaction); natural key `(session, index, ts)`.
- Provider buckets use `(bucket start, dimensions...)`; cost reports use `('cost', bucket start, workspace/project, description/line item)`.
- Incremental file scanning stores `{size, mtimeMs, offset}` per file in `source_state`; only newly appended complete lines are read; partial trailing lines are re-read once complete.

## Pricing

- `SEED_CATALOG` (hand-curated) merged with `catalog.research.json` (generated) into `CATALOG`; user overrides from `~/.clai/pricing.json` merged at load (`apps/server/src/catalog.ts`).
- `normalizeCatalog` removes alias collisions. `resolveModel` normalizes Bedrock (`us.anthropic.…-v1:0`), Vertex (`…@20251101`), Google (`models/…`), OpenRouter (`anthropic/claude-sonnet-4.5:beta`) forms, strips dates and `-latest`, and falls back to longest prefix.
- `computeCost` applies per-provider cache multipliers when a model lacks explicit cache prices, batch multipliers, `:free` variants, web search fees, and long-context tiers only for request-level events whose context exceeds the threshold (or when a provider bucket says so).

## Storage schema (SQLite)

`events` (indexed by ts, day, session, actor+day, source+ts, project), `settings`, `source_state`, `subscriptions`, `budgets`, `seats`, `ingest_runs`, and team tables `api_tokens` (sha256 of token, role), `members`, `connectors`. WAL mode. The same schema serves local and team modes; a Postgres adapter is a planned drop-in behind the `EventStore` interface for the hosted service.

## Team mode

- `clai-server` (env: `PORT`, `CLAI_HOME`, `CLAI_DB`, `CLAI_TZ`, `CLAI_ADMIN_TOKEN`, `CLAI_ADMIN_EMAIL`, `CLAI_PULL_INTERVAL_MINUTES`) boots, creates an admin token if none exists, serves the dashboard and API with bearer auth, and pulls configured connectors on an interval.
- Members: `clai sync` posts events in batches of 500 to `/api/v1/ingest`; member tokens force `actor.email` to the token's identity (no spoofing); admins ingest as-is. Working directories and git remotes are stripped client-side by default.
- Roles: admins see everything and manage tokens, members, subscriptions, budgets, seats; members see only their own actor.

## Security and privacy

- Content never parsed: connectors pre-filter lines and read only `usage`, `model`, ids and timestamps; export importers count tokens and discard text.
- Credentials in `~/.clai/credentials.json` (0600), never in the DB; env vars supported; secrets masked in output.
- Local dashboard binds to 127.0.0.1; team server intended for private networks or behind TLS.
- `clai ask` only executes read-only SQL (SELECT/WITH, no semicolons, forced LIMIT) generated by Claude, and sends aggregated rows, not events with paths, to the model.

## Deployment paths

- npm: `@claii/cli` (bin `clai`) with `@claii/server` and `@claii/dashboard` as dependencies; Node 22.13+ only, no native modules.
- Self-hosted team: `npx @claii/server` or a Dockerfile (Node 24 alpine, volume on `/var/lib/clai`).
- Hosted (roadmap): the same server behind Postgres with Stripe billing for Plus/Team tiers and EU/US regions.
