# clai

AI usage and cost tracker: Claude (Claude Code, API, Pro/Max/Team/Enterprise), ChatGPT/Codex, Gemini, Cursor, GitHub Copilot, OpenRouter. Free and local for individuals, per-seat for teams. Ships as a CLI, a local dashboard, a team server and clai for Mac (a SwiftUI menu bar app). Read `docs/handoff-2026-10-19.md` for where things stand and `docs/decisions.md` before changing an established decision.

## Commands
- `npm install` then `npm run build` (tsc for packages and apps, Vite for the dashboard); `npm test` (vitest); `npm run typecheck:all` (whole tree from source, no build needed).
- Run from source: `npm run clai -- scan`, `npm run clai -- report`, `npm run clai -- dashboard`.
- Real-data checks without touching the user's real store: `CLAI_HOME=/tmp/clai-x node apps/cli/bin/clai.js scan`.
- Team server: `node apps/server/bin/clai-server.js` (env in `.env.example`).
- Mac app (`apps/mac`, Swift package): `swift test` there runs ClaiKit's tests (macOS or Linux); `npm run bundle:engine` builds the engine the app embeds; `apps/mac/scripts/package.sh` builds the DMGs on a Mac. CI: `.github/workflows/mac.yml` (macos-26); a `mac-v<version>` tag publishes a GitHub release.

## Layout
`packages/core` (types, pricing catalog, cost engine, insights; no deps) - `packages/store` (SQLite via `node:sqlite`) - `packages/connectors` (`local/`, `api/`, `import/`, registry) - `apps/server` (Hono API, static dashboard, runner, credentials, team mode) - `apps/cli` (commander) - `apps/dashboard` (Vite + React) - `apps/mac` (SwiftUI menu bar app: ClaiKit + Clai; talks to the engine only through `clai snapshot` JSON) - `apps/site` (static getclai.vercel.app, no build step) - `scripts/bundle-engine.mjs` (single-file engine for the app) - `docs/` (spec, API contract, connectors, decisions, market, roadmap, design) - `research/` (sourced notes) - `scripts/merge-pricing.mjs` (regenerates `packages/core/src/pricing/catalog.research.json`).

## Names
npm scope `@claii` (the `clai` npm name and org were taken): `@claii/cli` (binary `clai`), `@claii/server` (binary `clai-server`), `@claii/dashboard`, `@claii/core`, `@claii/store`, `@claii/connectors`. GitHub: `vcgetter22/clai`. Product name stays "clai". Web: getclai.vercel.app (public site, Vercel project `getclai`) and clai-cloud.vercel.app (hosted service, private `clai-cloud` repo). clai is its own product and is never presented as part of cobank.ai. Mac bundle id `io.github.vcgetter22.clai`.

## Rules that do not bend
1. Metadata only: connectors read token counts, model ids, timestamps and labels. Never parse, store, log or transmit prompt or response content.
2. Official sources only: local files the tools write, vendor admin/analytics APIs, data exports. No scraping, no consumer OAuth token reuse, no undocumented endpoints.
3. Token convention (`packages/core/src/types.ts`): `input` is uncached billable input; OpenAI and Google report input inclusive of cached tokens, subtract them; `output` includes reasoning.
4. Every event has a deterministic `naturalKey`; ingestion is idempotent.
5. Costs carry a basis: billed, computed (API-equivalent at list price), or estimated. Subscription usage is valued at API list price and labelled "API-equivalent".
6. Tests use fixtures in temp dirs and an injected `fetch`; no network in tests. Keep `npm test` green and `npm run typecheck:all` at zero errors before finishing.
7. Anthropic catalog entries are hand-curated in `catalog.ts`; other providers come from the generated research JSON; mark `verified` honestly.

## Working style
Small pure functions in core, SQL only in the store, connector-specific parsing only in connectors, no pricing or aggregation in Swift (the app shows what the engine computes). Prefer editing over rewriting. Commit only when asked. Use `docs/design-principles.md` for anything user-facing (its "clai for Mac and getclai.vercel.app" section for the app and site). A change to the snapshot's shape regenerates the fixture (`UPDATE_SNAPSHOT_FIXTURE=1 npx vitest run snapshot`) and keeps `swift test` green.
