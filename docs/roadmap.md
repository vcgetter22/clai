# Roadmap

## v0.1 (this repo, 2026-09-03)
- Core engine: normalized events, 147-model catalog (103 verified), cost engine with cache/batch/long-context rules, 13 insight types, forecasts, budgets, seats.
- Store: SQLite via node:sqlite, idempotent upserts, timezone-aware days, repricing.
- Connectors: Claude Code, Codex CLI, Gemini CLI, OpenCode, Cline/Roo, Aider; Anthropic Admin + Claude Code Analytics + Enterprise Analytics; OpenAI Admin usage + costs; OpenRouter; Cursor Admin; GitHub Copilot; claude.ai and ChatGPT exports.
- CLI with 19 commands, local dashboard (8 pages), self-hosted team server with tokens, ingest and scheduled pulls.

## v0.2 (launch readiness, 2-4 weeks)
- Publish `@claii/cli`, `@claii/server`, `@claii/dashboard` to npm; Homebrew tap; Dockerfile and compose for the team server.
- Real-data validation runs against Anthropic and OpenAI admin orgs, Cursor and Copilot orgs (fixture tests exist; live shapes to confirm).
- Claude Code OTLP receiver in the team server (metrics + api_request events) for organizations that prefer telemetry over sync.
- `clai watch` (tail logs live) and a statusline/menu-bar mode; VS Code status bar extension.
- Landing page with the no-login "what is your Max plan worth" calculator; Product Hunt and Show HN.

## v0.3 (Plus tier, 4-8 weeks)
- Hosted service: Postgres adapter behind EventStore, org/user accounts (magic link), Stripe billing (Plus $7, Team $5/seat), EU and US regions.
- Alerts: budget breach, anomaly, plan value, approaching weekly limits (from Codex rate-limit snapshots and Claude Code usage data), via email and Slack.
- Browser extension (opt-in, disclosed) for claude.ai / chatgpt.com remaining-limit widgets.
- FOCUS 1.4 export with token columns; CSV chargeback report per project/client.

## v0.4 (Team depth)
- Bedrock (Cost Explorer + CloudWatch), Azure OpenAI (Cost Management + Monitor), Vertex/BigQuery billing export, Microsoft 365 Copilot and Google Workspace Gemini adoption reports, Windsurf/Codeium analytics, LiteLLM/Helicone/Portkey/Cloudflare gateway imports.
- SSO (SAML/OIDC) and SCIM, audit log, per-team budgets and Slack digests, cost-per-PR and cost-per-engineer benchmarks.
- Shadow-AI discovery from expense exports (Ramp/Brex CSV) matched against known AI vendors.

## v1.0
- SOC 2 Type II, self-hosted enterprise package, data residency guarantees, API for BI tools, agency chargeback module, Managed Agents / MCP server so usage shows up inside Claude Code and chat clients.

## Explicitly not planned
- Scraping vendor web apps or using consumer OAuth tokens.
- Storing prompt or response content.
- Acting as a proxy or gateway.
