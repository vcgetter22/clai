# clai

**See what your AI really costs.** clai is a usage and cost tracker for Claude (Claude Code, the API, Pro/Max/Team/Enterprise), ChatGPT and Codex, Gemini, Cursor, GitHub Copilot, OpenRouter and other providers. It reads usage metadata from the tools you already use, prices every token with a maintained catalog, and tells you what a plan is worth, where money is wasted, and what next month will cost.

- **Local-first and free.** `clai scan` reads the session logs your AI tools already keep on your machine. Nothing leaves the device.
- **Metadata only.** clai reads token counts, model ids, timestamps and project labels. It never reads or stores prompt or response content.
- **Real prices.** A versioned catalog of 140+ models with cache, batch and long-context rules. Subscription usage is valued at API list price so a $200 Max plan can be compared with pay-as-you-go.
- **Insights, not just charts.** Plan value, month-end forecast, budget breaches, anomalies, model mix savings, cache efficiency, context bloat, idle seats.
- **Teams.** Members run `clai sync` to a self-hosted team server (or the hosted service); admins connect the Anthropic, OpenAI, Cursor, Copilot and OpenRouter admin APIs for per-person, per-project and per-key cost.

## Quick start

```bash
npx @claii/cli scan        # detect Claude Code, Codex CLI, Gemini CLI, OpenCode, Cline, Aider and ingest usage
npx @claii/cli report      # totals, forecast, by provider / model / project
npx @claii/cli insights    # savings opportunities and warnings
npx @claii/cli dashboard   # local web dashboard at http://127.0.0.1:4321
```

Declare what you pay for, so clai can value it:

```bash
clai plan set anthropic max_20x      # or: pro, max_5x, team_premium; openai plus/pro; cursor pro; github copilot_pro
clai budget set "AI tools" 300       # monthly budget with breach forecast
```

Connect provider admin APIs (teams, API workloads):

```bash
clai connect anthropic-admin --set adminKey=sk-ant-admin...
clai connect openai-admin --set adminKey=sk-admin-...
clai connect openrouter --set apiKey=sk-or-...
clai connect cursor-admin --set apiKey=key_...
clai connect github-copilot --set token=ghp_... --set org=my-org
clai pull                             # pull usage and billed costs from all configured connectors
```

Other commands: `clai import <export.zip>` (claude.ai / ChatGPT data exports), `clai export --format csv`, `clai status` (one line for your shell prompt), `clai doctor` (environment check and a cross-check against Claude Code's own `/stats` numbers), `clai pricing list|show|set|check`, `clai ask "which project cost the most last week?"` (uses Claude; needs `ANTHROPIC_API_KEY` or `ant auth login`).

Every command accepts `--json` for scripting and `--since 7d|30d|month|all|YYYY-MM-DD`.

## Team mode

```bash
# on a server (Docker or any Node 22.13+ host)
CLAI_HOME=/var/lib/clai PORT=8787 npx @claii/server        # prints a bootstrap admin token
# admin: create member tokens via POST /api/admin/tokens, configure connectors in ~/.clai/credentials.json on the server
# each member:
clai config set identity.email jane@acme.com
clai sync --server https://clai.acme.internal --token clai_mem_...
```

The team dashboard shows spend per person, project, model and provider, seat utilisation and idle seats, budgets and insights across the whole company. Working directories and git remotes are stripped before syncing by default; project labels are kept.

## How costs are computed

1. Each connector normalizes usage into events with uncached input, cache reads, cache writes (5m / 1h), output and reasoning tokens.
2. The model id is resolved against the catalog (Bedrock, Vertex and OpenRouter ids included).
3. Cost = tokens x price, with provider rules (Anthropic cache writes 1.25x / 2x, cache reads 0.1x; batch 50%; Gemini and Grok long-context tiers).
4. When a provider reports billed amounts (Admin API cost reports, OpenRouter, Cursor), the billed figure wins and is labelled *billed*; otherwise the figure is *computed* (API-equivalent) or *estimated* (data exports, where tokens are inferred from text length).

`clai doctor` compares clai's numbers with Claude Code's own `stats-cache.json` so you can see the two agree.

## Development

```bash
npm install
npm run build          # core, store, connectors, server, cli, dashboard
npm test               # vitest
npm run clai -- scan   # run the CLI from the repo
```

Packages: `packages/core` (types, pricing catalog, cost engine, insights), `packages/store` (SQLite via `node:sqlite`), `packages/connectors` (local logs, provider APIs, data exports), `apps/cli`, `apps/server` (Hono API + team mode), `apps/dashboard` (Vite + React). See `docs/` for the product spec, architecture, connector matrix, market analysis and roadmap.

## Privacy

clai's boundary is architectural, not a setting: connectors only ever extract counts, ids and timestamps. Transcript text is never parsed into memory beyond the usage fields, never stored, and never transmitted. Credentials live in `~/.clai/credentials.json` with mode 0600 and are never written to the database. The local dashboard binds to 127.0.0.1.

License: MIT.
