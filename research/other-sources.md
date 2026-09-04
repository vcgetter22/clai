# Usage & Cost Data Sources: AI Tools Other Than Anthropic and OpenAI

Engineering reference for clai connectors. Compiled 2026-09-03. Every claim is sourced; items that could not be independently confirmed from an authoritative page are marked **UNVERIFIED**. Pricing and quota numbers change frequently — treat all $ figures as a snapshot for Sept 2026 and re-verify against the live source before hardcoding into billing logic.

---

## 1. Google Gemini

### 1a. Gemini Developer API — pricing

Source: [ai.google.dev/gemini-api/docs/pricing](https://ai.google.dev/gemini-api/docs/pricing) (fetched 2026-09-03).

**2.5 series (stable, per 1M tokens, USD):**

| Model | Input | Output | Cache read | Cache storage | Batch discount |
|---|---|---|---|---|---|
| Gemini 2.5 Pro | $1.25 (≤200K) / $2.50 (>200K) | $10.00 (≤200K) / $15.00 (>200K) | $0.125–$0.25 /1M | $4.50/hr | 50% off |
| Gemini 2.5 Flash | $0.30 (text/img/video), $1.00 (audio) | $2.50 | $0.03–$0.10 /1M | $1.00/hr | 50% off |
| Gemini 2.5 Flash-Lite | $0.10 (text/img/video), $0.30 (audio) | $0.40 | $0.01–$0.03 /1M | $1.00/hr | 50% off |

**3.x series (current top models as of Sept 2026 — UNVERIFIED exact figures, cross-check before billing use):**

| Model | Input | Output | Notes |
|---|---|---|---|
| Gemini 3.1 Pro (Preview) | $2.00 (≤200K) / $4.00 (>200K) | $12.00 (≤200K) / $18.00 (>200K) | Cached input $0.20–$0.40/1M; batch 50% off |
| Gemini 3.5 Flash | $1.50 | $9.00 | Cache $0.15/1M + $1.00/hr storage |
| Gemini 3.5 Flash-Lite | $0.30 | $2.50 | Cache $0.03/1M |
| Gemini 3.1 Flash-Lite | $0.25 (text/img/video) / $0.50 (audio) | $1.50 | Cache $0.025–$0.05/1M |

Sources for 3.x pricing: [apidog.com Gemini 3.0 cost](https://apidog.com/blog/gemini-3-0-api-cost/), [pricepertoken.com Gemini 3.1 Pro](https://pricepertoken.com/pricing-page/model/google-gemini-3.1-pro-preview), [devtk.ai Gemini 3.1 Pro](https://devtk.ai/en/models/gemini-3-1-pro/) — secondary aggregators, not the primary ai.google.dev table, because the live page renders per-model tabs that WebFetch could not fully enumerate. **Treat 3.x row as UNVERIFIED against primary source; the 2.5-series row was corroborated across multiple fetches and matches long-standing published rates.**

**Grounding / tool costs** (ai.google.dev/gemini-api/docs/pricing):
- Grounding with Google Search: 2.5 Pro/Flash 1,500 free requests/day then $35/1,000 grounded prompts; 3.x models 5,000 free/month then $14/1,000 requests (UNVERIFIED — tiering changed between generations, confirm current figure).
- Grounding with Google Maps: 2.5 series 10,000 (Pro) / 500 (Flash) free RPD then $25/1,000; 3.x 5,000 free/month then $14/1,000.
- Code execution: billed at standard model token rates (no separate fee).
- URL context tool: billed as input tokens.
- File Search tool: $0.15/1M tokens for embedding generation + retrieval token costs.

**Long-context (>200K) tiers:** Only Pro-class models (2.5 Pro, 3.1 Pro) have a >200K input tier at ~2x the base input/output rate. Flash-class models bill flat regardless of context length up to their 1M-token window.

**Free tier:** Available via Google AI Studio — no credit card, ~5–15 RPM and up to 1,000 RPD depending on model ([aiweekly.co](https://aiweekly.co/learning-ai/generative-ai/how-to-use-gemini)); free-tier prompts may be used by Google to improve products.

**Programmatic usage/cost endpoint — VERIFIED: none exists for the Gemini Developer API itself.** The pricing page and supporting docs describe only static per-token rates; there is no `GET /usage` or billing-export endpoint on `generativelanguage.googleapis.com`. Cost visibility for direct Gemini API (AI Studio) keys is limited to the Cloud Billing console/reports if the key is linked to a GCP billing account, or manual token-count-times-price calculation from each response's `usageMetadata` (`promptTokenCount`, `candidatesTokenCount`, `totalTokenCount`, `cachedContentTokenCount`, `thoughtsTokenCount` — returned per-call, not queryable in aggregate via a separate endpoint). Google's own "AI Cost Summary Agent" and "Gemini Cloud Assist" in Cloud Billing are dashboards/agents, not documented REST APIs ([docs.cloud.google.com/billing/docs/how-to/gemini/ai-cost-summary](https://docs.cloud.google.com/billing/docs/how-to/gemini/ai-cost-summary)). **Implication for clai: per-call `usageMetadata` capture at the app layer (proxy/SDK wrapper) is the only reliable programmatic signal for the raw Gemini API; there is no server-side historical usage API to poll.**

### 1b. Vertex AI — Cloud Monitoring metrics & Billing export

Source: [docs.cloud.google.com/vertex-ai/docs/general/monitoring-metrics](https://docs.cloud.google.com/vertex-ai/docs/general/monitoring-metrics), [ohlinger.co/posts/vertex-ai-metrics](https://ohlinger.co/posts/vertex-ai-metrics/).

Confirmed Cloud Monitoring metrics (resource type `aiplatform.googleapis.com/PublisherModel`):

| Metric | Description | Key labels |
|---|---|---|
| `aiplatform.googleapis.com/publisher/online_serving/token_count` | Token throughput for publisher-model (Gemini) calls | `type` (input/output token type), base model, request type |
| `aiplatform.googleapis.com/publisher/online_serving/model_invocation_count` | Count of model invocations | `resource.labels.model_user_id` (model id, e.g. `gemini-2.0-flash-exp`), `resource.labels.location`, `error_category` (user/system/capacity) |
| `aiplatform.googleapis.com/publisher/online_serving/character_count` | Character throughput (legacy PaLM-era metric, still emitted for some models) | same as token_count |

`consumed_token_count` — **UNVERIFIED as a distinct metric name**; could not confirm it exists separately from `token_count` in current docs. Treat the task-brief name as possibly an older/renamed alias; use `token_count` as the confirmed metric.

Example MQL-style filter (from ohlinger.co):
```
metric.type="aiplatform.googleapis.com/publisher/online_serving/model_invocation_count"
resource.type="aiplatform.googleapis.com/PublisherModel"
```
Aggregation pattern for project-level monthly token usage: `ALIGN_SUM` + `REDUCE_SUM` over `token_count`.

Access path: standard Cloud Monitoring API (`monitoring.googleapis.com/v3/projects/{project}/timeSeries`) — same auth/quota as any GCP Monitoring read (`roles/monitoring.viewer`).

**Cloud Billing BigQuery export:** Google Cloud's detailed billing export to BigQuery is the recommended path for authoritative $ cost (Cloud Monitoring gives volume, not billed dollars). Pattern confirmed via [Google Developer forum guide](https://discuss.google.dev/t/gcp-billing-export-to-bigquery-quick-guide-to-tracking-ai-costs/318584):
- Query the standard `gcp_billing_export_resource_v1_<BILLING_ACCOUNT_ID>` table.
- Filter `service.description` for `"Vertex AI"` (training/prediction/tuning) vs. `"Vertex AI Generative AI"` / similarly-named service that carries the Gemini-on-Vertex token meters — exact service.description string is account/catalog-dependent and **UNVERIFIED as a single fixed literal**; filter defensively with `LIKE '%Vertex AI%'` and inspect `sku.description` for `%Gemini%`.
- `sku.description` contains free-text like "Gemini 2.5 Pro Input Token" — no stable numeric SKU ID is published for hardcoding; SKUs are best resolved dynamically via the [Cloud Billing Catalog API](https://cloud.google.com/billing/v1/how-tos/catalog-api) (`services.skus.list`) rather than hardcoded strings.
- Reserved/provisioned-throughput consumption is split across a GCE-style SKU labeled `vertex-ai-online-prediction` plus a separate "Agent Platform Management Fee" SKU (per CloudZero/community write-ups — **UNVERIFIED**, no primary Google doc fetched confirming this exact split).
- **Caveat repeatedly emphasized by third-party FinOps writeups (not Google, but consistent across sources):** never assume a Gemini Developer API (AI Studio) dollar figure maps 1:1 to the Vertex AI SKU for the "same" model — they are billed on two separate meters/catalogs even when token counts match.

### 1c. Gemini CLI — local files & telemetry

**Directory layout** (`~/.gemini/`), confirmed via [Inventive HQ](https://inventivehq.com/knowledge-base/gemini/where-configuration-files-are-stored) and official docs:
- `~/.gemini/settings.json` — main config (created on first run): model prefs, MCP servers, telemetry block.
- `~/.gemini/oauth_creds.json` — OAuth credentials for personal-account auth (some install paths instead use the OS keychain — **UNVERIFIED which is authoritative on which platform**).
- `~/.gemini/.env` — optional API key storage.
- `~/.gemini/tmp/<project-hash>/...` — per-project session/chat history and logs (task brief's `chats/session-*.json` / `logs.json` layout could not be independently confirmed from a fetched primary source in this pass — **UNVERIFIED exact filenames**, but the existence of a per-project-hash tmp directory holding session history is corroborated by multiple community docs).
- `~/.gemini/GEMINI.md` — project/user memory file (not usage data).

**Per-turn token usage stored locally:** the `/stats` (`/stats model`) command reads from **local CLI session state**, not a remote call — confirmed: "It does not send a new reasoning request to the Gemini model and therefore does not count against your daily or minute-based limits" ([milvus.io Gemini CLI quick reference](https://milvus.io/ai-quick-reference/are-there-usage-limits-or-rate-limits-on-gemini-cli); [quota-and-pricing.md](https://github.com/google-gemini/gemini-cli/blob/main/docs/resources/quota-and-pricing.md)). This confirms per-session token/limit counters are held in local CLI state and are queryable without burning quota, which is exactly the surface a local `clai` connector would want to read/replicate — but the exact on-disk JSON schema for that state was not independently confirmed in this pass (**UNVERIFIED file path/schema**; the OTel event schema below is the verified, structured alternative).

**Telemetry configuration** (`.gemini/settings.json` → `telemetry` block), confirmed via [gemini-cli telemetry.md](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/telemetry.md):

| Field | Env var override | Values | Default |
|---|---|---|---|
| `enabled` | `GEMINI_TELEMETRY_ENABLED` | true/false | false |
| `target` | `GEMINI_TELEMETRY_TARGET` | `"gcp"` \| `"local"` | `"local"` |
| `otlpEndpoint` | `GEMINI_TELEMETRY_OTLP_ENDPOINT` | URL | `http://localhost:4317` |
| `otlpProtocol` | `GEMINI_TELEMETRY_OTLP_PROTOCOL` | `"grpc"` \| `"http"` | `"grpc"` |
| `outfile` | `GEMINI_TELEMETRY_OUTFILE` | file path | — (local-file mode) |
| `traces` | `GEMINI_TELEMETRY_TRACES_ENABLED` | true/false | false |
| `logPrompts` | `GEMINI_TELEMETRY_LOG_PROMPTS` | true/false | true |

Local file-capture example: `{ "telemetry": { "enabled": true, "target": "local", "otlpEndpoint": "", "outfile": ".gemini/telemetry.log" } }`.

**OTel metrics** (Counters):
- `gemini_cli.token.usage` — attributes: `model` (string), `type` (`"input"` \| `"output"` \| `"thought"` \| `"cache"` \| `"tool"`).
- `gemini_cli.api.request.count` — attributes: `model`, `status_code`, `error_type` (optional).
- `gemini_cli.session.count` — incremented once per CLI startup.
- Standard OTel `gen_ai.client.token.usage` is also emitted per-operation.

**OTel event `gemini_cli.api_response`** — fields (this is the richest structured record for per-call cost reconstruction):
```json
{
  "model": "gemini-2.5-pro",
  "status_code": 200,
  "duration_ms": 1423,
  "input_token_count": 8231,
  "output_token_count": 512,
  "cached_content_token_count": 4096,
  "thoughts_token_count": 128,
  "tool_token_count": 64,
  "total_token_count": 8935,
  "prompt_id": "abc123",
  "auth_type": "oauth-personal",
  "finish_reasons": ["STOP"]
}
```
Source: [gemini-cli telemetry.md](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/telemetry.md).

**Quotas** (confirmed via [quota-and-pricing.md](https://github.com/google-gemini/gemini-cli/blob/main/docs/resources/quota-and-pricing.md)):

| Tier | Daily requests | Notes |
|---|---|---|
| Personal Google account (free, Gemini Code Assist) | 1,000/day | Per-minute cap reported elsewhere as 60 RPM (task brief figure; not repeated in the primary doc fetched, treat as **UNVERIFIED-but-plausible**) |
| Unpaid Gemini API key | 250/day | Flash model only |
| Google AI Pro | 1,500/day | — |
| Google AI Ultra | 2,000/day | — |
| Vertex AI | Dynamic shared quota or pre-purchased provisioned throughput | No fixed numeric ceiling documented |

### 1d. Google Workspace ("Gemini in Workspace apps") admin reporting

Source: [developers.google.com Gemini in Workspace Apps Activity Events](https://developers.google.com/workspace/admin/reports/v1/appendix/activity/gemini-in-workspace-apps).

- API call: `Activities.list()` on the standard Admin SDK Reports API, `applicationName=gemini_in_workspace_apps`.
- Event name: `feature_utilization`; event type: `ai_usage_event`.
- Parameters (`events[].parameters[]`, key:value pairs):
  - `action` (string) — e.g. `add_to_calendar`, `auto_proofread`, `bulletize`, `conversation`, `generate_document`, `generate_form`, `generate_images_in_product`, `summarize`, `search_web`.
  - `app_name` (string) — `gemini_app`, `chat`, `classroom`, `docs`, `drive`, `gmail`, `keep`, `meet`, `sheets`, `slides`, `vids`.
  - `event_category` (string) — `active_conversations`, `active_generate`, `active_summarize`, `active_unspecified`, `inactive`, `unknown`.
  - `feature_source` (string) — `side_panel`, `help_me_write`, `help_me_visualize`, `ai_function`, `chat_with_gemini`, `take_notes_for_me`, `workflows_creation`, `workflows_execution`, others.
- **Data availability:** logs begin 2025-06-20T00:00:00Z, rolling 180-day retention.
- This is an **activity/adoption log, not a cost or token-count feed** — no token or dollar fields are present. It tells you *that* a user invoked Gemini in a given app/feature, not how many tokens or what it cost. For $ cost of Workspace-embedded Gemini, there is no separate per-seat usage-to-dollar meter published; Workspace's Gemini add-on is a flat per-seat license, not consumption-billed.

**Plan prices** (confirmed): Google AI Pro **$19.99/month** (historical/current baseline figure, matches task brief) — however Google restructured consumer AI plans at I/O 2026: Plus $7.99/mo, Pro $19.99/mo, a **new** AI Ultra tier at **$99.99/mo** (5x Pro limits, 20TB storage), and the original Ultra tier cut from $249.99 to **$199.99/mo** (some sources say "$200"; 20x Pro limits) — confirmed via [Digital Trends](https://www.digitaltrends.com/computing/googles-ai-subscriptions-get-a-new-100-tier-a-price-cut-and-new-features-across-all-plans/) and [Dataconomy](https://dataconomy.com/2026/05/20/google-ai-ultra-plan-price-cut-100-usd-subscription-revamp/). **Treat $249.99 as the pre-May-2026 legacy Ultra price; as of Sept 2026 the live price is $199.99–$200 for the 20x tier plus a new $99.99 5x tier.**

---

## 2. Cursor

### Admin API (Business/Enterprise) — `https://api.cursor.com`

Source: [cursor.com/docs/account/teams/admin-api](https://cursor.com/docs/account/teams/admin-api) (fetched 2026-09-03, official docs).

**Auth:** HTTP Basic, API key as username, empty password (`curl -u YOUR_API_KEY:`). Only team/org admins can create Admin API keys. Scopes: `usage:*` (covers `/teams/members`, `/teams/spend`, usage endpoints), `admin:*` (superset), `models:read`/`models:*` (model-access routes only).

**Rate limits** (per team): general default 20 req/min; `/teams/filtered-usage-events` 60 req/min; spend-limit updates 250 req/min; bulk spend limits 20 req/min; remove-member 50 req/min; billing groups 20 req/min; model access 20 req/min.

**Endpoints:**

| Endpoint | Method | Purpose |
|---|---|---|
| `/teams/members` | GET | Roster: `teamMembers[]` → `id, email, name, role, isRemoved` |
| `/teams/daily-usage-data` | POST | Per-user-per-day product usage (below) |
| `/teams/spend` | POST | Per-user spend/limits (below) |
| `/teams/filtered-usage-events` | POST | Per-event token/cost log (below) |
| `/teams/audit-logs` | GET | Security audit trail |
| `/teams/user-spend-limit`, `/teams/user-spend-limits` | POST | Set individual/bulk spend caps — **Enterprise only** |
| `/teams/remove-member` | POST | **Enterprise only** |
| `/teams/groups*` | GET/POST/PATCH/DELETE | Billing groups — **Enterprise feature** |
| `/teams/model-access/*` | GET/PUT | Model allow-list config |
| `/settings/repo-blocklists/repos*` | GET/POST/DELETE | Repo blocklist admin (not usage-related) |

**`POST /teams/daily-usage-data`** — request: `startDate`, `endDate` (epoch ms, required; span capped, paginate for >90-day ranges), optional `page`/`pageSize`. Response `data[]` fields: `userId`, `day`, `date`, `email`, `isActive` (only present with pagination), `totalLinesAdded`, `totalLinesDeleted`, `acceptedLinesAdded`, `acceptedLinesDeleted`, `totalApplies`, `totalAccepts`, `totalRejects`, `totalTabsShown`, `totalTabsAccepted`, `composerRequests`, `chatRequests`, `agentRequests`, `cmdkUsages`, `subscriptionIncludedReqs`, `apiKeyReqs`, `usageBasedReqs`, `bugbotUsages`, `mostUsedModel`, `applyMostUsedExtension`, `tabMostUsedExtension`, `clientVersion`.

**`POST /teams/spend`** — request: `searchTerm`, `sortBy` (`amount`\|`date`\|`user`), `sortDirection`, `page`, `pageSize`. Response `teamMemberSpend[]`: `userId`, `name`, `email`, `role`, `spendCents`, `overallSpendCents`, `fastPremiumRequests`, `hardLimitOverrideDollars`, `monthlyLimitDollars`, `effectivePerUserLimitDollars`; plus `subscriptionCycleStart`, `totalMembers`, `totalPages`.

**`POST /teams/filtered-usage-events`** — request: `startDate`, `endDate` (epoch ms, required), optional `userId`, `email`, `serviceAccountId`, `cloudAgentId`, `automationId`, `hostingType` (`CLOUD`\|`SELF_HOSTED`\|`SELF_HOSTED_POOL`\|`SELF_HOSTED_MACHINE`), `page`, `pageSize` (max 1000). Response `usageEvents[]`:
```json
{
  "timestamp": "1727712000000",
  "userEmail": "dev@company.com",
  "model": "claude-4-sonnet-thinking",
  "kind": "composer",
  "maxMode": false,
  "requestsCosts": 1,
  "isTokenBasedCall": true,
  "isChargeable": true,
  "isHeadless": false,
  "tokenUsage": {
    "inputTokens": 12000,
    "outputTokens": 800,
    "cacheWriteTokens": 3000,
    "cacheReadTokens": 9000,
    "totalCents": 14,
    "discountPercentOff": 0
  },
  "chargedCents": 14,
  "cursorTokenFee": 0
}
```
plus `totalUsageEventsCount`, `pagination`, `period`. This is the closest thing Cursor's Admin API has to a per-request cost ledger — **best endpoint for clai's event-level ingestion**.

**Plan prices** (confirmed via aggregator cross-check, [flexprice.io](https://flexprice.io/blog/cursor-pricing-guide) et al., since the official pricing page's dynamic pricing cards did not render cleanly under WebFetch): Hobby free; **Pro $20/mo** (~$20 included usage); **Pro+ $60/mo** (~$70 included usage); **Ultra $200/mo** (~$400 included usage); **Teams $40/user/mo**; **Enterprise custom** (invoice billing, pooled usage, SCIM). All paid plans bill overage in arrears at metered rates once included credits are exhausted.

### Unofficial personal-usage endpoints (used by community VS Code extensions — mark all UNOFFICIAL, subject to breakage without notice)

Source: [Dwtexe/cursor-stats](https://github.com/Dwtexe/cursor-stats) (README/issues; **repo archived 2026-03-08, read-only** — a sign of how fragile this integration path is), plus several forks (`Sammy970/cursor-usage-extension`, `YossiSaadi/cursor-usage-vscode-extension`, `Tendo33/cursor-usage-tracker`).

- `GET https://cursor.com/api/usage?user=<userId>` — requires cookie `WorkosCursorSessionToken=<userId>::<accessToken>` (same session cookie the cursor.com dashboard uses in-browser).
- `/api/auth/stripe`, `/api/dashboard/get-monthly-invoice` — named in various extension source trees for Stripe profile / invoice data; exact paths **UNVERIFIED** in this pass (could not fetch source directly; forum evidence only shows a related `api2.cursor.sh/auth/full_stripe_profile` call being polled client-side — [Cursor forum thread](https://forum.cursor.com/t/cursor-repeatedly-polling-full-stripe-profile-endpoint/49202)).
- **Local credential extraction:** the session token is read out of Cursor's local SQLite state file (`state.vscdb`, standard VS Code global-storage location), `ItemTable` row with key `cursorAuth/accessToken` holding the access token. Some extensions combine this with the `userId` also stored locally to build the cookie above without ever opening a browser.
- **Why this matters for clai:** this is the *only* path for a non-admin/individual Cursor user to see their own usage programmatically — the official Admin API is admin/team-key-gated. It is inherently fragile (cookie format, endpoint paths, and DB schema are undocumented and have changed before — hence the archived repo) and should be flagged clearly as unofficial/best-effort in any clai connector, with graceful degradation when it breaks.

---

## 3. GitHub Copilot

### Copilot metrics API — **the legacy endpoint is sunset; a new report-based API replaced it in 2026**

**Legacy** `GET /orgs/{org}/copilot/metrics` (daily records inline JSON, with the `copilot_ide_code_completions.editors[].models[].languages[]` nesting described in the task brief) — **fully sunset 2026-04-02** ([devactivity.com](https://devactivity.com/insights/navigating-github-copilot-metrics-adapting-to-api-deprecation-and-enhancing-github-tracking/), corroborated by GitHub community discussions). Any clai connector built against the old inline-JSON shape will be broken as of today (2026-09-03).

**Current API** ("Copilot usage metrics" reports), confirmed via [docs.github.com REST API endpoints for Copilot usage metrics](https://docs.github.com/en/rest/copilot/copilot-usage-metrics?apiVersion=2026-03-10):

| Endpoint | Scope |
|---|---|
| `GET /orgs/{org}/copilot/metrics/reports/organization-1-day?day=YYYY-MM-DD` | Org, single day |
| `GET /orgs/{org}/copilot/metrics/reports/organization-28-day/latest` | Org, rolling 28-day |
| `GET /orgs/{org}/copilot/metrics/reports/repos-1-day?day=YYYY-MM-DD` | Per-repo, single day |
| `GET /orgs/{org}/copilot/metrics/reports/users-1-day?day=YYYY-MM-DD` | Per-user, single day |
| `GET /orgs/{org}/copilot/metrics/reports/users-28-day/latest` | Per-user, rolling 28-day |
| `GET /orgs/{org}/copilot/metrics/reports/user-teams-1-day?day=YYYY-MM-DD` | User↔team mapping |
| `GET /enterprises/{enterprise}/copilot/metrics/reports/...` | Same set, enterprise-scoped |

Response envelope is **not** the data itself — it returns signed download links:
```json
{ "download_links": ["https://..."], "report_day": "2026-09-01" }
```
(28-day variant returns `report_start_day`/`report_end_day` instead of `report_day`). The actual data is fetched from the signed URL as **NDJSON** (one JSON object per line), links expire quickly so must be consumed promptly. Prereq: org/enterprise policy "Copilot usage metrics" must be set to **Enabled everywhere**.

**NDJSON schema** (confirmed field names, [docs.github.com Copilot usage metrics reference](https://docs.github.com/en/copilot/reference/copilot-usage-metrics) + example-schema page):
- Per-user record: `user_id`, `user_login`, `day`, `enterprise_id`, `ai_adoption_phase`, `ai_credits_used`, `code_acceptance_activity_count`, `code_generation_activity_count`, `loc_added_sum`, `loc_deleted_sum`; nested breakdowns **by CLI** (`prompt_count`, `request_count`, `session_count`, `token_usage`), **by IDE** (e.g. `vscode` with version), **by feature** (`code_completion`, `copilot_app`), **by language-feature**.
- Per-enterprise/org day totals: `day_totals[]` with `code_acceptance_activity_count`, `code_generation_activity_count`, `daily_active_users`, `monthly_active_users`, `loc_added_sum`, `loc_deleted_sum`, plus PR analytics (`total_created`, `total_created_by_copilot`, `total_merged`, `median_minutes_to_merge`). As of July 2026 also carries `daily_active_copilot_app_users` and `totals_by_copilot_app` (`session_count`, `request_count`, `prompt_count`, `token_usage`) — [GitHub Changelog 2026-07-17](https://github.blog/changelog/2026-07-17-github-copilot-app-now-available-in-the-usage-metrics-api/).
- Per-repo record: `day`, `enterprise_id`, `organization_id`, `repo_id`, `repo_name`, `repo_visibility`, nested `pull_requests` object incl. `copilot_suggestions_by_comment_type` (e.g. "spelling", "documentation").

**`ai_credits_used` at the per-user record is the key field for clai** — cost is now embedded directly in the metrics feed rather than requiring a join against the separate billing-usage endpoint.

**Required permissions:** Org — `read:org` OAuth/PAT scope + org owner or "View Organization Copilot Metrics" fine-grained permission. Enterprise — `manage_billing:copilot` or `read:enterprise` + enterprise owner/billing manager or "View Enterprise Copilot Metrics" fine-grained permission. Data available from 2025-10-10, retained up to 1 year.

### Billing / seats

`GET /orgs/{org}/copilot/billing` — org-owner only, scopes `manage_billing:copilot` or `read:org`. Response: `seat_breakdown` (`total`, `added_this_cycle`, `pending_cancellation`, `pending_invitation`, `active_this_cycle`, `inactive_this_cycle`), `seat_management_setting` (`assign_all`\|`assign_selected`\|`disabled`\|`unconfigured`), `plan_type` (`business`\|`enterprise`), plus policy flags `public_code_suggestions`, `ide_chat`, `platform_chat`, `cli`.

`GET /orgs/{org}/copilot/billing/seats` (paginated, max 100/page) — same auth. `seats[]`: `created_at`, `updated_at` (deprecated field), `pending_cancellation_date`, `last_activity_at`, `last_activity_editor`, `plan_type` (`business`\|`enterprise`\|`unknown`), `assignee` (user object), `assigning_team`.

### Premium-requests → usage-based billing transition (major 2026 change)

GitHub Copilot moved to **usage-based billing on 2026-06-01**, replacing Premium Request Units (PRUs) with **GitHub AI Credits** (1 credit = $0.01 USD), confirmed via [docs.github.com usage-based-billing-for-organizations-and-enterprises](https://docs.github.com/en/copilot/concepts/billing/usage-based-billing-for-organizations-and-enterprises) and [GitHub Blog](https://github.blog/news-insights/company-news/github-copilot-is-moving-to-usage-based-billing/):
- Token consumption (input/output/cached) is converted to credits per-model at published per-model rates.
- **Code completions and next-edit suggestions are NOT billed in credits** — unlimited on paid plans. Credits are consumed by Copilot Chat, Copilot CLI, Copilot cloud/coding agent, Copilot Spaces, Spark, and third-party coding agents routed through Copilot.
- Included monthly credits: Business 1,900 (promo 3,000 through Sept 1 2026), Enterprise 3,900 (promo 7,000 through Sept 1 2026) — pooled at org level, not per-seat individually, reset UTC midnight on the 1st, no rollover.
- Overage bills "at published per-credit rates" once pool exhausted, unless admin disables additional paid usage via AI Controls.
- Old flat "$0.04 overage per premium request" and model-multiplier table (task brief) describe the **pre-June-2026 PRU model** — now superseded; do not use for current billing math.

**Billing usage report API** (org-level $ ledger), confirmed via [docs.github.com REST billing usage](https://docs.github.com/en/rest/billing/usage?apiVersion=2022-11-28):
- `GET /organizations/{org}/settings/billing/usage` — query params `year`, `month`, `day` (all optional integers; no `hour` param). Requires org/enterprise admin; **only available to orgs on the "enhanced billing platform."**
- Response `usageItems[]`: `date`, `product`, `sku`, `quantity`, `unitType`, `pricePerUnit`, `grossAmount`, `discountAmount`, `netAmount`, `organizationName`, `repositoryName` (optional). This is the general GitHub billing-usage endpoint (covers Actions, Packages, Copilot, etc. — filter `product`/`sku` for Copilot rows).

**Plan prices** (confirmed, [visualstudiomagazine.com](https://visualstudiomagazine.com/articles/2026/04/27/devs-sound-off-on-usage-based-copilot-pricing-change-you-will-get-less-but-pay-the-same-price.aspx), [GitHub Blog](https://github.blog/news-insights/company-news/github-copilot-is-moving-to-usage-based-billing/)): Free tier exists; **Pro $10/mo** (converts to ~$15 in credits as of July 2026 promo pricing); **Pro+ $39/mo** (~$70 credits); **Business $19/user/mo** (1:1 → $19 credits + the 1,900-credit pool language above — reconcile these two figures against live docs, they come from different snapshots); **Enterprise $39/granted seat/mo**.

**Individual users and token-level data:** could not find a documented API or UI surface giving Copilot Individual (Pro/Pro+) subscribers a token-level usage export; the individual billing page shows credits consumed/remaining, not raw token counts per request. **Treat "no token-level data for individual users" as materially confirmed by absence of any documented endpoint**, per task brief's premise.

---

## 4. OpenRouter

All endpoints below are official, confirmed against [openrouter.ai/docs](https://openrouter.ai/docs) (fetched 2026-09-03). Base URL `https://openrouter.ai/api/v1`.

### `GET /auth/key` (a.k.a. `/api/v1/auth/key`, alias `/api/v1/key`)

Auth: `Authorization: Bearer <API_KEY>` (a regular inference key, not a management key). Response:
```json
{
  "data": {
    "label": "sk-or-...",
    "usage": 12.34,
    "usage_daily": 0.45,
    "usage_weekly": 3.10,
    "usage_monthly": 12.34,
    "limit": 100,
    "limit_remaining": 87.66,
    "is_free_tier": false,
    "rate_limit": { "requests": 200, "interval": "10s" }
  }
}
```
`usage*` fields are in OpenRouter credits (≈USD). `limit`/`limit_remaining` are `null` when unlimited. This is the standard "check my key's remaining budget" call — cheap, no pagination, safe to poll frequently.

### `GET /generation?id=<generation_id>`

Returns full accounting for one specific completion (the `id` comes back in every chat/completion response). Confirmed fields: `id`, `upstream_id`, `request_id`, `session_id`, `model`, `router`, `api_type`, `app_id`, `preset_id`, `created_at`, `generation_time`, `latency`, `moderation_latency`, `tokens_prompt`, `tokens_completion`, `native_tokens_prompt`, `native_tokens_completion`, `native_tokens_reasoning`, `native_tokens_cached`, `native_tokens_completion_images`, `total_cost`, `usage`, `upstream_inference_cost`, `cache_discount`, `provider_name`, `provider_responses`, `service_tier`, `origin`, `http_referer`, `user_agent`, `external_user`, `data_region`, `workspace_id`, `is_byok`, `num_media_prompt`, `num_media_completion`, `num_input_audio_prompt`, `num_search_results`, `num_fetches`, `web_search_engine`, `streamed`, `cancelled`, `finish_reason`, `native_finish_reason`, `response_cache_source_id`. `total_cost` is the authoritative per-call dollar figure; `tokens_*` are OpenAI-normalized counts while `native_tokens_*` are the provider's own counts (useful when they diverge, e.g. reasoning/cached tokens).

### `GET /activity` — requires a **Management (provisioning) key**, not a regular inference key

Confirmed via [openrouter.ai/docs/api/api-reference/analytics/get-user-activity](https://openrouter.ai/docs/api/api-reference/analytics/get-user-activity). Returns per-endpoint daily rows for the last 30 completed UTC days.

Query params: `date` (single YYYY-MM-DD, optional — omit for the full 30-day window), `api_key_hash` (SHA-256 hex, as returned by the keys API), `user_id` (org member id, org accounts only), `workspace_id`, `group_by=workspace` (adds `workspace_id` to each row).

Response `data[]`:
```json
{
  "date": "2026-08-24",
  "model": "openai/gpt-4.1",
  "model_permaslug": "openai/gpt-4.1-2026-04-14",
  "endpoint_id": "9f1c...-uuid",
  "provider_name": "OpenAI",
  "usage": 4.21,
  "byok_usage_inference": 0,
  "requests": 130,
  "prompt_tokens": 240000,
  "completion_tokens": 18000,
  "reasoning_tokens": 0
}
```
`usage` = total cost in USD for that model/day/endpoint slice; `byok_usage_inference` = cost attributable to Bring-Your-Own-Key inference (routed but not charged to OpenRouter credits the same way). This is the endpoint to poll for a daily cost/usage rollup by model — **this is clai's primary OpenRouter ingestion target** for team/org-level reporting.

### `GET /credits`

Returns `total_credits` and `total_usage` for the account (management-key scope). Simpler, account-wide version of `/auth/key`'s usage fields.

### Usage accounting on every completion response (no separate call needed)

As of the current API version, `"usage": {"include": true}` / `"stream_options": {"include_usage": true}` request flags are **deprecated no-ops — full usage is now always returned automatically** on every response (confirmed, [openrouter.ai/docs/cookbook/administration/usage-accounting](https://openrouter.ai/docs/cookbook/administration/usage-accounting)):
```json
{
  "usage": {
    "completion_tokens": 2,
    "completion_tokens_details": { "reasoning_tokens": 0 },
    "cost": 0.95,
    "cost_details": { "upstream_inference_cost": 19 },
    "prompt_tokens": 194,
    "prompt_tokens_details": {
      "cached_tokens": 0,
      "cache_write_tokens": 100,
      "audio_tokens": 0
    },
    "total_tokens": 196
  }
}
```
For streaming requests, the final SSE chunk carries this object. **This inline `usage.cost` field is the cheapest and most reliable per-call cost source for any clai integration that proxies or wraps OpenRouter calls directly** — no polling needed, no separate endpoint, no management key required.

### Provisioning (Management) Keys API — `/api/v1/keys`

Auth: Management API key (separate credential class from inference keys; cannot itself call completion endpoints). `GET /keys` (list, paginated via `offset`), `POST /keys` (create), `GET /keys/{key_hash}`, `PATCH /keys/{key_hash}`, `DELETE /keys/{key_hash}`. Key object fields: `hash`, `label`, `name`, `disabled`, `limit`, `limit_remaining`, `limit_reset` (`daily`\|`weekly`\|`monthly`\|`null`, resets at UTC midnight, weeks Mon–Sun), `include_byok_in_limit`, `usage`, `usage_daily`, `usage_weekly`, `usage_monthly`, `byok_usage*` variants, `created_at`, `updated_at`. **This is the natural mechanism for clai to mint one key per tracked user/team-member and pull individual budgets/usage without needing each user's own credential.**

Activity CSV/PDF export exists as a dashboard feature (openrouter.ai/activity → Export) but has no documented API endpoint of its own — **UNVERIFIED / dashboard-only**, use the `/activity` JSON endpoint above instead for programmatic access.

---

## 5. AWS Bedrock

### Cost Explorer (`GetCostAndUsage`)

Standard Cost Explorer API call, filter `SERVICE = "Amazon Bedrock"`, group by `USAGE_TYPE` (encodes region + model + token-class, e.g. `USE1-Bedrock/Anthropic/Claude-3-Sonnet-Input-Tokens` style strings — exact string format is model/region-specific and not independently enumerable here; inspect a live billing export to get exact literals). Supports the standard CE dimensions (`GRANULARITY=DAILY/MONTHLY`, `Metrics=UnblendedCost`, `Filter`/`GroupBy` by `SERVICE`, `USAGE_TYPE`, `LINKED_ACCOUNT`, or a `TAG` cost-allocation-tag key). This is the authoritative **billed-dollar** source for Bedrock; standard AWS Cost Explorer auth/IAM (`ce:GetCostAndUsage`) and pricing apply (no Bedrock-specific auth quirks). UNVERIFIED: exact current `USAGE_TYPE` string catalog (AWS does not publish a fixed enumerable list; it is derived from the Price List API / billing data itself).

### CloudWatch `AWS/Bedrock` namespace

Standard CloudWatch metrics namespace, dimensioned by `ModelId` (and `Operation` where applicable):
- `InputTokenCount`, `OutputTokenCount` — token volume (not $) per model.
- `Invocations`, `InvocationClientErrors`, `InvocationServerErrors`, `InvocationThrottles` — call counts.
- `InvocationLatency` — latency distribution.
- `OutputImageCount` (for image models), `LegacyModelInvocations` (deprecated-model tracking).

Access via standard CloudWatch `GetMetricData`/`GetMetricStatistics`, IAM `cloudwatch:GetMetricData`. Free (CloudWatch's own request costs aside) and near-real-time (~1 min granularity), but **gives volume, not dollars** — must be joined against Bedrock's public per-model price list to estimate cost, and estimates can drift from the CE/billing figure (e.g. batch discounts, PrOV throughput commitments, cross-region inference pricing are not reflected in a naive tokens × list-price calc).

### Model invocation logging (S3 / CloudWatch Logs)

Opt-in feature (`bedrock:PutModelInvocationLoggingConfiguration`) that writes one JSON record per invocation to S3 and/or a CloudWatch Logs group. Confirmed structure (from AWS docs, standard Bedrock invocation-log schema):
```json
{
  "schemaType": "ModelInvocationLog",
  "timestamp": "2026-09-03T12:00:00Z",
  "accountId": "123456789012",
  "identity": { "arn": "arn:aws:sts::123456789012:assumed-role/MyRole/session" },
  "region": "us-east-1",
  "modelId": "anthropic.claude-3-sonnet-20240229-v1:0",
  "input": { "inputContentType": "application/json", "inputTokenCount": 512 },
  "output": { "outputContentType": "application/json", "outputTokenCount": 128 }
}
```
This is the only per-request, per-identity (`identity.arn`) record with both token counts and the calling principal — best source for **attributing** Bedrock spend to a specific IAM role/user/application inside clai, since Cost Explorer and CloudWatch metrics are aggregate-only and don't carry caller identity.

### Application inference profiles + cost allocation tags

"Application inference profiles" let you create a named, taggable proxy for a base model; invocations through the profile inherit its cost-allocation tags, which then appear as tag dimensions in Cost Explorer/CUR. This is AWS's recommended mechanism for **splitting Bedrock spend by team/project/environment** without needing per-caller log parsing — tag the inference profile once, and all downstream CE/CUR queries can `GroupBy TAG`. Combine with the CUR (Cost and Usage Report) export to Parquet/CSV in S3 for the most granular billing-grade dataset (superset of Cost Explorer, queryable via Athena/Redshift Spectrum).

Brief by design — Bedrock is one of many providers here; the three mechanisms above (CE for $, CloudWatch for near-real-time volume, invocation logs for identity-level attribution) cover the practical connector surface.

---

## 6. Mistral, xAI (Grok), DeepSeek, Cohere, Perplexity

### Pricing (per 1M tokens, USD) — main current models, Sept 2026 snapshot

All figures below are aggregator-sourced (no official pricing page was fetched directly for this batch — every row should be treated as **UNVERIFIED against primary source** even though cross-referenced across 2+ independent aggregators for consistency).

| Provider | Model | Input | Output | Notes | Source |
|---|---|---|---|---|---|
| Mistral | Mistral Medium 3.5 | $1.50 | $7.50 | flagship | [cloudzero.com](https://www.cloudzero.com/blog/mistral-api-pricing/) |
| Mistral | Mistral Large 3 | $0.50 | $1.50 | | same |
| Mistral | Mistral Small 4 | $0.15 | $0.60 | | same |
| Mistral | Ministral 3 (3B edge) | $0.10 | $0.10 | symmetric | same |
| Mistral | Codestral | $0.30 | $0.90 | code-specialized | same |
| Mistral | Magistral Small / Medium | $0.50/$1.50 | $2.00/$5.00 | reasoning models | same |
| xAI | Grok 4.6 (released 2026-08-12) | $2.00 (<200K) / $4.00 (≥200K) | $6.00 (<200K) / $12.00 (≥200K) | cached input $0.50 / $1.00 | [mem0.ai](https://mem0.ai/blog/xai-grok-api-pricing) |
| xAI | Grok 4.3 | $1.25 | $2.50 | original Grok 4 retired 2026-05-15, silently redirects to 4.3 | same |
| xAI | Grok Build 0.1 | $1.00 | $2.00 | coding-specialized | same |
| DeepSeek | DeepSeek-V4-Flash (off-peak) | $0.22 (cache miss) / $0.007 (cache hit) | $0.66 | off-peak = outside 01:00–04:00 & 06:00–10:00 UTC | [benchlm.ai](https://benchlm.ai/blog/posts/deepseek-api-pricing) |
| DeepSeek | DeepSeek-V4-Flash (peak) | $0.44 / $0.014 | $1.32 | peak = exactly 2x off-peak | same |
| DeepSeek | DeepSeek-V4-Pro (off-peak) | $0.66 / $0.022 | $1.98 | | same |
| DeepSeek | DeepSeek-V4-Pro (peak) | $1.32 / $0.044 | $3.96 | | same |
| Cohere | Command A | ~$2.50 | ~$10.00 | flagship-class, exact current figure **UNVERIFIED** | [pricepertoken.com](https://pricepertoken.com/pricing-page/provider/cohere) |
| Cohere | Command R7B | $0.0375 | $0.15 | cheapest hosted Cohere model | same |
| Perplexity | Sonar | $1.00 | $1.00 | + per-request fee, see below | [docs.perplexity.ai](https://docs.perplexity.ai/docs/getting-started/pricing) |
| Perplexity | Sonar Pro | $3.00 | $15.00 | + per-request fee | same |

**Legacy model naming note (DeepSeek):** `deepseek-chat` (non-thinking) and `deepseek-reasoner` (thinking) model aliases were **deprecated 2026-07-24 15:59 UTC**; both now map onto `deepseek-v4-flash` with a `reasoning_effort` request parameter (`low`/`high`/`max`) instead of a distinct model id — any clai pricing table keyed on the old model-name strings needs a mapping/fallback for historical logs plus the new naming going forward.

**Perplexity per-request search fee** (separate from token price, billed per 1,000 requests, scales with `search_context_size`): Sonar $5–$12/1K requests (low→high context); Sonar Pro $6–$14/1K requests; Sonar Reasoning Pro carries the same style of fee. This fee must be added on top of token cost for any Perplexity Sonar cost reconstruction — token price alone under-counts actual spend.

### Usage/balance endpoints

**xAI** — two distinct APIs, different base URLs and different auth:
- Inference API key check: `GET https://api.x.ai/v1/api-key` (task brief's endpoint) returns the calling key's own metadata — **UNVERIFIED exact field list** for this specific inference-API-key-scoped route in this pass.
- Separate **Management API** at `https://management-api.x.ai` (requires a distinct "management key", not an inference API key) exposes full team/key administration: create/list/update/delete API keys, response fields confirmed via search as `redacted_api_key`, `user_id`, `name`, `create_time`, `modify_time`, `modified_by`, `team_id`, `acls`, `api_key_id`, `team_blocked`, `api_key_blocked`, `api_key_disabled` ([docs.x.ai/developers/management-api-guide](https://docs.x.ai/developers/management-api-guide), [docs.x.ai/developers/rest-api-reference/management/auth](https://docs.x.ai/developers/rest-api-reference/management/auth)). No dollar/usage field was confirmed in the Management API key object itself — it looks like an access-control API, not a spend/usage API; **UNVERIFIED whether xAI exposes a programmatic $ usage/spend read anywhere** (the console likely shows spend in the UI only).

**DeepSeek** — `GET https://api.deepseek.com/user/balance`, Bearer auth, confirmed response shape ([api-docs.deepseek.com/api/get-user-balance](https://api-docs.deepseek.com/api/get-user-balance/)):
```json
{
  "is_available": true,
  "balance_infos": [
    { "currency": "USD", "total_balance": "8.76", "granted_balance": "0.00", "topped_up_balance": "8.76" }
  ]
}
```
`is_available` is a boolean sufficiency flag (not a forecast); `total_balance = granted_balance + topped_up_balance`. This is a **balance** read, not a usage-log read — DeepSeek does not appear to expose a separate per-call usage history API (token counts must be captured from each response's own `usage` object at call time, same pattern as most direct-provider APIs).

**Mistral, Cohere, Perplexity** — no dedicated usage/balance REST endpoint analogous to DeepSeek's or xAI's was found in this pass; **UNVERIFIED / likely dashboard-only** for self-serve spend visibility (standard pattern: per-call `usage` object in each completion response is the only programmatic signal, console/billing-portal for historical spend).

### Consumer plan prices (confirmed, cross-referenced)

| Plan | Price | Source |
|---|---|---|
| Le Chat Free | $0 | soft-capped ~25 msgs/day |
| Le Chat Pro | $14.99/mo | [cloudzero.com](https://www.cloudzero.com/blog/mistral-api-pricing/) |
| Le Chat Team | $24.99/user/mo (monthly) / $19.99/user/mo (annual) | same |
| SuperGrok | $30/mo | [ai-toolbox.co](https://www.ai-toolbox.co/grok-models/grok-pricing-plans-api-2026) |
| SuperGrok Heavy | $300/mo (promo $99/mo first 3 months seen historically) | same |
| Perplexity Pro | $20/mo | [screenapp.io](https://screenapp.io/blog/perplexity-pricing) |
| Perplexity Max | $200/mo | same |
| Perplexity Enterprise Pro | $40/seat/mo ($400/yr) | [coworker.ai](https://coworker.ai/blog/perplexity-enterprise-pricing) |
| Perplexity Enterprise Max | $325/seat/mo ($3,250/yr) | same |

---

## 7. Microsoft 365 Copilot

**Price** (confirmed, [ucstrategies.com](https://ucstrategies.com/news/microsoft-copilot-guide-specs-pricing-graph-grounding-explained-2026/)): Microsoft 365 Copilot **Business** $21/user/mo (annual commitment) or $25/user/mo (monthly billing), requires a qualifying Business plan license underneath. **Enterprise** $30/user/mo (annual commitment), requires a qualifying Enterprise (E3/E5) license underneath. Copilot is a per-seat add-on license, not consumption-metered for the core M365-app experience (Word/Excel/PowerPoint/Outlook/Teams Copilot) — usage reporting is adoption/activity telemetry, not a cost meter.

### Graph API — usage reports (endpoint path has moved in 2026)

**Important migration note found directly in the current Microsoft Learn page** (fetched 2026-09-03): "Going forward, use the Microsoft 365 Copilot usage APIs under the `/copilot` URL path segment" — i.e. the historical `/reports/getMicrosoft365CopilotUsageUserDetail(...)` path is being superseded by `/copilot/reports/getMicrosoft365CopilotUsageUserDetail(...)`. Both were observed still documented; **a clai connector should target the new `/copilot/reports/...` path segment going forward** and treat the bare `/reports/...` path as deprecated/legacy.

`GET /reports/getMicrosoft365CopilotUsageUserDetail(period='{period_value}')` (or `/copilot/reports/...`) — confirmed via [Microsoft Learn](https://learn.microsoft.com/en-us/graph/api/reportroot-getmicrosoft365copilotusageuserdetail?view=graph-rest-beta):
- `period` values: `D7`, `D30`, `D90`, `D180`, `ALL` (ALL returns all four windows).
- `$format` query param: `application/json` (default) or `text/csv` — CSV mode returns `302 Found` with a short-lived preauthenticated download URL in the `Location` header (no `Authorization` header needed to fetch it).
- Permission: delegated or application `Reports.Read.All` (least-privileged); delegated calls additionally require the signed-in admin to hold one of: Company Administrator, Exchange Administrator, SharePoint Administrator, Lync/Teams Service/Teams Communications Administrator, Global Reader, Usage Summary Reports Reader, or Reports Reader.
- JSON response example (field names verbatim, IDs are hashed/pseudonymized by the docs, not real):
```json
{
  "value": [
    {
      "reportRefreshDate": "2024-08-20",
      "userPrincipalName": "user@contoso.com",
      "displayName": "Jane Doe",
      "lastActivityDate": "2024-08-20",
      "copilotChatLastActivityDate": "2024-08-16",
      "microsoftTeamsCopilotLastActivityDate": "2024-08-20",
      "wordCopilotLastActivityDate": "2024-08-06",
      "excelCopilotLastActivityDate": "",
      "powerPointCopilotLastActivityDate": "2024-03-26",
      "outlookCopilotLastActivityDate": "",
      "oneNoteCopilotLastActivityDate": "",
      "loopCopilotLastActivityDate": "",
      "copilotActivityUserDetailsByPeriod": [ { "reportPeriod": 7 } ]
    }
  ]
}
```
CSV mode returns the same fields as columns: `Report Refresh Date, Report Period, User Principal Name, Display Name, Last Activity Date, Microsoft Teams Copilot Last Activity Date, Word Copilot Last Activity Date, Excel Copilot Last Activity Date, PowerPoint Copilot Last Activity Date, Outlook Copilot Last Activity Date, OneNote Copilot Last Activity Date, Loop Copilot Last Activity Date, Copilot Chat Last Activity Date`.

**Related endpoints** (same permission model, not independently re-fetched this pass, paths confirmed via search): `getMicrosoft365CopilotUserCountSummary(period='{period}')` — aggregated active/enabled user counts for the period; `getMicrosoft365CopilotUserCountTrend(period={period}, version={version})` — daily trend of active/enabled counts. All three are **activity/adoption reports only — no token counts, no dollar amounts, no per-message costs anywhere in this API family.** This is materially the same limitation as Google Workspace's Gemini reporting (§1d): great for seat-utilization/adoption dashboards, useless for $ cost attribution, because the underlying product is flat-fee per-seat, not consumption-billed.

### Copilot Studio metering (separate product, separate billing model — this one IS consumption-based)

Copilot Studio (the agent-builder product, distinct from M365 Copilot) bills in **Copilot Credits** per billed session (a session = one customer↔agent interaction; test-chat messages in the builder don't count). **Confirmed: there is no public/preview REST or Graph API to pull agent-level credit/session consumption programmatically** — a Microsoft engineer states this directly on Microsoft Q&A ([learn.microsoft.com/answers/questions/5612275](https://learn.microsoft.com/en-us/answers/questions/5612275/is-there-a-public-or-preview-api-to-fetch-copilot)). Consumption is visible only in the Copilot Studio admin portal and the Power Platform admin center's capacity-management UI ([learn.microsoft.com/power-platform/admin/manage-copilot-studio-messages-capacity](https://learn.microsoft.com/en-us/power-platform/admin/manage-copilot-studio-messages-capacity)). **For clai: Copilot Studio has no programmatic ingestion path today — UI-only / manual export, flag as P2 or "not integrable" until Microsoft ships an API.**

---

## 8. Local coding-agent logs — other tools

General caveat for this whole section: none of these are documented public APIs — they are reverse-engineered file formats maintained by community usage-tracking tools (`ccusage`, `tokscale`, `opencode-stats`, etc.). Paths and field names can change without notice on any point release of the underlying tool. Treat every path below as **best-effort / unofficial** even where a single community tool corroborates it.

### OpenCode

Confirmed via [ccusage.com/guide/opencode](https://ccusage.com/guide/opencode/) and [tokscale README](https://github.com/junhoyeo/tokscale):
- Storage root: `~/.local/share/opencode/storage/` — `session/{projectHash}/{sessionID}.json`, `message/{sessionID}/msg_{messageID}.json` (older layout: separate `part/` files per message chunk, per the task brief's `{session,message,part}/` triad).
- OpenCode v1.2+ consolidates into a single SQLite file: `~/.local/share/opencode/opencode.db`.
- Message JSON fields (per task brief, corroborated): `role`, `modelID`, `providerID`, `tokens: {input, output, reasoning, cache: {read, write}}`, `cost`, `time`.
- **Known bug (confirmed via GitHub issue):** OpenCode's own displayed/stored `cost` field can be wrong — [issue #28494](https://github.com/anomalyco/opencode/issues/28494) reports OpenCode's cost calculation **ignores cache-read tokens entirely**, under-reporting true cost by 2–3x for heavy-caching sessions. **Implication: clai should not trust the stored `cost` field as ground truth — recompute from `tokens.*` and current model pricing instead**, exactly the pattern `opencode-stats`/`tokscale` already use (LiteLLM pricing DB with OpenRouter fallback).
- `opencode stats` — built-in CLI command exists (per task brief) for local session summary; not independently re-verified in this pass beyond third-party tool descriptions that explicitly model themselves after it.

### Cline (`saoudrizwan.claude-dev`) and Roo Code (`rooveterinaryinc.roo-cline`)

Both are forks sharing the same VS Code `globalStorage` task-log design. Confirmed via GitHub discussions/issues on each repo:
- macOS: `~/Library/Application Support/Code/User/globalStorage/<extension-id>/tasks/<task-id>/`
- Linux: `~/.config/Code/User/globalStorage/<extension-id>/tasks/<task-id>/` (or `~/.vscode-server/...` for remote/WSL/SSH sessions — confirmed distinct path cited for Roo Code)
- Windows: `%APPDATA%\Code\User\globalStorage\<extension-id>\tasks\<task-id>\`
- `state/taskHistory.json` — index of all tasks (top-level `globalStorage`, sibling to `tasks/`).
- Per-task-directory files: `api_conversation_history.json` (raw model I/O incl. tool calls/results), `ui_messages.json` (what rendered in the chat panel — **this is the file usage trackers actually parse**), `task_metadata.json`.
- Within `ui_messages.json`, entries of type **`api_req_started`** carry the usage payload (confirmed field names, cross-tool via the `tokscale` parser): `tokensIn`, `tokensOut`, `cacheWrites`, `cacheReads`, `cost`, `apiProtocol`.
- **Reliability caveat:** both repos have open issues about task-history JSON corruption / silent data loss ([cline#7101](https://github.com/cline/cline/issues/7101), [cline#7736](https://github.com/cline/cline/issues/7736)) and Roo Code's `tasks` directory growing unbounded and consuming disk space ([Roo-Code#4174](https://github.com/RooCodeInc/Roo-Code/issues/4174)) — a clai file-watcher connector needs to tolerate missing/partial/corrupt JSON gracefully.

### Aider

Confirmed via [aider.chat docs](https://aider.chat/docs/config/options.html) and GitHub issues:
- `.aider.chat.history.md` (per-project, in repo root) — human-readable transcript; **cost is embedded as inline text**, e.g. `> Tokens: 38k sent, 1.1k received.` — requires text/regex parsing, not structured JSON. Grows unbounded; not designed as a machine-readable ledger.
- `~/.aider/analytics.json` — created on first run, holds a random UUID4 for the anonymous analytics identity (not itself a usage ledger).
- `.aider.analytics.json` (per the task brief) — analytics event log; the `message_send` event type is the one carrying "detailed token usage and calculated costs based on model metadata" per [DeepWiki's Aider usage-analytics page](https://deepwiki.com/Aider-AI/aider/12.1-usage-analytics) — exact per-event field names **UNVERIFIED** in this pass (DeepWiki is a third-party summarization site, not Aider's own docs).
- `.aider.model.metadata.json` — lets users/aider define custom model pricing (`max_tokens`, `max_input_tokens`, `input_cost_per_token`, `output_cost_per_token`) for models Aider doesn't already know the price of — useful as a fallback pricing table but not a usage record itself.
- **Reliability:** the `.md` history file is the most stable/long-standing format but the least structured (text parsing required); `analytics.json` is opt-in-ish and less universally present.

### GitHub Copilot CLI

Confirmed via [docs.github.com Copilot CLI session data](https://docs.github.com/en/copilot/concepts/agents/copilot-cli/chronicle) and [ccusage.com/guide/copilot](https://ccusage.com/guide/copilot/):
- `~/.copilot/session-state/<session-id>/events.jsonl` — per-session event log (a.k.a. "Chronicle"); on session shutdown, an event contains `data.modelMetrics.<model>.usage.{inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, reasoningTokens}` and `data.modelMetrics.<model>.requests.count`. `ccusage` derives true uncached-input as `max(inputTokens - cacheReadTokens - cacheWriteTokens, 0)` since Copilot CLI's raw `inputTokens` figure double-counts cache tokens; reasoning tokens are already folded into `outputTokens` (don't double-add).
- Optional richer telemetry: set `COPILOT_OTEL_ENABLED=true`, `COPILOT_OTEL_EXPORTER_TYPE=file`, `COPILOT_OTEL_FILE_EXPORTER_PATH=$HOME/.copilot/otel/copilot-otel-$(date +%Y%m%d-%H%M%S).jsonl` → writes OTel chat/inference/agent-turn spans with token-count attributes and model id to `~/.copilot/otel/**/*.jsonl`. This is the most structured/reliable local source for Copilot CLI, when explicitly enabled (off by default).
- Model-name suffixes `-1m`/`-1m-internal` need stripping before a pricing-table lookup (both are the same base model at a larger context-window SKU).

### Amp (Sourcegraph)

Confirmed only via `tokscale`'s README (**UNVERIFIED against Amp's own docs** — no official Amp documentation was fetched in this pass): local thread transcripts at `~/.local/share/amp/threads/`, from which `tokscale` extracts token counts. No further field-level detail obtained.

### Factory Droid

Confirmed only via `tokscale`'s README (**UNVERIFIED against Factory's own docs**): session-level usage metrics at `~/.factory/sessions/`. No further field-level detail obtained in this pass.

### Windsurf / Cascade

**Notable 2026 finding:** Windsurf's own docs domain (`docs.windsurf.com`) now issues a `307` redirect to `docs.devin.ai/desktop/...` — i.e. Windsurf/Cascade documentation now lives under Cognition's "Devin" docs umbrella (Cognition acquired Windsurf in 2025; by Sept 2026 the docs are fully merged). Any clai integration should point at `docs.devin.ai` going forward, not `docs.windsurf.com`, though the old host still redirects rather than 404ing.

**Enterprise Analytics API** (service-key auth, "Teams Read-only" permission), confirmed via the redirected docs page:
- `POST https://server.codeium.com/api/v1/CascadeAnalytics` — body: `service_key` (required), `query_requests[]` (required — one or more of `cascade_lines`, `cascade_runs`, `cascade_tool_usage`), optional `group_name`, `start_timestamp`/`end_timestamp` (RFC 3339), `emails[]`, `ide_types[]` (`editor`\|`jetbrains`\|`cli`). Response: `queryResults[]`, each with `cascadeLines`, `cascadeRuns` (model usage + credit consumption — `promptsUsed` is in **cents where 100 = 1 credit**, plus `mode`: Write/Read/Legacy), `cascadeToolUsage` (per-tool stats across ~15 tool identifiers like `CODE_ACTION`, `VIEW_FILE`).
- `POST https://server.codeium.com/api/v1/UserPageAnalytics` — body: `service_key`, `group_name`, `start_timestamp`, `end_timestamp`. Response: `userTableStats[]` with `name`, `email`, `lastUpdateTime`, `apiKey`, `activeDays`, `disableCodeium`, `lastAutocompleteUsageTime`, `lastChatUsageTime`, `lastCommandUsageTime`, `teamStatus`; plus top-level `error`. This is an **adoption/seat-activity** endpoint (last-used timestamps), not a token/cost feed — pair it with `CascadeAnalytics`' `cascade_runs` query for actual credit consumption.
- Both require an Enterprise/Teams plan service key — not available to individual users. No local-file-based usage source was independently confirmed for Windsurf in this pass (unlike Cline/Roo/OpenCode) — **UNVERIFIED whether a local per-session token log exists on disk for Cascade.**

### Kiro (AWS)

Confirmed via [kiro.dev/docs/enterprise/monitor-and-track](https://kiro.dev/docs/enterprise/monitor-and-track/) and the third-party `kiro-usage` PyPI tool:
- **Local:** Kiro CLI/IDE keeps a local SQLite database under `~/.kiro/` (exact filename/table/column schema **UNVERIFIED** — not published, and the `kiro-usage` package page doesn't expose its internals either). The community `kiro-usage` tool polls that SQLite file's mtime every 10s and snapshots parsed sessions to `~/.kiro_sessions/*.json` via a background launchd/systemd service, with fields `CacheWrite` (new tokens sent), `CacheRead` (prior context resent), `Output` (tokens from response, accurate — sourced from streaming chunks), `Cost` (cache-aware estimate); **input tokens are only approximated from character count**, a real accuracy limitation worth flagging to clai users.
- **Enterprise (official, server-side):** Kiro Enterprise has a genuine admin monitoring surface — a usage dashboard, per-user activity view, and optional S3-delivered prompt/conversation logging, all documented under `kiro.dev/docs/enterprise/monitor-and-track/`. This is the more reliable path for org-level Kiro deployments; exact API/export schema was not fetched in this pass (dashboard-oriented docs, not obviously a REST API) — **flag for deeper follow-up if Kiro becomes a priority connector.**

### Augment Code

Confirmed only thinly: `~/.augment/session.json` holds the CLI's auth (access token + tenant URL, retrievable via `auggie token print`) — this is a **credential file, not a usage log**. No local token/cost log path or usage API was confirmed in this pass; **UNVERIFIED / likely no accessible local usage data** for Augment beyond whatever their own dashboard shows. Lowest-confidence tool in this section.

---

## 9. LLM gateways as data sources (import-connector planning)

These are self-hosted or SaaS proxies that sit in front of multiple LLM providers; each already normalizes cost/usage across providers, making them attractive **single-integration, multi-provider** import sources for clai — one connector potentially covers dozens of the individual-provider connectors above for any team that has already adopted a gateway.

### LiteLLM Proxy

Confirmed via [docs.litellm.ai/docs/proxy/cost_tracking](https://docs.litellm.ai/docs/proxy/cost_tracking) (self-hosted or LiteLLM-managed; Bearer-token auth against the proxy's own virtual keys, not the underlying provider keys):

| Endpoint | Method | Params | Key response fields |
|---|---|---|---|
| `/spend/logs` | GET | `start_date`, `end_date`, `summarize` (true=aggregated/default, false=raw), `request_id` | `request_id`, `call_type`, `metadata.{user_api_key, user_api_key_team_id, user_api_key_user_id, spend_logs_metadata}` (per-transaction when `summarize=false`) |
| `/global/spend/report` | GET | `start_date`, `end_date` (required), `group_by` (`team`\|`customer`\|omit-for-key-view), `api_key`, `internal_user_id` | `group_by_day`, `teams[].{team_name, total_spend, metadata[].{model, spend, total_tokens, api_key}}` |
| `/spend/tags` | GET | (Enterprise feature) | spend broken out by `request_tags` set at call time — see [Request Tags docs](https://docs.litellm.ai/docs/proxy/request_tags) |
| `/spend/keys`, `/spend/users` | GET | — | spend lists scoped to keys/users; non-admins see only their own |
| `/user/info` | GET | `user_id` (required) | `user_id`, `user_info.spend`, `keys[]`, `teams[]` |
| `/user/daily/activity` | GET | `start_date`, `end_date` (required) | `results[].{date, metrics.{spend, prompt_tokens, completion_tokens, total_tokens, api_requests}, breakdown.{models, providers, api_keys}}`, `metadata.{total_spend, total_prompt_tokens, total_completion_tokens, total_api_requests}` — **this is the best single endpoint for a clai daily-rollup poller** since it's pre-broken-out by model/provider/key already. |
| `/global/spend/reset` | POST | — | master-key-only, destructive — never call from a read-only connector |

Interactive Swagger/OpenAPI docs are self-served at the proxy's own root URL (`http://<proxy-host>:4000/`), useful for confirming the exact schema a given self-hosted deployment/version exposes (LiteLLM proxy is under active development and endpoint shapes have shifted across versions).

### Helicone

Confirmed via [docs.helicone.ai/rest/request/post-v1requestquery](https://docs.helicone.ai/rest/request/post-v1requestquery), Bearer-token auth:

`POST /v1/request/query` — request body: `filter` (required; a composable `RequestFilterNode` tree supporting `and`/`or`, with leaf filters on `request.model`, `request.user_id`, `request.created_at`, `request_response_rmt.cost` [numeric: `gte`/`lte`/`gt`/`lt`/`equals`], `request_response_rmt.latency`, `request_response_rmt.status`, response/feedback/custom-properties), plus optional `offset`, `limit`, `sort` (`created_at`\|`latency`\|`cost`\|`total_tokens`\|`user_id`\|`model`\|`is_cached` × `asc`\|`desc`), `isCached`, `includeInputs`, `isPartOfExperiment`, `isScored`.

Response — array of `HeliconeRequest`: `request_id`, `request_created_at`, `request_body`, `request_model`, `response_id`, `response_created_at`, `response_body`, `response_status`, `cost`, `costUSD`, `total_tokens`, `prompt_tokens`, `completion_tokens`, `delay_ms`, `time_to_first_token`, `latency`, `feedback_rating`, `feedback_id`, `scores`, `properties`, `assets`, `asset_urls`, `provider`, `country_code`, `cache_enabled`. The `filter`-on-`cost`/`sort`-by-`cost` support makes this endpoint directly queryable for "show me all requests over $X" without a full-table pull — good for anomaly-style connectors, not just bulk export.

### Portkey

Confirmed only partially — [portkey.ai/docs](https://portkey.ai/docs/llms.txt) references an analytics API keyed by `{metadataKey}` (Portkey's metadata-tag system is its primary cost-attribution mechanism — [track-costs-using-metadata guide](https://portkey.ai/docs/guides/use-cases/track-costs-using-metadata)), with `page_size` pagination, requiring an API key scoped for analytics access. **Exact endpoint path(s) and full response schema UNVERIFIED in this pass** — the docs site's llms.txt index didn't resolve to a fetchable endpoint-reference page under the query budget for this task; treat Portkey as "known to have a cost/analytics API, schema needs a follow-up fetch before building a connector." Billing note: Portkey charges for its own gateway usage (logged-request volume) **separately** from the underlying provider bills it passes through — a clai Portkey connector must not conflate "Portkey's own invoice" with "the LLM spend Portkey is reporting on."

### Cloudflare AI Gateway

Confirmed via [developers.cloudflare.com/ai-gateway/observability/logging](https://developers.cloudflare.com/ai-gateway/observability/logging/) and [.../analytics](https://developers.cloudflare.com/ai-gateway/observability/analytics/):
- **Logs REST API:** `GET /accounts/{account_id}/ai-gateway/gateways/{gateway_id}/logs` (list) and `GET /accounts/{account_id}/ai-gateway/gateways/{gateway_id}/logs/{id}` (single record), standard Cloudflare API-token auth. Log fields (named in prose, not a fetched JSON example): prompt, response, provider, timestamp, request status, token usage, cost, duration, user agent/client id; DLP-related fields (`DLP Action`, `DLP Policies/Profiles/Entries Matched`, `DLP Check`) when DLP policies are active. Per-request headers `cf-aig-collect-log` / `cf-aig-collect-log-payload` control whether a call is logged at all and whether full payloads (vs. just metadata) are retained — relevant for clai because a source gateway configured with logging disabled or payload-only-off will still yield token/cost metadata even without prompt/response bodies.
- **Analytics:** exposed via **Cloudflare's account-wide GraphQL Analytics API** (`https://api.cloudflare.com` GraphQL endpoint, standard Cloudflare API token auth, account tag in the query) rather than a bespoke REST analytics endpoint — same mechanism Cloudflare uses for Workers/CDN analytics, just a different dataset for AI Gateway. Exact GraphQL dataset/field names **UNVERIFIED** in this pass (would need a follow-up fetch of `developers.cloudflare.com/analytics/graphql-api/` and the AI-Gateway-specific dataset schema).

### Kong AI Gateway

Confirmed via [developer.konghq.com/ai-gateway/monitor-ai-llm-metrics](https://developer.konghq.com/ai-gateway/monitor-ai-llm-metrics/) — Prometheus-native, not a query API (enable via the Prometheus plugin, `config.ai_metrics=true`, then scrape each Kong node's `/metrics` endpoint):

| Metric | Type | Labels |
|---|---|---|
| `ai_llm_requests_total` | Counter | `ai_provider`, `ai_model`, `cache_status`, `vector_db`, `embeddings_provider`, `embeddings_model`, `request_mode`, `workspace`, `consumer` |
| `ai_llm_cost_total` | Counter | same labels; **requires** `model.options.input_cost`/`output_cost` configured on the Kong route, otherwise stays at zero — cost is not automatically known, an operator must supply provider price tables |
| `ai_llm_tokens_total` | Counter | same labels plus `token_type` (`prompt_tokens`\|`completion_tokens`\|`total_tokens`); notably lacks `request_mode` |
| `ai_llm_provider_latency_ms` | Histogram | per-provider latency |
| `ai_cache_fetch_latency`, `ai_cache_embeddings_latency` | Histogram | cache-path latency |
| `kong_ai_mcp_*` | Counter/Histogram | MCP-tool-call traffic (separate from LLM traffic) |

**Implication for clai:** Kong is a pull-based Prometheus scrape target, not a push/query REST API like the other four gateways — an importer needs to either scrape `/metrics` on a schedule and diff cumulative counters itself, or sit behind whatever the customer already federates into (Prometheus remote-write, Grafana Mimir/Cortex, etc.) rather than calling a Kong-hosted endpoint directly. Also uniquely dependent on the operator having configured per-model cost — unlike LiteLLM/Helicone/Portkey/Cloudflare, Kong will not know a dollar cost unless someone manually price-tables it.

---

## Connector implications

"Billed" = provider/gateway returns an authoritative dollar figure directly. "Computed" = clai must multiply returned token counts by a price table it maintains itself (drift risk on every model-pricing change). Polling strategy assumes a scheduled backend job unless noted as "inline" (capture-at-call-time, no polling possible) or "file-watch" (local filesystem, not a network poll).

| Source | Reliability tier | Identity fields | Cost availability | Polling strategy | Priority | Justification |
|---|---|---|---|---|---|---|
| Cursor Admin API (`/teams/filtered-usage-events`, `/teams/spend`) | Official, documented | `userEmail`/`userId` per event | **Billed** (`totalCents`, `spendCents`, `chargedCents`) | Poll hourly (data aggregates hourly per docs) | **P0** | Richest per-user, per-request $ ledger of any source in this doc — direct hit for clai's core use case |
| GitHub Copilot usage-metrics + billing (org/enterprise) | Official, but **API changed 2026-04**; must target new report endpoints | `user_login`/`user_id` per NDJSON record | **Billed** (`ai_credits_used` per user as of 2026) | Daily pull of 1-day NDJSON reports via signed download links | **P0** | Now exposes per-user credit cost directly, org-wide, official — but only if built against the current (not legacy) API |
| OpenRouter — inline usage accounting | Official, zero-config | Whatever the caller tags (no forced identity) | **Billed** (`usage.cost` on every response) | Inline (capture at call time, always present) | **P0** | Cheapest possible integration: no separate call, no auth beyond the key already in use |
| OpenRouter — `/activity` (management key) | Official | `api_key_hash`, org `user_id` | **Billed** (`usage` = USD) | Daily pull, 30-day rolling window | **P0** | Best team/org rollup by model; provisioning-key model maps cleanly onto "one key per tracked user" |
| LiteLLM proxy | Official (OSS project docs) | `user_api_key_user_id`, `team_id`, `internal_user_id` | **Billed** (proxy's own stored spend ledger) | Daily pull of `/user/daily/activity` | **P0** | One integration covers every provider a team already routes through LiteLLM — highest leverage-per-connector in this doc |
| Helicone | Official SaaS API | `request.user_id` | **Billed** (`cost`/`costUSD`) | Paged pull of `/v1/request/query`, filter by `created_at` | **P0** | Same multi-provider leverage as LiteLLM, plus a queryable cost filter for efficient incremental sync |
| Vertex AI (Gemini on GCP) | Official (Monitoring + Billing export) | GCP project/billing account; no per-caller identity in Monitoring | **Billed** via Cloud Billing BigQuery export; Monitoring metrics = volume only | Daily pull from BigQuery export (12–24h billing lag); Monitoring API for near-real-time volume | **P1** | Strong signal for GCP-heavy teams, but requires BigQuery export setup — real onboarding cost |
| AWS Bedrock (Cost Explorer + CloudWatch + invocation logs) | Official (three separate native AWS mechanisms) | `identity.arn` (invocation logs only); CE/CloudWatch are account/tag-level | **Billed** via Cost Explorer (~1–2 day lag); CloudWatch/logs = computed | CE ~daily; CloudWatch near-real-time; invocation logs stream via S3/CW Logs | **P1** | Powerful and fully official, but per-caller attribution needs opt-in invocation logging plus multi-service IAM setup |
| Gemini Developer API (direct/AI Studio keys) | Official docs, but **no usage/cost endpoint exists** | API key only | **Computed** (per-call `usageMetadata` × published price) | Inline only — nothing to poll | **P1** | High-value model family, but clai must run as an inline proxy/wrapper, not a poller — different engineering shape than most sources |
| Gemini CLI (local) | Official (OTel documented), opt-in/off by default | Local machine/user, `auth_type` | **Computed** (token fields present, no $ field) | File-tail local OTel exporter or scrape an OTLP collector | **P1** | Good individual/prosumer coverage once telemetry is enabled; requires user opt-in, not zero-config |
| DeepSeek | Official (balance endpoint only) | API key | **Billed balance** (not a per-call usage log) | Poll `GET /user/balance` | **P1** | Cheap, reliable win — balance is pollable even though no usage-history endpoint exists |
| Windsurf/Cascade Enterprise Analytics | Official, Enterprise-gated | `email` (via `emails[]` filter / `userTableStats[].email`) | **Computed** (`promptsUsed` in cents-per-credit, needs credit price) | Daily pull with `start_timestamp`/`end_timestamp` window | **P1** | Solid official surface, but Enterprise-only license gates the addressable install base |
| Portkey | Official, **schema unverified this pass** | Metadata-key based (org-defined) | Presumed billed, fields unconfirmed | TBD — needs follow-up fetch of endpoint reference | **P1** | Same multi-provider leverage thesis as LiteLLM/Helicone; don't block P0 work on it, but schedule a follow-up research pass before implementation |
| Cloudflare AI Gateway | Official | Not clearly confirmed at per-user granularity this pass | **Billed** (`cost` field present in logs) | Logs REST API pull, or GraphQL Analytics API pull | **P1** | Solid official gateway, common in Cloudflare-centric stacks; GraphQL dataset schema needs a follow-up fetch |
| Local agent logs — OpenCode / Cline / Roo Code / Aider / Copilot CLI / Amp / Kiro | Community reverse-engineered file formats, **no official API for any of them** | Local machine/session only; no org identity without cross-referencing git config | **Computed** (token fields present; stored `cost` fields are sometimes wrong — e.g. confirmed OpenCode cache-cost bug — recompute, don't trust) | Filesystem watch on known paths, not a network poll | **P1** (collectively) | Huge population of individual developers with zero other telemetry surface — but each is its own brittle, unversioned parser requiring ongoing maintenance; ship as a plugin family, not core |
| Cursor unofficial personal-usage endpoint | **Unofficial** — reference implementation repo is archived | Session-cookie-derived `userId` | **Billed** (mirrors the real dashboard figure) | Poll `/api/usage?user=` with extracted `WorkosCursorSessionToken` | **P2** | Valuable for the large non-admin individual-user population, but fragile and undocumented — the very tool that popularized this approach is now archived; needs graceful-degradation, never a reliability dependency |
| Google Workspace — Gemini in Workspace apps | Official (Admin Reports API) | Actor email | **None** — adoption/activity log only, no tokens or $ at all | Daily pull via `Activities.list()` | **P2** | Useful for seat-adoption dashboards, structurally incapable of answering a cost question |
| Microsoft 365 Copilot (Graph usage reports) | Official, but endpoint path migrating (`/copilot/reports/...`) | `userPrincipalName` | **None** — flat per-seat license; "cost" is just seat_count × price, computed outside the API | Daily/periodic pull | **P2** | Same shape as Google Workspace: adoption-only telemetry, zero consumption-cost signal |
| Copilot Studio metering | **No API at all** (confirmed by Microsoft engineer on Q&A forum) | — | Dashboard-only | Not integrable today | **P2** | Blocked on Microsoft shipping an API; revisit periodically |
| xAI | Official Management API is ACL/key-admin only | `team_id`, `api_key_id` | **Unconfirmed** — no $ usage field found in the Management API | Unclear — no confirmed usage/spend endpoint | **P2** | Console-only spend visibility as far as this research could confirm; needs a deeper follow-up before committing |
| Mistral / Cohere / Perplexity (direct APIs) | Official, but **no account-level usage/balance endpoint found for any of the three** | API key only | **Computed** (inline `usage` object per call only) | Inline only | **P2** | No polling surface exists at all — same inline-proxy engineering shape as raw Gemini, for three more providers |
| Kiro | Local = community/unverified DB schema; Enterprise = official dashboard, no confirmed API | Enterprise: per-user activity view (schema unconfirmed) | **Computed**, and only approximate (input tokens are character-count estimates in the community tool) | Enterprise: unclear if API-accessible; local: file-watch on an undocumented SQLite file | **P2** | Too much remains UNVERIFIED (no published local DB schema, no confirmed Enterprise API) to commit engineering time yet |
| Kong AI Gateway | Official, but Prometheus-scrape only, not a query API | `consumer` label | **Computed**, and only present if the operator manually configured `input_cost`/`output_cost` | Continuous `/metrics` scrape + counter diffing (architecturally different from every other source here) | **P2** | Real integration effort (needs a Prometheus-compatible ingestion path) for a payoff that depends entirely on customer configuration quality |
| Augment Code | Effectively unconfirmed — only a credential file was found | — | Unknown | Unknown | **P2** | No usage/cost surface identified at all in this research pass; revisit if user demand appears |
| Google AI Pro / Ultra, SuperGrok, Le Chat, Perplexity Pro/Max (consumer subscriptions) | N/A — flat-fee subscriptions, not consumption-billed | Account email (manual entry) | **None** (flat price × seat) | N/A — manual/flat entry | **P2** | Not an integration target; the "cost" is just the known subscription price, no API will ever expose more than that |

### Cross-cutting notes for implementation

- **The single biggest 2026 gotcha in this whole document:** GitHub Copilot's metrics API and billing model both changed in the same window (metrics API sunset 2026-04-02; PRU→AI-Credits billing switch 2026-06-01). Any existing integration code, blog post, or Stack Overflow answer describing the old `copilot_ide_code_completions` inline-JSON shape or the old premium-request-multiplier billing math is now stale. Build against the NDJSON report API and AI Credits model only.
- **Gateways (LiteLLM/Helicone/Portkey/Cloudflare/Kong) are the highest-leverage build targets** for a company-teams-focused product: a single connector per gateway can retroactively cover Mistral, Cohere, Perplexity, DeepSeek, xAI and any other provider that has no usage API of its own, as long as the customer already routes traffic through one of these five.
- **"Computed" cost sources are a standing maintenance liability**, not a one-time integration: every model-pricing change (new model, price cut, tiered-context change like Gemini's >200K jump) silently breaks any hardcoded price table. Sources marked **Billed** in the table above are structurally safer long-term bets than sources marked **Computed**.
- **Local file-based connectors (§8) need a fundamentally different architecture** from every API-based source: a filesystem watcher / periodic local scan, not a backend poller, and correspondingly different failure modes (corrupt JSON, moved files, OS-specific paths) that the API-based connectors don't have to handle.

---
