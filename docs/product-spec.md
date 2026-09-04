# clai product specification (v0.1, 2026-09-03)

## 1. Problem

Companies and individuals pay for AI in three ways at once: per-seat subscriptions (Claude Pro/Max/Team, ChatGPT Plus/Pro/Business, Cursor, GitHub Copilot, Microsoft 365 Copilot), metered API keys (Anthropic, OpenAI, Google, Bedrock, OpenRouter), and agentic tools (Claude Code, Codex, Gemini CLI) whose token burn is invisible until a limit or an invoice arrives. No single view shows who uses what, what it really costs, whether a plan is worth its price, or where money is wasted. The evidence is loud: 13k-star DIY trackers, 300-comment threads about vanished weekly limits, agencies losing 15-20% of billable usage, 98% of FinOps teams now told to "manage AI spend" with no token-level data standard until FOCUS 1.4 (June 2026).

## 2. Vision and principles

clai is the single source of truth for AI usage and cost, from one laptop to a whole company.

1. **Local-first, free forever for individuals.** The CLI reads what your tools already write. No account needed.
2. **Metadata only.** Token counts, model ids, timestamps, project labels. Never prompt or response content. This is an architectural boundary, not a toggle.
3. **Official sources first.** Local log files, vendor Admin/Analytics APIs and data exports. No scraping of web apps and no reuse of consumer OAuth tokens (Anthropic bans third-party use of consumer OAuth tokens since April 2026). Unofficial endpoints are out of scope for v1.
4. **Real prices, honestly labelled.** Every figure is *billed*, *computed* (tokens x list price) or *estimated* (token counts inferred). Subscription usage is valued at API-equivalent cost so plans and pay-as-you-go are comparable.
5. **Insight over dashboards.** Every screen ends in a number the user can act on: savings, overrun, breach date, idle seat.
6. **One data model, individual to enterprise.** The same event schema and catalog power the CLI, the team server and the hosted service, so a developer who loves the free tool can bring it to the company without a re-platform.

## 3. Users and jobs

