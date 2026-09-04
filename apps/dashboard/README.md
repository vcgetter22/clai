# @claii/dashboard

The clai web dashboard — a single-page app (hash routing, no router dependency) that
visualizes AI usage and cost across Claude, ChatGPT/Codex, Gemini, Cursor, Copilot and
raw API usage. It's served from `dist/` by either:

- **`clai dashboard`** (the CLI, local mode) — binds to `127.0.0.1`, no auth, same-origin `/api`.
- **`clai-server`** (the team server, team mode) — bearer-token auth via `Authorization: Bearer <token>`.

The API contract this app is built against is `../../docs/dashboard-api.md`.

## Develop

```sh
npm run dev -w @claii/dashboard        # vite dev server, proxies /api -> http://127.0.0.1:4321
npm run build -w @claii/dashboard      # -> apps/dashboard/dist
npm run preview -w @claii/dashboard    # serve the production build locally
```

## Mock mode

No backend needed. Open the dev server (or the built `dist/index.html`) with:

- `?mock=1` — deterministic generated data (60 days, anthropic/openai/google, a Max 20x
  subscription, a budget, an idle-seat story) served entirely in the browser from `src/mock/`.
- `?mock=1&empty=1` — the same mock, but with zero events, to preview the onboarding
  empty state.
- `?mock=1&team=1` — team mode: multiple actors, seats, and the same bearer-token gate
  the real team server enforces (any non-empty token is accepted).

`VITE_MOCK=1` at build time turns on mock mode without the URL flag.

## Structure

- `src/api.ts` — typed client. Every page calls the same functions regardless of
  whether they hit `/api/*` or the in-browser mock (`src/mock/engine.ts`).
- `src/hash.ts` — `#/<page>?<query>` routing; filters live in the query string.
- `src/types.ts` — response shapes mirrored from the API contract.
- `src/colors.ts` / `src/format.ts` — stable entity→color assignment and USD/token/date formatting.
- `src/pages/*.tsx` — one file per top-nav page.
- `src/components/*.tsx` — shared chart, table and form pieces.
- `src/styles.css` — hand-written, CSS-variable-based, light/dark via `prefers-color-scheme`.
