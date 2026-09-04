# clai

AI usage and cost tracker: Claude (Claude Code, API, Pro/Max/Team/Enterprise), ChatGPT/Codex, Gemini, Cursor, GitHub Copilot, OpenRouter. Free and local for individuals, per-seat for teams. Read `docs/handoff-2026-09-04.md` for where things stand and `docs/decisions.md` before changing an established decision.

## Commands
- `npm install` then `npm run build` (tsc for packages and apps, Vite for the dashboard); `npm test` (vitest); `npm run typecheck:all` (whole tree from source, no build needed).
- Run from source: `npm run clai -- scan`, `npm run clai -- report`, `npm run clai -- dashboard`.
- Real-data checks without touching the user's real store: `CLAI_HOME=/tmp/clai-x node apps/cli/bin/clai.js scan`.
- Team server: `node apps/server/bin/clai-server.js` (env in `.env.example`).

## Layout
`packages/core` (types, pricing catalog, cost engine, insights; no deps) - `packages/store` (SQLite via `node:sqlite`) - `packages/connectors` (`local/`, `api/`, `import/`, registry) - `apps/server` (Hono API, static dashboard, runner, credentials, team mode) - `apps/cli` (commander) - `apps/dashboard` (Vite + React) - `docs/` (spec, API contract, connectors, decisions, market, roadmap, design) - `research/` (sourced notes) - `scripts/merge-pricing.mjs` (regenerates `packages/core/src/pricing/catalog.research.json`).

## Names
npm scope `@claii` (the `clai` npm name and org were taken): `@claii/cli` (binary `clai`), `@claii/server` (binary `clai-server`), `@claii/dashboard`, `@claii/core`, `@claii/store`, `@claii/connectors`. GitHub: `vcgetter22/clai`. Product name stays "clai".

## Rules that do not bend
1. Metadata only: connectors read token counts, model ids, timestamps and labels. Never parse, store, log or transmit prompt or response content.
2. Official sources only: local files the tools write, vendor admin/analytics APIs, data exports. No scraping, no consumer OAuth token reuse, no undocumented endpoints.
3. Token convention (`packages/core/src/types.ts`): `input` is uncached billable input; OpenAI and Google report input inclusive of cached tokens, subtract them; `output` includes reasoning.
4. Every event has a deterministic `naturalKey`; ingestion is idempotent.
5. Costs carry a basis: billed, computed (API-equivalent at list price), or estimated. Subscription usage is valued at API list price and labelled "API-equivalent".
6. Tests use fixtures in temp dirs and an injected `fetch`; no network in tests. Keep `npm test` green and `npm run typecheck:all` at zero errors before finishing.
7. Anthropic catalog entries are hand-curated in `catalog.ts`; other providers come from the generated research JSON; mark `verified` honestly.

## Working style
Small pure functions in core, SQL only in the store, connector-specific parsing only in connectors. Prefer editing over rewriting. Commit only when asked. Use `docs/design-principles.md` for anything user-facing.