| Persona | Job to be done | Primary surface |
|---|---|---|
| Developer on Claude Max / ChatGPT Pro / Cursor | Am I getting my money's worth? Which plan should I be on? What did that session cost? | `clai scan`, `report`, `status`, local dashboard |
| Engineering lead, 10-200 person company (ICP #1) | Who uses the seats we pay for? What does each project cost? Will we hit a limit mid-sprint? | Team server, Cursor/Copilot/Anthropic/OpenAI connectors, People page, budgets |
| Finance / IT / FinOps, 200-2000 people | One blended AI cost per employee across vendors; exportable, FOCUS-aligned data; shadow-AI signals | Team server, CSV/JSON export, seats, budgets |
| Agency / consultancy | Bill AI usage back per client with proof | Project tagging, exports |
| AI-native startup | API COGS by key/project/model, cache and batch savings | Admin API connectors, insights |

## 4. Scope by tier

### Free (local)
- Local connectors: Claude Code, Codex CLI (and same-format agents), Gemini CLI, OpenCode, Cline/Roo Code, Aider.
- Import: claude.ai export, ChatGPT export (estimated tokens).
- Reports: overview, daily/weekly/monthly, models, projects, sessions, providers, sources; JSON output.
- Insights: plan value, forecast, budgets, anomalies, model mix, cache efficiency, context size, long-context premium, expensive sessions, concentration, unpriced models, batch candidates.
- Declared plans and budgets; pricing catalog with overrides; local dashboard bound to 127.0.0.1; `clai ask` with your own Claude key.

### Plus (individual, planned, ~$7/month)
- Hosted sync across machines with 12-month history; alerts (email/Slack) for budgets, anomalies and plan value; browser extension for claude.ai / chatgpt.com limit widgets (opt-in, disclosed).

### Team (~$5/seat/month, 5-seat minimum; self-hosted server included in the open-source repo)
- Member sync with per-person attribution; admin connectors: Anthropic Admin API (usage, cost, Claude Code analytics), Anthropic Enterprise Analytics API, OpenAI Admin API (usage, costs), OpenRouter, Cursor Admin API, GitHub Copilot (metrics reports, seats, AI credits).
- People page with seats and idle-seat waste; project and model breakdowns across the team; budgets per team/project; CSV/JSON export; role-based tokens (admin/member).

### Business / Enterprise (custom, ~$8-15/seat or % of tracked spend)
- SSO/SCIM, audit log, EU data residency, FOCUS 1.4 export with token columns, Slack/Teams digests, client/project chargeback module, priority connectors (Bedrock via Cost Explorer/CloudWatch, Azure OpenAI, Vertex/BigQuery billing export, Microsoft 365 Copilot reports, Windsurf/Codeium analytics, LiteLLM/Helicone gateways).

## 5. Core data model

`UsageEvent` (see `packages/core/src/types.ts`): id (stable hash of source + natural key), ts, source, provider, model, modelKey, surface (api / cli-agent / ide / chat / batch), billing (api / subscription / unknown), plan, granularity (request / message / hour / day), actor (email, userId, apiKey, workspace, project), context (session, cwd, project, git branch, agent, app version, tags), usage (input, output, cacheRead, cacheWrite5m, cacheWrite1h, reasoning, requests, web searches), cost (billedUsd, computedUsd, confidence).

Token convention: `input` is billable uncached input. Connectors subtract cached tokens for OpenAI and Google, whose reported input includes them. Output includes reasoning tokens.

## 6. Pricing catalog

- Seed: hand-curated, Anthropic entries verified against the official pricing page (2026-09-03), including cache multipliers, batch, retirement status and platform-conditional retirement notes.
- Research layer: 126 models across 10 providers generated from vendor pricing pages (99 verified), merged on top of the seed for non-Anthropic providers; regenerated with `node scripts/merge-pricing.mjs`.
- Overrides: `~/.clai/pricing.json` via `clai pricing set`; `clai pricing reprice` recomputes stored events; `clai pricing check` lists unpriced or unverified models seen in data.
- Resolution handles dated snapshots, Bedrock and Vertex ids, OpenRouter vendor prefixes and variants, and falls back to longest-prefix matching; `<synthetic>` is free.

## 7. Insights catalog (all implemented in `packages/core/src/insights/engine.ts`)

| Insight | Trigger | Output |
|---|---|---|
| Plan value | Declared subscription | API-equivalent value MTD and projected, multiple of price, downgrade/keep/upgrade advice with $ impact |
| Forecast | Any usage | Month-end projection, weekday-weighted from 28 days, confidence, delta vs last month |
| Budget | Declared budget | Used %, projected %, breach date, overrun $ |
| Anomaly | Daily spend > median + 3 MAD (and > $2) | Day, multiple, top model and project |
| Model mix | Frontier share >= 60% and > $10 | Savings from shifting 30% of frontier tokens to the provider's mid model |
| Cache efficiency | API traffic, >= 2M context tokens, hit rate < 30% | Conservative savings from caching half the input |
| Context size | Agent requests averaging > 120k context | Cache cost share, per-request saving per 100k trimmed |
| Long-context premium | Requests > 200k on models with a premium tier | Count and models |
| Batch candidate | Steady API-key traffic >= 7 days, > $50 | Up to 50% savings |
| Idle seats | Declared seats without activity in 30 days | Waste $ per month |
| Expensive sessions | Sessions above p90 and > $5 | Session, project, days, median comparison |
| Concentration | Top project >= 50% or top 3 people >= 60% | Shares |
| Unpriced models | Any | Data-quality warning with fix |

## 8. Surfaces

- **CLI** (`apps/cli`): scan, report, insights, status, dashboard, plan, budget, seat, config, connect, disconnect, pull, import, sync, export, pricing, doctor, ask.
- **Dashboard** (`apps/dashboard`): Overview, Models, Projects & Sessions, People, Insights, Plans & Budgets, Pricing, Events. Served locally by the CLI and by the team server. Contract in `docs/dashboard-api.md`.
- **Team server** (`apps/server`): the same API with bearer tokens, `POST /api/v1/ingest`, admin token/member management, scheduled connector pulls.

## 9. Non-goals (v1)

Prompt-level tracing and evals (Langfuse/Helicone territory); a proxy/gateway; scraping web UIs; reading consumer OAuth tokens; automated enforcement (blocking requests).

## 10. Success metrics

- Free: weekly active CLIs, share of users who declare a plan, share who open the dashboard twice.
- Plus/Team: conversion from free, seats per team, connectors configured per team, identified savings per team per month (the number in `clai insights`), retention at 90 days.
- Quality: cost delta vs provider bills (target < 2% for API connectors; Claude Code cross-check within 1%), unpriced-model rate (< 0.5% of events).
