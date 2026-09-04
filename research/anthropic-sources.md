# Anthropic / Claude usage & cost data sources — engineering reference

Compiled 2026-09-03 for **clai** (AI usage & cost tracker) connector design. Every claim below is sourced; `UNVERIFIED` marks anything from a single community source, a WebFetch summary that could not be cross-checked, or reverse-engineered behavior with no official documentation. Prices, limits, and model availability are as published on 2026-09-03 and are known to change — re-verify the cited URL before shipping.

---

## 1. Admin API: Usage & Cost Reports (Claude Console / Platform orgs)

This is the primary programmatic source for *billed, authoritative* API usage and cost. It lives entirely under `https://api.anthropic.com/v1/organizations/*`, is **not** in any Anthropic SDK (curl/raw HTTP only), and requires an **Admin API credential** — a regular API key does not work.

**Source:** https://platform.claude.com/docs/en/manage-claude/usage-cost-api and https://platform.claude.com/docs/en/manage-claude/admin-api

### 1.1 Authentication (applies to every endpoint in §1)

| Credential | Header | Value | Notes |
|---|---|---|---|
| Admin API key | `x-api-key` | `sk-ant-admin01-...` | Created in Console → Settings → Admin keys. Exact prefix `sk-ant-admin01-...` quoted directly from docs. |
| OAuth token, `org:admin` scope | `Authorization` | `Bearer <token>` | Also works for every Admin API endpoint. |
| — | `anthropic-version` | `2023-06-01` | Required on every request. |

Also accepted: "a personal or service account key that isn't scoped to a workspace." **Workspace-scoped API keys are explicitly rejected.** The Admin API "is unavailable for individual accounts" — an organization must exist in Console → Settings → Organization.

**Source:** https://platform.claude.com/docs/en/manage-claude/usage-cost-api (Check/Note callouts)

**Which API for which org — this is the load-bearing fact for a connector:**

| Your org type | API to use | Key type |
|---|---|---|
| Claude Console (Claude Platform / pay-as-you-go API org) | Usage & Cost Admin API (this section) | Admin API key (`sk-ant-admin01-...`) |
| Claude Enterprise (claude.ai org) | **Claude Enterprise Analytics API** — a *different* API, different key type (§5.3) | Analytics API key (`read:analytics` scope) |

> Quoted directly: *"Claude Enterprise organizations use an Analytics API key with a different API instead; see Which API do you need?"* — and — *"Claude Enterprise parent organizations do not appear in Claude Console and carry no Admin API keys, so for them the Analytics API key is the only path to this data."*

**Source:** https://platform.claude.com/docs/en/manage-claude/usage-cost-api#which-api-do-you-need

**Claude Platform on AWS:** these endpoints are **not available**. Quoted: *"The programmatic Usage and Cost API endpoints are not currently available. View usage and cost data on the Usage and Cost pages in the Claude Console instead."* Same restriction applies to the Claude Code Analytics endpoint (§1.3).

**Source:** https://platform.claude.com/docs/en/manage-claude/usage-cost-api

### 1.2 `GET /v1/organizations/usage_report/messages`

Token consumption bucketed by time, with breakdowns by model/workspace/key/service tier/context window/geo/speed.

**Query parameters** (from the official quick-start and example requests):

| Param | Type | Notes |
|---|---|---|
| `starting_at` | RFC 3339 timestamp | Required |
| `ending_at` | RFC 3339 timestamp | Required |
| `bucket_width` | `1m` \| `1h` \| `1d` | See granularity table below |
| `group_by[]` | repeatable | `model`, `workspace_id`, `api_key_id`, `service_tier`, `context_window`, `inference_geo`, `speed` (beta) |
| `api_key_ids[]` | repeatable | Filter to specific keys |
| `workspace_ids[]` | repeatable | Filter to specific workspaces |
| `models[]` | repeatable | e.g. `claude-opus-5` |
| `service_tiers[]` | repeatable | e.g. `batch`, `priority` |
| `context_window[]` | repeatable | e.g. `0-200k` |
| `inference_geos[]` | repeatable | `global`, `us`, `not_available` — requires no beta header |
| `speeds[]` | repeatable | `standard`, `fast` — **requires** `anthropic-beta: fast-mode-2026-02-01` header (same header required if `group_by[]=speed`) |
| `limit` | integer | Page size — see granularity table for default/max |
| `page` | opaque cursor | From previous response's `next_page` |

**Source (every param above is from a literal curl example on the live page):** https://platform.claude.com/docs/en/manage-claude/usage-cost-api

Example request (quoted):
```bash
curl "https://api.anthropic.com/v1/organizations/usage_report/messages?\
starting_at=2025-01-01T00:00:00Z&\
ending_at=2025-01-08T00:00:00Z&\
group_by[]=model&\
bucket_width=1d" \
  -H "anthropic-version: 2023-06-01" \
  -H "x-api-key: $ANTHROPIC_ADMIN_KEY"
```

**Time granularity limits** (quoted table):

| Granularity | Default limit | Maximum limit |
|---|---|---|
| `1m` | 60 buckets | 1,440 buckets |
| `1h` | 24 buckets | 168 buckets |
| `1d` | 7 buckets | **31 buckets** |

This is the "31-bucket page limit" — at `1d` width you must paginate for any range beyond 31 days.

**Source:** https://platform.claude.com/docs/en/manage-claude/usage-cost-api#time-granularity-limits

**Response shape.** The public guide shows only curl requests, not a full JSON response body, for this specific endpoint. The shape below is reconstructed from (a) the field names the guide's prose explicitly names ("Token tracking: Measure uncached input, cached input, cache creation, and output tokens... Server tool usage: Track usage of server-side tools such as web search") and (b) a byte-for-byte structurally identical sibling endpoint, `GET /v1/organizations/analytics/usage_report` (Enterprise Analytics API, §5.3), for which a full example response **was** returned. Treat the exact response below as high-confidence but not a verbatim quote from the Console-org docs page:

```json
{
  "data": [
    {
      "starting_at": "2025-01-01T00:00:00Z",
      "ending_at": "2025-01-02T00:00:00Z",
      "results": [
        {
          "uncached_input_tokens": 0,
          "cache_creation": {
            "ephemeral_5m_input_tokens": 500,
            "ephemeral_1h_input_tokens": 1000
          },
          "cache_read_input_tokens": 0,
          "output_tokens": 0,
          "model": "claude-opus-5",
          "service_tier": "standard",
          "context_window": "0-200k",
          "inference_geo": "global",
          "api_key_id": "apikey_01Rj2N8SVvo6BePZj99NhmiT",
          "workspace_id": "wrkspc_01JwQvzr7rXLA5AGx3HKfFUJ",
          "server_tool_use": { "web_search_requests": 10 }
        }
      ]
    }
  ],
  "has_more": true,
  "next_page": "page_xyz..."
}
```
**Source of exact field names (`uncached_input_tokens`, `cache_creation.ephemeral_5m_input_tokens`/`ephemeral_1h_input_tokens`, `cache_read_input_tokens`, `output_tokens`, `server_tool_use.web_search_requests`):** cross-confirmed via the sibling Enterprise endpoint, https://platform.claude.com/docs/en/api/admin/analytics (WebFetch summary — `UNVERIFIED` as a byte-exact match to the Console-org endpoint, but the dimension names and pricing docs elsewhere on platform.claude.com use identical vocabulary).

**Playground/default-workspace edge cases** (quoted FAQs):
- *"API usage from playground in the Claude Console (and from the legacy Workbench before it) is not associated with an API key, so `api_key_id` will be `null` even when grouping by that dimension."*
- *"Usage and costs attributed to the default workspace have a `null` value for `workspace_id`."*

**Source:** https://platform.claude.com/docs/en/manage-claude/usage-cost-api#frequently-asked-questions

**Data residency dimension:** `inference_geo` group-by/filter added for Claude 4.6+ models; older models return `"not_available"`.
**Fast mode dimension:** `speed` group-by/filter, values `standard`/`fast`, needs the `fast-mode-2026-02-01` beta header.

**Source:** https://platform.claude.com/docs/en/manage-claude/usage-cost-api

### 1.3 `GET /v1/organizations/cost_report`

Service-level USD cost.

| Param | Notes |
|---|---|
| `starting_at` / `ending_at` | RFC 3339 |
| `bucket_width` | **`1d` only** — no `1m`/`1h` |
| `group_by[]` | `workspace_id`, `description` — grouping by `description` also returns parsed `model` and `inference_geo` fields |
| `limit` / `page` | Same pagination as §1.2 |

Quoted: *"Currency: All costs in USD, reported as decimal strings in lowest units (cents)."* This directly answers "decimal string in cents?" from the brief — **yes, cents, as a decimal string** (e.g. `"41280.000000"` = $412.80 — this exact example is from the sibling Enterprise Analytics cost endpoint, §5.3, which shares the same convention).

Quoted warning: *"Priority Tier costs use a different billing model and are not included in the cost endpoint. Track Priority Tier usage through the usage endpoint instead."*

Quoted: *"Code execution costs appear in the cost endpoint grouped under `Code Execution Usage` in the description field. Code execution is not included in the usage endpoint."*

**Source:** https://platform.claude.com/docs/en/manage-claude/usage-cost-api#cost-api

Example request (quoted):
```bash
curl "https://api.anthropic.com/v1/organizations/cost_report?\
starting_at=2025-01-01T00:00:00Z&\
ending_at=2025-01-31T00:00:00Z&\
group_by[]=workspace_id&\
group_by[]=description" \
  -H "anthropic-version: 2023-06-01" \
  -H "x-api-key: $ANTHROPIC_ADMIN_KEY"
```

Response shape (reconstructed with the same confidence caveat as §1.2, cross-confirmed field names from the sibling Enterprise cost endpoint): `data[].{starting_at,ending_at,results[]}` where each result has `amount` (decimal string, cents), `currency` (`"USD"`), `cost_type` (`tokens` / `web_search` / `code_execution`), `model`, `context_window`, `service_tier`, `token_type` (`uncached_input_tokens` / `cache_read_input_tokens` / `cache_creation.ephemeral_5m_input_tokens` / `cache_creation.ephemeral_1h_input_tokens` / `output_tokens`), `workspace_id`, `description`. Top-level `has_more` / `next_page`.

### 1.4 `GET /v1/organizations/usage_report/claude_code` — Claude Code Analytics API

Daily, **per-user** aggregated Claude Code productivity + cost metrics. This is the endpoint that answers "how do I get per-user Claude Code cost breakdowns" — the general usage/cost endpoint above is explicitly *not* recommended for that (quoted FAQ: *"Use the Claude Code Analytics API, which provides per-user estimated costs and productivity metrics without the performance limitations of breaking down costs by many API keys."*).

**Source:** https://platform.claude.com/docs/en/manage-claude/claude-code-analytics-api and https://platform.claude.com/docs/en/manage-claude/analytics-api

| Param | Type | Required | Notes |
|---|---|---|---|
| `starting_at` | `YYYY-MM-DD` | Yes | UTC date; returns **that single day only** (not a range) |
| `limit` | integer | No | Default 20, max 1000 |
| `page` | opaque cursor | No | From `next_page` |

Full quoted example response:
```json
{
  "data": [
    {
      "date": "2025-09-08T00:00:00Z",
      "actor": {
        "type": "user_actor",
        "email_address": "developer@company.com"
      },
      "organization_id": "dc9f6c26-b22c-4831-8d01-0446bada88f1",
      "customer_type": "api",
      "terminal_type": "vscode",
      "core_metrics": {
        "num_sessions": 5,
        "lines_of_code": { "added": 1543, "removed": 892 },
        "commits_by_claude_code": 12,
        "pull_requests_by_claude_code": 2
      },
      "tool_actions": {
        "edit_tool": { "accepted": 45, "rejected": 5 },
        "multi_edit_tool": { "accepted": 12, "rejected": 2 },
        "write_tool": { "accepted": 8, "rejected": 1 },
        "notebook_edit_tool": { "accepted": 3, "rejected": 0 }
      },
      "model_breakdown": [
        {
          "model": "claude-opus-5",
          "tokens": { "input": 100000, "output": 35000, "cache_read": 10000, "cache_creation": 5000 },
          "estimated_cost": { "currency": "USD", "amount": 141 }
        }
      ]
    }
  ],
  "has_more": false,
  "next_page": null
}
```
`actor` is a tagged union: `user_actor` (`email_address`) for OAuth-authenticated users, or `api_actor` (`api_key_name`) for API-key usage. `customer_type` is `api` (pay-as-you-go) or `subscription` (Pro/Team). `estimated_cost.amount` is **cents**, matching §1.3's convention (the example: 100000 input + 35000 output + 10000 cache_read + 5000 cache_creation tokens on Opus 5 = $1.41 → `"amount": 141`).

**Source (verbatim):** https://platform.claude.com/docs/en/manage-claude/claude-code-analytics-api

Freshness: *"Claude Code analytics data typically appears within 1 hour of user activity completion. To ensure consistent pagination results, only data older than 1 hour is included in responses."* No real-time option on this endpoint — for that, use OpenTelemetry (§3). Coverage: **first-party Claude API usage of Claude Code only** — explicitly excludes Bedrock, Microsoft Foundry, Google Cloud, and Claude Platform on AWS deployments of Claude Code. Free to use. Historical data has no stated deletion period.

**Source:** https://platform.claude.com/docs/en/manage-claude/claude-code-analytics-api#frequently-asked-questions

### 1.5 ID-to-name mapping endpoints

| Resource | Endpoint | Notes |
|---|---|---|
| API keys | `GET /v1/organizations/api_keys` | `limit` (default 20, max 1000), `after_id`/`before_id`, filters `status`/`workspace_id`/`created_by_user_id`. Response: `data[]` with `id`, `name`, `status`, `created_at`, `expires_at`, `partial_key_hint`, `scope`, `principal`; `first_id`/`last_id`/`has_more`. |
| Workspaces | `GET /v1/organizations/workspaces` | Same pagination shape; `include_archived` boolean filter. |
| Users | `GET /v1/organizations/users` | Filters `email`, `roles[]`. |

**Source:** https://platform.claude.com/docs/en/manage-claude/usage-cost-api (tips linking to these) and https://platform.claude.com/docs/en/api/admin (WebFetch summary of the reference page — the auth section of this particular fetch emphasized OAuth Bearer and gave the key prefix as `sk-ant-admin-`, which conflicts with the `sk-ant-admin01-...` prefix directly quoted on the usage-cost-api guide page; **treat `sk-ant-admin01-...` as authoritative** since it is a verbatim quote from a canonical page, and mark the admin.md summary's field/endpoint *shapes* as `UNVERIFIED` detail-level, though the endpoint paths themselves match what other pages link to).

### 1.6 Beta-only Admin API surface useful for a connector

As of 2026-08-26 the broader Admin API (members, invites, workspaces, workspace members, API keys, org/workspace rate limits, service accounts, WIF, CMEK) is also available through `client.beta.organization` in all seven official SDKs and `ant beta:organization` in the CLI — but **usage reports, cost reports, and the Claude Code/Enterprise Analytics endpoints remain curl-only**, not wrapped by any SDK.

**Source:** Anthropic `claude-api` Claude Code skill, cached shared/admin-api.md (bundled skill reference, dated within 2026; not independently re-fetched from a live URL in this session — treat endpoint list as reliable, treat "2026-08-26" date as `UNVERIFIED` against a live page).

---

## 2. Claude Code local transcripts & local state files

No official Anthropic document specifies the JSONL *line schema*; the directory/file **inventory** below is from the official `.claude` directory reference. Line-level field names are cross-confirmed from OpenTelemetry docs (which reference specific JSONL fields) and community reverse-engineering (ccusage, blog posts) — marked accordingly.

### 2.1 Directory structure (official)

**Source:** https://code.claude.com/docs/en/claude-directory — this is the authoritative, current (2026) description of `~/.claude`. On Windows `~/.claude` resolves to `%USERPROFILE%\.claude`; if `CLAUDE_CONFIG_DIR` is set, every path below lives under that directory instead.

| Path | Contents | Retention |
|---|---|---|
| `projects/<project>/<session>.jsonl` | Full conversation transcript: every message, tool call, tool result | Swept after `cleanupPeriodDays` (default 30, min 1) |
| `projects/<project>/<session>.orphaned-<timestamp>-<suffix>.jsonl`, `...jsonl.superseded-<timestamp>` | A prior transcript for the session Claude Code set aside rather than overwrite; not shown in the session picker | Same sweep |
| `projects/<project>/<session>/subagents/` | Subagent conversation transcripts | Removed with parent transcript |
| `projects/<project>/<session>/tool-results/` | Large tool outputs spilled to separate files | Same sweep |
| `projects/<project>/memory/` | Auto-memory (Claude's own cross-session notes) | Excluded from the age sweep; directory removed only once empty for a full retention period |
| `history.jsonl` | Every prompt typed, with timestamp and project path (up-arrow recall) | **Kept until you delete it** — not part of the automatic sweep |
| `stats-cache.json` | Aggregated token and cost counts shown by `/usage` | **Kept until you delete it** |
| `~/.claude.json` | App state, OAuth, UI toggles, personal MCP servers | Global-only; rotated backups kept in `backups/` (5 newest) |
| `remote-settings.json` | Cached managed/server-managed settings | Deleted on logout |
| `policy-limits.json` | Cached feature-policy settings | Deleted on logout |
| `usage-data/` | `report.html` + timestamped copies from `/insights`, plus cached per-session analysis | Swept per `cleanupPeriodDays` |
| `file-history/<session>/`, `plans/`, `debug/`, `paste-cache/`, `image-cache/<session>/`, `uploads/<session>/`, `session-env/`, `tasks/`, `shell-snapshots/`, `feedback-bundles/`, `feedback/drafts/` | Various session-scoped working data | Swept per `cleanupPeriodDays` (some have their own sub-rules) |
| `todos/`, `statsig/`, `logs/` | Legacy, no longer written | Swept then removed |

Quoted: *"Transcripts and history are not encrypted at rest. OS file permissions are the only protection. If a tool reads a `.env` file or a command prints a credential, that value is written to `projects/<project>/<session>.jsonl`."*

**Source:** https://code.claude.com/docs/en/claude-directory (fetched directly; large page, ~1650 lines, saved and grepped locally during research)

The task brief mentions a flat `agent-<id>.jsonl` naming convention for subagent transcripts. **Current official docs (2026) describe subagent transcripts as living inside a `projects/<project>/<session>/subagents/` subdirectory, not as flat `agent-<id>.jsonl` files in the project root.** Community tooling (ccusage, older blog posts) documents the flat-file convention, which likely reflects an earlier Claude Code version. A connector should probe both layouts (`glob('**/agent-*.jsonl')` and `glob('**/subagents/*.jsonl')`) for robustness across versions. `UNVERIFIED` which Claude Code version(s) used which layout, and whether `subagents/` directory contents are still one-file-per-subagent JSONL with the same line schema as the parent transcript.

### 2.2 Session JSONL line schema (cross-confirmed, not from one single doc)

No single Anthropic page documents the full line schema. The following fields are corroborated across the OpenTelemetry monitoring doc (§3) — which explicitly cross-references transcript fields for event-correlation purposes — and are consistent with what community tools parse:

- `message.uuid` — quoted directly from OpenTelemetry docs: *"UUID of persisted message in session transcript (`~/.claude/projects/*/*.jsonl`)"*. Used to correlate an OTel event to a transcript line.
- `request_id` / `client_request_id` — the Anthropic API `request-id` and a Claude-Code-generated `x-client-request-id`, both present on `api_request`/`api_error` OTel events and (per the task brief and community tooling) on the corresponding transcript line's `message` object.
- `type`, `uuid`, `parentUuid`, `sessionId`, `cwd`, `gitBranch`, `version`, `timestamp`, `isSidechain` — named in the task brief; **`UNVERIFIED`** against an official page (no Anthropic doc enumerates the line-level JSON schema), but consistent with what every community parser (ccusage, claude-viewer, others found in this research) reports, and `isSidechain` specifically is used to distinguish subagent/side-conversation lines from the main thread.
- `message.usage.{input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens}` — token fields. The nested cache breakdown `cache_creation.{ephemeral_5m_input_tokens, ephemeral_1h_input_tokens}` mirrors the same structure independently confirmed in the Admin/Enterprise Analytics usage-report responses (§1.2, §5.3), so it is very likely the transcript stores the *raw Messages API response* `usage` object verbatim per assistant turn, which would explain why every one of these field names matches the official API `usage` object (§7.1) byte-for-byte.
- The `"<synthetic>"` model string: community tools (ccusage) special-case a `<synthetic>` model value that appears on lines Claude Code writes for its own internal/non-billed operations (e.g. summarization scaffolding); treat rows with this model as **zero-cost / excluded from spend totals**. `UNVERIFIED` against an official doc — this is purely from community tool source/discussion.

**Dedup requirement:** because a single logical API response can be written across multiple JSONL lines (once per content block, and again in `subagents/`-adjacent or resumed-session files), a correct token-usage rollup must dedup on a composite key. Community consensus (ccusage and related tools, per this research's searches) is to dedup on **`message.id` (the Anthropic API response id, distinct from the transcript line's own `uuid`) combined with `requestId`** — two lines with the same pair represent the same billed API call and must be counted once. `UNVERIFIED` as an exact algorithm (no official doc, and this session could not retrieve ccusage's literal dedup source code — see §2.3), but this shape is corroborated by multiple independent community sources found during research (a blog specifically reverse-engineering the JSONL format, and the ccusage project description itself).

**Source:** OpenTelemetry doc for `message.uuid`/correlation: https://code.claude.com/docs/en/monitoring-usage. Field-name cross-confirmation: https://platform.claude.com/docs/en/manage-claude/usage-cost-api and https://platform.claude.com/docs/en/api/admin/analytics. `<synthetic>` and dedup shape: `UNVERIFIED`, ccusage project (https://github.com/ryoppippi/ccusage) and https://danyuchn.github.io/blog/posts/en/claude-code-jsonl-internals/ (WebFetch summary).

### 2.3 ccusage (community tool)

**Source:** https://github.com/ryoppippi/ccusage (README fetched via WebFetch summary; a direct fetch of `CLAUDE.md`/architecture notes failed — repo redirects that path, so implementation-level detail below is limited to what the README states)

- Purpose (quoted): *"analyze[s] coding (agent) CLI token usage and costs from local data"* — covers Claude Code and, per the repo name, Codex CLI as well.
- Data location: `CLAUDE_CONFIG_DIR` env var, falling back to `~/.config/claude` (note: this differs from the *official* default of `~/.claude` documented in §2.1 — `~/.config/claude` appears to be ccusage's own fallback path, possibly reflecting an XDG-style convention some installs use; a connector should check both `~/.claude` and `~/.config/claude`, and always honor `CLAUDE_CONFIG_DIR` first).
- Pricing source: LiteLLM's `model_prices_and_context_window.json`, with an offline mode that uses a pre-cached copy when there's no network.
- `<synthetic>` model: mentioned but not explained in the fetched excerpt (see §2.2).
- Reports: daily / weekly / monthly, per-session, and **5-hour "blocks"** — quoted: *"Track usage within Claude's billing windows with active block monitoring."* This 5-hour block matches the Pro/Max/Team/Enterprise subscription rolling session window (§4).
- Statusline: *"Compact usage display for Claude Code status bar hooks (Beta)."*
- Other features: JSON export, custom pricing overrides via `ccusage.json`, per-project/instance grouping, timezone-aware date grouping.
- MCP server mode / library usage: not covered in the fetched README excerpt; the repo does expose a `docs/guide/library-usage.md` per the GitHub file listing, suggesting ccusage is usable as a library from JS/TS — `UNVERIFIED` in this session (not fetched).

### 2.4 `stats-cache.json` and `/stats`

The file's *purpose* is officially documented (§2.1: "Aggregated token and cost counts shown by `/usage`"). The task brief's specific field list (`dailyActivity`, `dailyModelTokens`, `modelUsage[model].{inputTokens, outputTokens, cacheReadInputTokens, cacheCreationInputTokens, webSearchRequests, costUSD}`) is **`UNVERIFIED`** — no official page enumerates this JSON schema, and this session did not find a community source confirming those exact key names during the searches performed. Treat as a reasonable/likely shape (consistent with the `/usage` display and OTel field-naming conventions elsewhere) but verify empirically against a real file before hard-coding a parser. Note also that the current official docs name the command **`/usage`**, not `/stats` — `/stats` may be a deprecated/renamed alias; a connector's own testing should confirm which command name applies to the installed Claude Code version.

**Source:** https://code.claude.com/docs/en/claude-directory (file purpose only); schema fields `UNVERIFIED`.

### 2.5 `history.jsonl`

Officially documented purpose: *"Every prompt you've typed, with timestamp and project path. Used for up-arrow recall."* Field names (`display`, `timestamp`, `project`, `sessionId` per the task brief) are `UNVERIFIED` against an official schema doc, but plausible given the stated purpose. `claude project purge` filters this file by matching prompt lines to a project path, confirming it is at least keyed by project path and is line-per-prompt.

**Source:** https://code.claude.com/docs/en/claude-directory

### 2.6 `CLAUDE_CONFIG_DIR` and path fallback

Officially confirmed: *"On Windows, `~/.claude` resolves to `%USERPROFILE%\.claude`. If you set `CLAUDE_CONFIG_DIR`, every `~/.claude` path lives under that directory instead."* The task brief's `~/.config/claude` fallback is **not** documented as an official Claude Code fallback — it appears to be specific to how some *community tools* (e.g. ccusage, per §2.3) resolve their own default when `CLAUDE_CONFIG_DIR` is unset, not a fallback Claude Code itself uses. A connector should treat `~/.claude` (or `CLAUDE_CONFIG_DIR` if set) as the authoritative path and only fall back to `~/.config/claude` as a secondary probe for compatibility with older tool assumptions.

**Source:** https://code.claude.com/docs/en/claude-directory; https://code.claude.com/docs/en/env-vars (referenced but not independently fetched this session — `UNVERIFIED` for the full env-var list beyond `CLAUDE_CONFIG_DIR`).

---

## 3. Claude Code OpenTelemetry

This is the most completely and officially documented of all the sources in this report — it is the right foundation for a **team-wide, near-real-time collector**, since it is the only source with per-event granularity and sub-minute latency.

**Source:** https://code.claude.com/docs/en/monitoring-usage (fetched in full)

### 3.1 Environment variables

**Enable + exporter selection**

| Variable | Purpose | Default | Values |
|---|---|---|---|
| `CLAUDE_CODE_ENABLE_TELEMETRY` | Master switch | disabled | `1` |
| `OTEL_METRICS_EXPORTER` | Metrics exporter(s), comma-separated | none | `console`, `otlp`, `prometheus`, `none` |
| `OTEL_LOGS_EXPORTER` | Logs/events exporter(s) | none | `console`, `otlp`, `none` |
| `OTEL_TRACES_EXPORTER` | Traces (beta) | none | `console`, `otlp`, `none` |

**OTLP transport**

| Variable | Purpose |
|---|---|
| `OTEL_EXPORTER_OTLP_PROTOCOL` | `grpc` \| `http/json` \| `http/protobuf` (all signals) |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Collector endpoint, all signals |
| `OTEL_EXPORTER_OTLP_{METRICS,LOGS,TRACES}_PROTOCOL` / `_ENDPOINT` | Per-signal overrides |
| `OTEL_EXPORTER_OTLP_HEADERS` / `_METRICS_HEADERS` / `_LOGS_HEADERS` / `_TRACES_HEADERS` | Auth headers, e.g. `Authorization=Bearer token` |

**Export cadence & content**

| Variable | Default | Notes |
|---|---|---|
| `OTEL_METRIC_EXPORT_INTERVAL` | `60000` ms | |
| `OTEL_LOGS_EXPORT_INTERVAL` | `5000` ms | |
| `OTEL_TRACES_EXPORT_INTERVAL` | `5000` ms | |
| `OTEL_LOG_USER_PROMPTS` | disabled | `1` to log raw prompt text (otherwise redacted) |
| `OTEL_LOG_ASSISTANT_RESPONSES` | falls back to `OTEL_LOG_USER_PROMPTS` | `1`/`0` |
| `OTEL_LOG_TOOL_DETAILS` | disabled | Tool params/decisions detail |
| `OTEL_LOG_TOOL_CONTENT` | disabled | Full tool input/output in trace spans |
| `OTEL_LOG_RAW_API_BODIES` | disabled | `1` (inline, truncated) or `file:<dir>` (untruncated to disk) |
| `CLAUDE_CODE_OTEL_CONTENT_MAX_LENGTH` | `61440` (60 KB) | Truncation limit, UTF-16 code units |

**Cardinality control**

| Variable | Default |
|---|---|
| `OTEL_METRICS_INCLUDE_SESSION_ID` | `true` |
| `OTEL_METRICS_INCLUDE_VERSION` | `false` |
| `OTEL_METRICS_INCLUDE_ACCOUNT_UUID` | `true` |
| `OTEL_METRICS_INCLUDE_ENTRYPOINT` | `false` |
| `OTEL_METRICS_INCLUDE_RESOURCE_ATTRIBUTES` | `true` |

**Other:** `OTEL_RESOURCE_ATTRIBUTES` (comma-separated `key=value`, no spaces — e.g. `department=engineering,team.id=platform`), `OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE` (default `delta`), mTLS variables (`CLAUDE_CODE_CLIENT_CERT`/`_KEY`/`_KEY_PASSPHRASE` for http; `OTEL_EXPORTER_OTLP_CLIENT_CERTIFICATE`/`_KEY` for gRPC; `NODE_EXTRA_CA_CERTS`/`OTEL_EXPORTER_OTLP_CERTIFICATE` to trust a custom collector CA). **Important for architecture:** Claude Code does **not** propagate `OTEL_*` vars to subprocesses (Bash tool, hooks, MCP servers) — an instrumented app invoked via the Bash tool needs its own exporter config set directly in the command.

### 3.2 Metrics

| Metric | Unit | Key attributes |
|---|---|---|
| `claude_code.session.count` | count | `start_type`: `fresh`/`resume`/`continue`/`agents_view` |
| `claude_code.lines_of_code.count` | count | `type`: `added`/`removed`; `model` |
| `claude_code.pull_request.count` | count | — |
| `claude_code.commit.count` | count | — |
| `claude_code.cost.usage` | USD | `model`, `query_source` (`main`/`subagent`/`auxiliary`), `speed` (`fast` when active), `effort`, `agent.name`, `skill.name`, `plugin.name`, `marketplace.name`, `mcp_server.name`, `mcp_tool.name` |
| `claude_code.token.usage` | tokens | Same attribution set as above **plus** `type`: `input`/`output`/`cacheRead`/`cacheCreation` |
| `claude_code.code_edit_tool.decision` | count | `tool_name` (`Edit`/`Write`/`NotebookEdit`), `decision` (`accept`/`reject`), `source`, `language` |
| `claude_code.active_time.total` | seconds | `type`: `user` (keyboard) / `cli` (tool exec + AI responses) |

All metrics also carry the standard attributes in §3.4.

### 3.3 Events / logs (require `OTEL_LOGS_EXPORTER` configured)

Correlation IDs across events: `prompt.id` (per-user-turn UUID v4), `message.uuid` (matches the transcript JSONL line, §2.2), `client_request_id` (the `x-client-request-id` request header).

| Event | Key fields |
|---|---|
| `claude_code.user_prompt` | `prompt_length`, `prompt` (redacted unless `OTEL_LOG_USER_PROMPTS=1`), `message.uuid`, `command_name`, `command_source` |
| `claude_code.assistant_response` (v2.1.193+) | `response_length`, `response` (redacted unless `OTEL_LOG_ASSISTANT_RESPONSES=1`), `model`, `request_id`, `message.uuid`, `query_source` |
| `claude_code.tool_result` | `tool_name`, `tool_use_id`, `success`, `duration_ms`, `error_type`, `tool_input_size_bytes`, `tool_result_size_bytes`, `mcp_server_scope`, plus `tool_parameters`/`tool_input` when `OTEL_LOG_TOOL_DETAILS=1` |
| **`claude_code.api_request`** | `model`, **`cost_usd`**, `cost_usd_micros`, `duration_ms`, `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_creation_tokens`, `request_id`, `client_request_id`, `speed` (`fast`/`normal`), `query_source`, `effort`, plus attribution (`agent.name` etc.) |
| `claude_code.api_error` | `model`, `error`, `status_code`, `duration_ms`, `attempt`, `request_id`, attribution |
| `claude_code.api_refusal` | `model`, `request_id`, `server_fallback_hop`, `has_category`, `has_explanation`, `category` (needs `OTEL_LOG_TOOL_DETAILS=1`) |
| `claude_code.api_request_body` / `claude_code.api_response_body` | Full request/response JSON when `OTEL_LOG_RAW_API_BODIES` set — `body`/`body_ref`, `body_length`, `body_truncated` |
| `claude_code.tool_decision` | `tool_name`, `decision`, `tool_source`, `source` (`config`/`hook`/`user_permanent`/`user_temporary`/`user_abort`/`user_reject`) |
| `claude_code.permission_mode_changed` | `from_mode`, `to_mode`, `trigger` |
| `claude_code.auth` | `action` (`login`/`logout`), `success`, `auth_method` |
| `claude_code.mcp_server_connection` | `status`, `transport_type`, `server_scope`, `duration_ms`, `is_plugin` |

The `claude_code.api_request` event is the single richest per-call record for a connector: it carries a **fully computed dollar cost** (`cost_usd`) alongside every token-count dimension, per API call, in near-real time (default 5s log export interval).

### 3.4 Standard attributes (on every metric/event)

| Attribute | Gate |
|---|---|
| `session.id` | `OTEL_METRICS_INCLUDE_SESSION_ID` (default on) |
| `app.version` | `OTEL_METRICS_INCLUDE_VERSION` (default off) |
| `app.entrypoint` (`cli`/`sdk-cli`/`sdk-ts`/`sdk-py`/`claude-vscode`) | `OTEL_METRICS_INCLUDE_ENTRYPOINT` (default off) |
| `organization.id` | always, when available |
| `user.account_uuid`, `user.account_id` | `OTEL_METRICS_INCLUDE_ACCOUNT_UUID` (default on) |
| `user.id` | always (anonymous random ID if unauthenticated) |
| `user.email` | always, when authenticated via OAuth |
| `terminal.type` (e.g. `iTerm.app`, `vscode`, `cursor`, `tmux`) | always, when detected |

Gateway/SSO deployments additionally get `user.groups` and `identity.source: "gateway-oidc"`, and `user.id`/`user.email` reflect the IdP identity rather than an anonymous ID.

### 3.5 Traces (beta)

Enable with `CLAUDE_CODE_ENHANCED_TELEMETRY_BETA=1` plus `OTEL_TRACES_EXPORTER`. Span hierarchy: `claude_code.interaction` → `claude_code.llm_request` / `claude_code.tool` (→ `.blocked_on_user`, `.execution`) / `claude_code.hook` (needs `ENABLE_BETA_TRACING_DETAILED=1`). `claude_code.llm_request` spans carry OTel GenAI semantic-convention fields (`gen_ai.system: "anthropic"`, `gen_ai.request.model`, `gen_ai.response.id`) alongside `input_tokens`/`output_tokens`/`cache_read_tokens`/`cache_creation_tokens`, `ttft_ms`, `stop_reason`.

### 3.6 Managed/enterprise deployment

Set via managed settings (`.claude/settings.json` or enterprise-managed settings), `env` block with the same variable names as above. Managed-settings `OTEL_EXPORTER_OTLP_*` values **lock the destination**: Claude Code strips conflicting developer-set env vars for that signal (endpoint, protocol, headers/certs) so a device can't be redirected away from the org collector. Supports a dynamic-header helper script (`otelHeadersHelper` in settings.json) for token refresh, default refresh interval 29 minutes (`CLAUDE_CODE_OTEL_HEADERS_HELPER_DEBOUNCE_MS`).

---

## 4. Consumer / subscription usage (Pro, Max 5x, Max 20x)

### 4.1 Current prices & limits

| Plan | Price | Notes |
|---|---|---|
| Free | $0 | |
| Pro | $20/mo billed monthly, or ~$17/mo ($200 up front) billed annually | |
| Max 5x | From $100/mo | "5x" refers to usage multiple over Pro |
| Max 20x | From $200/mo | |

**Source:** https://claude.com/pricing (WebFetch summary — treat exact annual figures as `UNVERIFIED` pending a fresh fetch close to purchase time; monthly figures corroborated by multiple independent secondary sources found via WebSearch)

**Usage windows:** every subscription plan (Pro, Max, and — for Claude Code specifically — Team/Enterprise seats) is metered against **two stacked caps**: a rolling **5-hour session window**, and a **weekly window** on top, both shared across Claude chat, Claude Code, and Cowork on that account.

**Source:** https://code.claude.com/docs/en/costs (quoted: *"each member's Claude Code usage draws from a per-seat allowance that resets on a rolling five-hour window and a weekly window. The allowance is shared with Claude chat and Cowork"*)

**Weekly limit history — a notable 2026 change for a connector to know about:**
- Weekly rate limits for Claude Pro/Max were **announced 2025-07-28** and took effect **2025-08-28**.
- Per this research's web search, Anthropic ran a **temporary +50% weekly-limit promotion** that was scheduled to end **2026-09-14**, after which a **permanent +25%** increase (vs. the pre-promotion baseline) takes effect — i.e., users see limits *drop* around 2026-09-14 relative to the promotional period, even though the new permanent baseline is higher than it was before July 2025. **This is actively in transition as of the 2026-09-03 research date** — a connector displaying "your weekly limit" should not hard-code a numeric token/message ceiling; only Anthropic's own `/usage` display and the OAuth usage endpoint (§4.3) reflect the live value.
**Source:** WebSearch results citing Anthropic's 2025-07-28 announcement and 2026 coverage of the September 2026 limit change (bleepingcomputer.com, explainx.ai, apidog.com) — `UNVERIFIED` at the primary-source level (no Anthropic blog post URL was directly fetched in this session; corroborated only by secondary tech-press coverage).

Exact message/token counts per plan (e.g. "Max 5x ≈ 225 messages/5h") are **not published by Anthropic** and are only ever user-reported estimates — quoted from a WebSearch summary: *"Anthropic does not publish an exact figure for any tier."* Treat any such number as `UNVERIFIED` folklore, not a stable API contract.

### 4.2 Official usage surfaces

| Surface | What it shows | Source |
|---|---|---|
| claude.ai → Settings → Usage | Plan usage bars, activity stats, usage-credit spend/balance | https://code.claude.com/docs/en/costs |
| Claude Code `/usage` command | **Session block**: token/cost breakdown for the *current* Claude Code session only, computed **locally at list price** (or at contracted rates if an admin has set the `modelPricing` managed setting). **Plan usage breakdown** (Pro/Max/Team/Enterprise only): attribution by skill/subagent/plugin/MCP server, behavior flags (long context, cache misses ≥10% of usage), and a `Loop`/scheduled-task usage table. Toggle last-24h vs last-7-days with `d`/`w`. | https://code.claude.com/docs/en/costs |
| VS Code extension "Account & usage" dialog | Same attribution/behavior data as `/usage`, Day/Week toggle, no Loops rows | https://code.claude.com/docs/en/costs |
| `/usage-credits` command | Opens claude.ai Settings→Usage (individual) or admin Usage settings (Team/Enterprise with billing access); for members without billing access, sends an approval request to org admins | https://code.claude.com/docs/en/costs |
| `/insights` command | Local-only HTML report (`~/.claude/usage-data/report.html`) analyzing up to 200 recent sessions for productivity patterns, not cost | https://code.claude.com/docs/en/costs |

Quoted, important accuracy caveat for `/usage`'s Session block: *"Claude Max and Pro subscribers have usage included in their subscription, so the session cost figure isn't relevant for billing purposes... The figure is an estimate, so for authoritative billing see the Usage page in the Claude Console."* Also: totals reset on `/clear` (not before Claude Code v2.1.211, where they persisted across `/clear` for the process lifetime), and for data-residency (`inference_geo: us`) responses the local estimate multiplies by the same 1.1x rate as billing (only correctly, as of v2.1.239+).

**Source:** https://code.claude.com/docs/en/costs (fetched in full — this is the single richest official page on this topic)

**Usage credits** ("extra usage"): lets Pro/Max/Team/Enterprise users keep working past the plan's included allowance by switching to metered, **standard API-rate** billing. Enabled per-user at claude.ai Settings → Usage (web only, not mobile app for mobile-purchased subscriptions): set a monthly cap or unlimited, prepay (daily add-funds cap $2,000), optional auto-reload. Credits don't expire in most jurisdictions (Japan is an exception starting 2026-09-10: 6-month expiry with a 7-day warning email).

**Source:** https://support.claude.com/en/articles/12429409-extra-usage-for-paid-claude-plans (WebFetch summary)

### 4.3 Unofficial OAuth usage endpoint

`GET https://api.anthropic.com/api/oauth/usage` — **not documented by Anthropic**; used internally by the `/usage` command and by community tools that read the same endpoint. `UNVERIFIED` / unofficial throughout this subsection.

- **Auth:** `Authorization: Bearer <OAuth access token>`, header `anthropic-beta: oauth-2025-04-20`, and reportedly a real `User-Agent: claude-code/<version>` — omitting the User-Agent reportedly routes the request into an aggressively rate-limited bucket (persistent 429s).
- **Response shape** (community-reconstructed, e.g. from a GitHub issue in `Maciek-roboblog/Claude-Code-Usage-Monitor`):
  ```json
  {
    "five_hour": { "utilization": 8.0, "resets_at": "2026-01-22T09:00:00Z" },
    "seven_day": { "utilization": 77.0, "resets_at": "2026-01-22T19:00:00Z" }
  }
  ```
  The task brief additionally expects `seven_day_opus`, `seven_day_sonnet`, and `extra_usage` fields (model-specific weekly buckets plus usage-credit spend) — plausible given `/usage`'s documented per-model-limit messaging ("You've hit your Opus limit" vs Sonnet, §5's `/usage` notes) but **not independently confirmed** in this session's sources.
- **Known bug, worth flagging to users of a connector built on this endpoint:** a GitHub issue titled *"Claude Code: the 'weekly' usage limit resets every 72 hours, not 7 days"* reports the `seven_day` window's actual reset cadence does not match its name.
- Credential source for calling this yourself: `~/.claude/.credentials.json` (Linux/WSL, and macOS as a Keychain-write fallback) or the macOS Keychain.

**Source:** WebSearch results referencing https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor/issues/202, https://github.com/anthropics/claude-code/issues/31021, https://gist.github.com/monperrus/3ac4b303a84946bbeaf2b1123ee99491 — all `UNVERIFIED` against a primary Anthropic source, since this endpoint is intentionally undocumented.

### 4.4 Credential storage (for tools that read Claude Code's own OAuth session)

- **macOS:** Keychain, service name **`"Claude Code-credentials"`**. Read locally with: `security find-generic-password -s 'Claude Code-credentials' -w` → JSON with `accessToken`, `refreshToken`, `expiresAt`. If the Keychain write is rejected (e.g. locked in an SSH session), Claude Code falls back to `~/.claude/.credentials.json`, mode `0600`.
- **Linux/WSL:** `~/.claude/.credentials.json` directly (no Keychain equivalent used).
- Fields, per the task brief and corroborated by the community sources found: `claudeAiOauth.{accessToken, refreshToken, expiresAt, scopes, subscriptionType, rateLimitTier}`. `expiresAt` is epoch milliseconds.
- Note: the *official* `.claude` directory reference (§2.1) does **not** mention `.credentials.json` or Keychain at all — credential storage is intentionally left out of the public docs. Everything in this subsection is `UNVERIFIED` / community-sourced.

**Source:** WebSearch results referencing a GitHub gist ("Claude Code Credentials: Read & Write Tokens on Every OS"), a Silverfort security write-up, and community troubleshooting threads — none of these are Anthropic-published.

### 4.5 Community tools that read consumer usage

| Tool | What it reads | Source |
|---|---|---|
| **ccusage** (§2.3) | Local JSONL transcripts, `~/.config/claude` (its own fallback) or `CLAUDE_CONFIG_DIR` | https://github.com/ryoppippi/ccusage |
| **Claude-Code-Usage-Monitor** | Primarily local JSONL (default path `~/.config/claude`, `--data-paths` for multiple accounts without merging); an *experimental* `--api` flag calls the OAuth usage endpoint (§4.3) for "official `rate_limits`" via a `--statusline` hook. Plan detection: fixed token-limit estimates per plan (Pro ≈19,000; Max5 ≈88,000; Max20 ≈220,000 — these are the tool's own local heuristics, not Anthropic-published figures) or a P90-percentile "custom" mode that learns a limit from historical local session data. | https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor (WebFetch summary) |
| **CodexBar**, other "claude-usage" menubar apps | `UNVERIFIED` in this session — not independently fetched; treat as unofficial, local-file- or OAuth-endpoint-based like the above two. |

All of these are **unofficial, third-party, and unaffiliated with Anthropic** — none appear in Anthropic's own documentation.

### 4.6 ToS considerations — a significant 2026 development

Anthropic **tightened and then enforced** a ban on using consumer-subscription OAuth credentials (Free/Pro/Max) with anything other than first-party Claude Code and claude.ai:

- **2026-02-19:** Anthropic updated its documentation to state that OAuth tokens obtained through Free/Pro/Max plans are for Claude Code and claude.ai only — use in the Agent SDK or any other third-party tool/product/service is "not permitted."
- **~March 2026:** server-side enforcement began; third-party clients authenticating with a consumer OAuth token started receiving rejections referencing something like *"This credential is only authorized for use with Claude Code."*
- **2026-04-04, 12:00 PT:** full enforcement — Claude subscriptions stopped covering usage through third-party tools entirely; anyone who had been piping a Pro/Max OAuth token into a non-Anthropic tool had to switch to pay-as-you-go API billing.

**Implication for clai:** a connector that reads *local files* Claude Code itself writes (transcripts, `/usage`, OpenTelemetry) is reading data, not authenticating as the user to a service — that's a fundamentally different posture from a tool that takes the user's Max/Pro OAuth token and calls `api.anthropic.com` *as* Claude Code. The OAuth-usage-endpoint approach in §4.3 is the one most exposed to this policy: even read-only calls to `/api/oauth/usage` using a consumer OAuth token arguably fall inside "using OAuth tokens obtained through Free, Pro, or Max accounts in any other product, tool, or service." Treat §4.3 as **ToS-risky** for a commercial product; local-file and OpenTelemetry-based collection (§2, §3) carry no such exposure since they read data the user's own installation already wrote/exported, using the user's own credentials against no Anthropic endpoint at all.

**Source:** WebSearch results citing gigazine.net, theregister.com ("Anthropic clarifies ban on third-party tool access to Claude"), and a Boris Cherny (Head of Claude Code) announcement referenced in techtimes.com coverage — `UNVERIFIED` at the primary-source level in this session (Anthropic's own docs/blog post announcing this was not independently fetched), but corroborated by three independent secondary sources with consistent dates.

### 4.7 claude.ai data export

Location: claude.ai → (account initials, bottom-left) → Settings → Privacy → **Export data**. Anthropic emails a ZIP download link to the account's email; per one secondary source the link expires 24 hours after delivery.

**Contents** (per WebSearch summaries, not independently fetched — `UNVERIFIED` schema-level detail):
- `conversations.json` — a JSON array, one entry per conversation, each with `chat_messages`. Fields reported by secondary sources: `uuid`, `name`, `created_at`, `updated_at`, and per-message `sender` (`human`/`assistant`), timestamps, and content. One source describes messages as forming a `parent_message_uuid`-linked list rather than a flat ordered array (i.e. reconstructing conversation order requires walking parent pointers, not just reading array order) — `UNVERIFIED`, and if true, is an important parsing detail for a connector.
- `users.json`, `projects.json` — account/user metadata and Projects metadata; one source explicitly notes **"Project boundaries are not preserved as folders"** in the export.

**Token counts / model names:** this research found **no confirmation that the export includes per-message token counts or the model name used for a given response.** Every secondary source describes the export as message *content* (text, attachments, timestamps) with no mention of usage/cost/model fields. Treat claude.ai data export as **useless for cost reconstruction** — it is a content-only export, not a usage export. This is a meaningful negative finding for a connector: don't build a token-cost estimator on top of this export without first confirming (via an actual test export) that no usage fields exist.

**Source:** WebSearch summaries; no official Anthropic schema page was found or fetched for `conversations.json`. `UNVERIFIED` throughout.

---

## 5. Team & Enterprise

### 5.1 Seat pricing

| Plan | Seat type | Price |
|---|---|---|
| Team | Standard | $25/seat/mo billed monthly, or $20/seat/mo billed annually ($240/yr) |
| Team | Premium (more Claude Code usage headroom) | $125/seat/mo billed monthly, or $100/seat/mo billed annually ($1,200/yr) |
| Team | — | 2-seat minimum, 150-seat cap (self-serve) |
| Enterprise | Single seat type | $20/seat/mo (billed annually); **seat fee covers platform access only — all usage (chat, Claude Code, Cowork) billed separately at standard API rates** on top |
| Enterprise | — | Self-serve starts at 20 seats; sales-assisted at 50; one secondary source states a 70-user/12-month/~$50K-minimum-annual-spend threshold for full Enterprise contracts — `UNVERIFIED`, likely varies by deal |

**Source:** WebSearch summaries (tldv.io, morphllm.com, and others) for exact prices — `UNVERIFIED` at primary-source level; corroborated by the WebFetch of claude.com/pricing in §4.1 which independently returned matching Team Standard/Premium figures ($25/$20 and $125/$100).

Claude Code seat behavior: *"Claude Code is included with every Team plan seat. Premium seats offer more usage for team members with heavier workloads."* For Enterprise: newer/self-serve Enterprise plans include Claude Code with every seat; **older** Enterprise contracts instead offered a separate usage-based "Chat + Claude Code" seat vs. a seat-based Premium seat. On a **usage-based** Enterprise plan (including self-serve Enterprise), there is no per-seat Claude Code usage cap at all — it's pure consumption billed at API rates.

**Source:** https://support.claude.com/en/articles/11845131-use-claude-code-with-your-team-or-enterprise-plan (WebFetch summary)

Average reported spend (Anthropic's own guidance, quoted): *"the average cost is around \$13 per developer per active day and \$150-250 per developer per month, with costs remaining below \$30 per active day for 90% of users."*

**Source:** https://code.claude.com/docs/en/costs

### 5.2 Admin console usage analytics / Claude Code Analytics dashboard

| Surface | What admins see | Source |
|---|---|---|
| Console usage page, `platform.claude.com/usage` | Token/request charts, rate-limit charts, cache-hit-rate | https://platform.claude.com/docs/en/api/rate-limits |
| **Console → Claude Code dashboard**, `platform.claude.com/claude-code` | Per-member spend and accepted-lines-of-code, for Console/API orgs | https://code.claude.com/docs/en/costs |
| **claude.ai Analytics dashboard**, `claude.ai/analytics/claude-code` | Daily active users, sessions, contribution metrics; CSV export of contribution data — for Team/Enterprise orgs | https://code.claude.com/docs/en/costs |
| **Spend report** (Team/Enterprise), in org analytics | Estimated per-user, per-model spend; CSV export; updated daily; only covers usage-credit spend (seat-allowance usage isn't metered in dollars) | https://support.claude.com/en/articles/12883420-view-usage-analytics-for-team-and-enterprise-plans (linked, not independently fetched — `UNVERIFIED` detail level) |

Quoted, an important nuance: on Team/Enterprise, *in-seat-allowance* Claude Code usage is **not metered in dollars at all** — only usage-credit ("extra usage") spend shows a dollar figure in the spend report. A connector aiming to show "what did this cost" for a Team/Enterprise org needs the **Enterprise Analytics API** (§5.3) for token-level detail, since the admin console's dollar figures only cover the overage portion.

### 5.3 Claude Enterprise Analytics API — the definitive answer to "is Enterprise on a separate API"

**Yes — confirmed.** Claude Enterprise (claude.ai) organizations use a wholly separate API family, `https://api.anthropic.com/v1/organizations/analytics/*`, with its own key type (**Analytics API key**, `read:analytics` scope, created by the org's **primary owner** at `claude.ai/admin-settings/api-access`, distinct from an Admin API key). Quoted decision table:

| API | Key type | Created in | Who can create it | Covers |
|---|---|---|---|---|
| Claude Code Analytics API | Admin API key (`sk-ant-admin01-...`) | Claude Console → Settings → Admin keys | Organization admin | Daily Claude Code metrics per user |
| Claude Enterprise Analytics API | Analytics API key | claude.ai → Organization settings → API | Primary owner | Org-wide engagement/adoption + cost/usage across all Claude products |

Quoted: *"The key types are not interchangeable: an Admin API key cannot call the Claude Enterprise Analytics API, and an Analytics API key cannot call the Admin API."*

**Source:** https://platform.claude.com/docs/en/manage-claude/analytics-api (fetched in full — this is the authoritative page for the whole "which API" question)

**Endpoints** (all under `/v1/organizations/analytics/`):

| Endpoint | Purpose |
|---|---|
| `GET /summaries` | Org-wide daily activity: DAU/WAU/MAU, adoption rates, per-product active-user breakdowns (chat, Claude Code, Claude Design, Office Agent, Science, Cowork) |
| `GET /users` | Per-user activity for one day |
| `GET /skills` | Per-skill usage for one day |
| `GET /usage_report` | Token usage, bucketed by minute/hour/day |
| `GET /user_usage_report` | Per-user token usage, ranked |
| `GET /cost_report` | USD cost, bucketed by minute/hour/day |
| `GET /user_cost_report` | Per-user cost, ranked |

Auth: `x-api-key: $ANTHROPIC_ADMIN_API_KEY` (an Analytics API key is passed the same way) + `anthropic-version: 2023-06-01`.

**Full quoted example, `/usage_report`:**
```json
{
  "data": [
    {
      "ending_at": "2019-12-27T18:11:19.117Z",
      "results": [
        {
          "cache_creation": { "ephemeral_1h_input_tokens": 1000, "ephemeral_5m_input_tokens": 500 },
          "cache_read_input_tokens": 0,
          "context_window": "0-200k",
          "inference_geo": "global",
          "model": "claude-opus-5",
          "output_tokens": 0,
          "product": "chat",
          "rbac_group_id": "rbac_group_012rppKaSVsmTo6NqRDXQXNF",
          "requests": 0,
          "server_tool_use": { "web_search_requests": 10 },
          "slack_channel_id": "C0123ABCDEF",
          "speed": "fast",
          "uncached_input_tokens": 0
        }
      ],
      "starting_at": "2019-12-27T18:11:19.117Z"
    }
  ],
  "data_refreshed_at": "2019-12-27T18:11:19.117Z",
  "has_more": true,
  "next_page": "next_page",
  "organization_id": "org_013FP9SaFPBg7Kw7fetjn6cF"
}
```
`product` values: `chat`, `claude-tag`, `claude_code`, `claude_design`, `claude_in_chrome`, `cowork`, `office_agent`. `rbac_group_id`/`slack_channel_id` are Enterprise-only attribution dimensions with no equivalent on the Console usage_report/messages endpoint.

**Full quoted example, `/cost_report`:** amounts are decimal-string fractional cents (e.g. `"41280.000000"` = $412.80; `list_amount` is pre-discount); `cost_type` ∈ {`tokens`, `code_execution`, `web_search`}; `token_type` breaks down the same way as the Console cost endpoint.

**Source (both examples, verbatim):** https://platform.claude.com/docs/en/api/admin/analytics (WebFetch summary of the reference page — high confidence given it matches the vocabulary used consistently across every other page fetched in this research, but flagged as a WebFetch summary rather than a hand-verified byte-exact copy)

**Freshness & limits** (quoted from the guide page, high confidence):
- Engagement/adoption endpoints: aggregated at 10:00 UTC the next day, ~1-day lag; requesting an unavailable date returns 400 naming the latest available day.
- Cost/usage endpoints: available within 4 hours typically, up to 24 hours; **values can be revised for up to 30 days** as late events reconcile — for invoicing-grade totals, query dates ≥30 days old.
- Data available no earlier than **2026-01-01**.
- Date range limit: 31 days (usage/cost), 366 days (summaries).
- Rate limit: **60 requests/minute per organization** (not per key).
- Pagination cursors are bound to the query that produced them — changing `group_by[]`/date range/filters mid-sequence with an old cursor returns 400.
- Amounts: decimal strings in cents (same convention as §1.3).
- Known gap: Claude Code usage via Amazon Bedrock is **not** captured by this API even for an Enterprise org.

**Source:** https://platform.claude.com/docs/en/manage-claude/analytics-api

### 5.4 Compliance API

A **separate, third** API family from both Admin and Analytics — for security/legal/audit use cases (per-event activity, not aggregated metrics).

- Base: `https://api.anthropic.com/v1/compliance/*`, auth `x-api-key` + `anthropic-version`.
- Two key types: a **Compliance Access Key** (created in claude.ai) reaches every Compliance endpoint; an **Admin API key** reaches only the shared Activity Feed (`GET /v1/compliance/activities`, needs `read:compliance_activities` scope).
- Scope: for a Claude Enterprise parent org, directory endpoints (organizations/users/roles/groups) span every linked org (both claude.ai orgs and Console orgs); content endpoints (chats/files/projects) are claude.ai-only; session endpoints cover **Cowork, Claude Code, Claude Science, and Claude for Microsoft 365** transcripts — both "local sessions" (on-device, while signed in with an Enterprise account) and "remote sessions" (Cowork run in Anthropic-managed cloud environments).
- Quoted example (`GET /v1/compliance/activities?limit=1`):
  ```json
  {
    "data": [
      {
        "id": "activity_01XyDMpzjS89pFZXqSFUBDr6",
        "created_at": "2026-04-10T08:09:10Z",
        "organization_id": "org_01Wv6QeBcDfGhJkLmNpQrSt8",
        "organization_uuid": "abcdef01-2345-6789-abcd-ef0123456789",
        "actor": {
          "type": "user_actor",
          "email_address": "user@example.com",
          "user_id": "user_01TuVwXyZaBcDeFgH2JkLmN4",
          "ip_address": "192.0.2.34",
          "user_agent": "Mozilla/5.0..."
        },
        "type": "claude_chat_created",
        "claude_chat_id": "claude_chat_01XyDMpzjS89pFZXqSFUBDr6",
        "claude_project_id": "claude_proj_01KGp4eZNug9ri4kE35RSppq"
      }
    ],
    "has_more": true,
    "first_id": "activity_01XyDMpzjS89pFZXqSFUBDr6",
    "last_id": "activity_01XyDMpzjS89pFZXqSFUBDr6"
  }
  ```
- Rate limit: 600 requests/minute per parent org, shared across local-session endpoints; remote-session endpoints carry a second budget on top.
- A standalone Console org (no Enterprise parent) can only reach the Activity Feed.
- Anthropic's own guidance is explicit that this is **not** the tool for usage/cost — quoted: *"The two API families answer different questions... whereas the Compliance API returns per-event records for security, legal, and compliance teams."* Not useful for a cost tracker beyond attribution/audit context.

**Source:** https://platform.claude.com/docs/en/manage-claude/compliance-api (fetched in full)

### 5.5 SCIM

Available for **Enterprise and standalone Console orgs only — not Team plans.** SSO (SAML 2.0 via WorkOS) must be configured and tested before SCIM provisioning is attempted; provisioning calls fail otherwise. Governs directory sync (user/group provisioning and deprovisioning from an IdP), not usage/cost data.

**Source:** https://support.claude.com/en/articles/13133195-set-up-jit-or-scim-provisioning and https://support.claude.com/en/articles/14499648-how-scim-sync-works-for-enterprise-organizations (WebSearch summaries — `UNVERIFIED` detail level, not independently fetched)

### 5.6 Extra usage / spend caps for Team & Enterprise Claude Code

Confirms and extends §4.2: once usage credits are turned on for a Team/Enterprise org, admins can set spend limits at the **organization, group, or individual member level**, all billed at standard API rates once the per-seat allowance is exhausted. Per-workspace spend/rate limits (Console/API orgs) are configured on the auto-created "Claude Code" workspace — quoted: *"When you first authenticate Claude Code with your Claude Console account, a workspace called 'Claude Code' is automatically created for you... You cannot create API keys for this workspace; it is exclusively for Claude Code authentication and usage."* Console-org admins can also cap this workspace's own rate limit independently of the org-wide limit, to protect other production workloads from Claude Code traffic. A recommended TPM/RPM-per-user sizing table by team size (1–5 users: 200–300k TPM/5–7 RPM per user, scaling down to 500+ users: 10–15k TPM/0.25–0.35 RPM per user) is published for Console-org admins setting workspace limits.

**Source:** https://code.claude.com/docs/en/costs

---

## 6. Pricing mechanics for cost math

### 6.1 Cache pricing multipliers (relative to base input price)

| Operation | Multiplier | Notes |
|---|---|---|
| 5-minute cache write | **1.25x** | Cache valid 5 min |
| 1-hour cache write | **2x** | Cache valid 1 hour |
| Cache read (hit) | **0.1x** standard; **0.025x** on Claude Fable 5.1 / Claude Mythos 5.1 | i.e. Fable 5.1 cache reads cost $0.25/MTok against its $10 base rate — quoted footnote: *"Cache hits and refreshes on Claude Fable 5.1 and Claude Mythos 5.1 are priced at 0.025x the base input price. All other models use the standard 0.1x multiplier."* |

Quoted: *"A cache hit costs 10% of the standard input price, which means caching pays off after one cache read for the 5-minute duration (1.25x write), or after two cache reads for the 1-hour duration (2x write). On Claude Fable 5.1 and Claude Mythos 5.1, a cache hit costs 2.5% of the standard input price."* Multipliers **stack** with Batch API and data-residency multipliers.

**Source:** https://platform.claude.com/docs/en/about-claude/pricing#prompt-caching

### 6.2 Batch API — confirmed 50% discount on both input and output

All current-model batch prices are exactly half the synchronous price (see full table in §6.7). Fast mode is **not** available with Batch.

**Source:** https://platform.claude.com/docs/en/about-claude/pricing#batch-processing

### 6.3 Long-context pricing — a significant simplification vs. older (pre-4.6) practice

**Current state, quoted:** *"Claude 4.6 and later models and Claude Mythos Preview include the full 1M token context window at standard pricing. (A 900k-token request is billed at the same per-token rate as a 9k-token request.) Prompt caching and batch processing discounts apply at standard rates across the full context window."* and, separately: *"For every model with a 1M-token context window, 1M is the default: you don't need a beta header, and long-context requests are billed at standard pricing."*

**No current model has a >200K premium tier.** Models with a 1M context window (Fable 5.1, Mythos 5.1, Fable 5, Mythos 5, Opus 5, Opus 4.8, Opus 4.7, Opus 4.6, Sonnet 5, Sonnet 4.6, Mythos Preview) bill the *entire* window at the single rate in the §6.7 table. Models capped at 200K (Sonnet 4.5, Haiku 4.5, and older) simply have no >200K option at all — there's nothing to premium-price. This is a **change worth flagging explicitly**: older long-context premium pricing that existed for prior-generation models (a >200K beta tier at elevated rates) is gone from the current pricing page entirely — don't carry forward any "long-context surcharge" logic from pre-2026 pricing assumptions.

The `context_window` dimension used in usage/cost report `group_by`/filters takes values like `0-200k` / `200k-1M` — this is purely a *reporting* bucket now, not a *pricing* bucket, since both buckets bill identically on 1M-context models.

**Source:** https://platform.claude.com/docs/en/about-claude/pricing#long-context-pricing and https://platform.claude.com/docs/en/build-with-claude/context-windows

### 6.4 Priority Tier & Fast Mode

- **Priority Tier:** a `service_tier` value (`priority`) with its own billing model, **excluded from the Cost API** — track it only via the Usage API's `service_tier` dimension (§1.2), per the explicit warning quoted in §1.3. Exact Priority Tier rates were not located in this research (`UNVERIFIED`) — the pricing.md fetch did not surface a Priority Tier price table; only its exclusion-from-cost-endpoint behavior and its separate `anthropic-priority-*-tokens-*` rate-limit headers (§7.2) were confirmed. Per the bundled `claude-api` skill's cached knowledge, Priority Tier is supported on Claude Fable 5, Opus 4.8, and other "older current" models but **excluded** on Claude Opus 5, Claude Sonnet 5, Claude Fable 5.1/Mythos 5.1, and Mythos 5/Preview — `UNVERIFIED` against a live page in this session.
- **Fast Mode** (research preview): Opus 5 / Opus 4.8 only, **$10/$50 per MTok** (input/output) — applies across the full context window, stacks with cache and data-residency multipliers, **not available with Batch**, Claude API only (not Claude Platform on AWS or partner clouds). Opus 4.7 rejects `speed: "fast"` with an error; Opus 4.6 silently runs at standard speed/price if `speed: "fast"` is requested.

**Source:** https://platform.claude.com/docs/en/about-claude/pricing#fast-mode-pricing

### 6.5 Server-tool & sandbox pricing

| Tool | Price | Notes |
|---|---|---|
| Web search | **$10 per 1,000 searches**, plus standard token cost for search-generated content | Each search = one billable use regardless of result count; errored searches are not billed. Confirmed via quoted `usage.server_tool_use.web_search_requests` example. |
| Web fetch | **No additional charge** — standard token cost only | Confirmed via quoted `usage.server_tool_use.web_fetch_requests` example. Typical costs: ~2,500 tokens for a 10 KB page, ~25,000 for a 100 KB doc, ~125,000 for a 500 KB PDF. |
| Code execution | **Free when combined with web search or web fetch** (`_20260209`+ tool versions). Standalone: min. 5-minute billing per execution; **1,550 free container-hours/month per org**; **$0.05/hour/container** beyond that. Billed even if the tool isn't called, when files are preloaded onto the container. | `usage.server_tool_use.code_execution_requests` in response. |
| Managed Agents session runtime | **$0.08/session-hour**, metered to the millisecond, only while session status is `running` (not `idle`/`rescheduling`/`terminated`) | Replaces code-execution container-hour billing for Managed Agents; token costs bill separately at standard model rates. |

**Source:** https://platform.claude.com/docs/en/about-claude/pricing (Specific tool pricing / Claude Managed Agents pricing sections — all figures directly quoted)

### 6.6 Image & PDF token estimation

**Images:** Claude tokenizes images in 28×28-pixel patches ("visual tokens"): `tokens = ceil(width/28) × ceil(height/28)`. Two resolution tiers control the max before downscaling:

| Tier | Models | Max long edge | Max visual tokens |
|---|---|---|---|
| High-resolution | Claude 4.7 and later | 2576 px | 4784 |
| Standard | All other models | 1568 px | 1568 |

Worked examples (quoted table): 1000×1000px (1MP) → 1296 tokens on both tiers (not resized); 1920×1080px → 1560 tokens standard tier (downsized to 1456×819) vs 2691 tokens high-res (not resized); 3840×2160px (4K) → 1560 tokens standard (downsized) vs 4784 tokens high-res (downsized to 2576×1449, hitting the visual-token cap). Request limits: 20 images/turn on claude.ai; 100/request on 200K-context models; 600/request on other (1M-context) models; max 8000×8000px per image; max 10MB base64 (5MB on Bedrock/Google Cloud).

**Source:** https://platform.claude.com/docs/en/build-with-claude/vision (fetched in full; token formula and table directly quoted)

**PDFs:** quoted: *"Text token costs: Each page typically uses 1,500–3,000 tokens per page depending on content density. Standard API pricing applies with no additional PDF fees. Image token costs: Because each page is converted into an image, the same image-based cost calculations are applied"* (i.e. on top of the text-extraction cost, each page also separately incurs an image-token cost per §6.6's image formula, since Claude also sees a rendered image of the page). Limits: 600 pages/request (100 for <1M-context models), 32MB request size.

**Source:** https://platform.claude.com/docs/en/build-with-claude/pdf-support

### 6.7 Full current model price table (per MTok, USD) — live as of 2026-09-03

| Model | Base input | 5m cache write | 1h cache write | Cache read | Output |
|---|---|---|---|---|---|
| Claude Fable 5.1 | $10 | $12.50 | $20 | **$0.25** (0.025x) | $50 |
| Claude Mythos 5.1 (Project Glasswing only) | $10 | $12.50 | $20 | $0.25 | $50 |
| Claude Fable 5 | $10 | $12.50 | $20 | $1 | $50 |
| Claude Mythos 5 (Project Glasswing only) | $10 | $12.50 | $20 | $1 | $50 |
| Claude Opus 5 | $5 | $6.25 | $10 | $0.50 | $25 |
| Claude Opus 4.8 | $5 | $6.25 | $10 | $0.50 | $25 |
| Claude Opus 4.7 | $5 | $6.25 | $10 | $0.50 | $25 |
| Claude Opus 4.6 | $5 | $6.25 | $10 | $0.50 | $25 |
| Claude Opus 4.5 | $5 | $6.25 | $10 | $0.50 | $25 |
| Claude Opus 4.1 — **retired except on Bedrock/Google Cloud** | $15 | $18.75 | $30 | $1.50 | $75 |
| Claude Opus 4 — **retired except on Google Cloud** | $15 | $18.75 | $30 | $1.50 | $75 |
| Claude Sonnet 5 | **$2** (permanent — see note) | $2.50 | $4 | $0.20 | **$10** |
| Claude Sonnet 4.6 | $3 | $3.75 | $6 | $0.30 | $15 |
| Claude Sonnet 4.5 | $3 | $3.75 | $6 | $0.30 | $15 |
| Claude Sonnet 4 — **retired except on Bedrock/Google Cloud** | $3 | $3.75 | $6 | $0.30 | $15 |
| Claude Haiku 4.5 | $1 | $1.25 | $2 | $0.10 | $5 |
| Claude Haiku 3.5 — **retired except on Bedrock/Google Cloud** | $0.80 | $1 | $1.60 | $0.08 | $4 |

**Note on Sonnet 5 pricing — a 2026 change worth flagging:** quoted directly: *"The $2/$10 per million input/output token pricing for Claude Sonnet 5, announced at launch as introductory pricing through August 31, 2026, is now the standard price. The previously scheduled increase to $3/$15 per million input/output tokens on September 1, 2026 will not occur."* I.e., as of yesterday (2026-09-01) this "introductory" price became permanent — a connector's pricing table should **not** apply a September-2026 rate hike for Sonnet 5.

**Batch pricing (50% off, full table):**

| Model | Batch input | Batch output |
|---|---|---|
| Fable 5.1 / Mythos 5.1 / Fable 5 / Mythos 5 | $5 | $25 |
| Opus 5 / 4.8 / 4.7 / 4.6 / 4.5 | $2.50 | $12.50 |
| Opus 4.1 / Opus 4 (retired, non-first-party only) | $7.50 | $37.50 |
| Sonnet 5 | $1 | $5 |
| Sonnet 4.6 / 4.5 | $1.50 | $7.50 |
| Sonnet 4 (retired, non-first-party only) | $1.50 | $7.50 |
| Haiku 4.5 | $0.50 | $2.50 |
| Haiku 3.5 (retired, non-first-party only) | $0.40 | $2 |

**Source (both tables, verbatim):** https://platform.claude.com/docs/en/about-claude/pricing

**Model IDs, aliases, and deprecation status.** Live pricing.md (fetched today) confirms *retirement status*; exact dated-snapshot IDs below are from the bundled `claude-api` Claude Code skill's cached model catalog (dated **2026-06-24** — noticeably **older** than today's research date, so cross-checked against live pricing.md wherever possible and flagged where the two disagree):

| Friendly name | Alias | Dated snapshot ID | Status (live, 2026-09-03) |
|---|---|---|---|
| Claude Fable 5.1 / Mythos 5.1 | `claude-fable-5-1` / `claude-mythos-5-1` | alias-only, no dated ID published | Active |
| Claude Fable 5 / Mythos 5 | `claude-fable-5` / `claude-mythos-5` | alias-only | Active (superseded by 5.1 but still served) |
| Claude Opus 5 | `claude-opus-5` | alias-only | Active |
| Claude Opus 4.8 / 4.7 / 4.6 | `claude-opus-4-8` / `-4-7` / `-4-6` | alias-only | Active |
| Claude Opus 4.5 | `claude-opus-4-5` | `claude-opus-4-5-20251101` | Active |
| Claude Opus 4.1 | `claude-opus-4-1` | `claude-opus-4-1-20250805` | **Retired on first-party API** (cache said "retires 2026-08-05" — confirmed now past; still on Bedrock/Google Cloud) |
| Claude Opus 4 | `claude-opus-4-0` | `claude-opus-4-20250514` | **Retired on first-party API** (cache said "TBD"; live page now shows retired, Google Cloud only remains) |
| Claude Sonnet 5 | `claude-sonnet-5` | alias-only | Active |
| Claude Sonnet 4.6 | `claude-sonnet-4-6` | alias-only | Active |
| Claude Sonnet 4.5 | `claude-sonnet-4-5` | `claude-sonnet-4-5-20250929` | Active |
| Claude Sonnet 4 | `claude-sonnet-4-0` | `claude-sonnet-4-20250514` | **Retired on first-party API** (cache said "TBD"; live page now shows retired, Bedrock/Google Cloud only remain) |
| Claude Haiku 4.5 | `claude-haiku-4-5` | `claude-haiku-4-5-20251001` | Active |
| Claude Haiku 3.5 | — | `claude-3-5-haiku-20241022` | **Retired on first-party API** as of 2026-02-19 (cache); Bedrock/Google Cloud only remain (live page) |
| Claude Haiku 3 | — | `claude-3-haiku-20240307` | Per cache, deprecated with a stated 2026-04-19 retirement — that date has now passed; not present on the live pricing table at all, consistent with full retirement |
| Claude Sonnet 3.7 | — | `claude-3-7-sonnet-20250219` | Fully retired 2026-02-19 (cache); absent from live pricing page |
| Claude Opus 3 | — | `claude-3-opus-20240229` | Fully retired 2026-01-05 (cache) |
| Claude Sonnet 3.5 (v2 / v1) | — | `claude-3-5-sonnet-20241022` / `-20240620` | Fully retired 2025-10-28 (cache) |
| Claude Sonnet 3 | — | `claude-3-sonnet-20240229` | Fully retired 2025-07-21 (cache) |
| Claude 2.1 / 2.0 | — | `claude-2.1` / `claude-2.0` | Fully retired 2025-07-21 (cache) |

**Notable 2026 pattern for a connector's deprecation logic:** Anthropic's own pricing page distinguishes **"retired"** (gone from the first-party Claude API, but the row is *kept* on the pricing page with a note like *"retired, except on Bedrock and Google Cloud"* because the model is still billable there) from full removal from the pricing page entirely (nothing left anywhere, e.g. Haiku 3, Sonnet 3.7). A connector mapping model ID → price must handle **platform-conditional retirement**, not a single global "retired" boolean.

**Source for dated IDs and original deprecation-date estimates:** bundled `claude-api` Claude Code skill, `shared/models.md`, cached 2026-06-24 — **not** independently re-verified against a live URL this session; only the *retirement status* column was cross-checked against the live pricing.md fetch. For authoritative, current deprecation dates, see https://platform.claude.com/docs/en/about-claude/model-deprecations (linked from pricing.md but not independently fetched in this session).

---

## 7. API response `usage` object & rate-limit headers (for a proxy/SDK-wrapper collector)

### 7.1 The `usage` object

No single official page was found with one exhaustive `usage` object schema listing (the Messages API reference page WebFetch was truncated before reaching the response schema section). The fields below are all **individually confirmed** via quoted examples on other official pages:

| Field | Confirmed via | Example |
|---|---|---|
| `input_tokens`, `output_tokens` | Pricing guide, code-execution/web-search examples | `"input_tokens": 105, "output_tokens": 239` |
| `cache_read_input_tokens`, `cache_creation_input_tokens` | Pricing guide, web-search example | `"cache_read_input_tokens": 7123, "cache_creation_input_tokens": 7345` |
| `cache_creation.ephemeral_5m_input_tokens` / `.ephemeral_1h_input_tokens` | Usage & Cost API guide (§1.2), Enterprise Analytics API (§5.3) | `"cache_creation": {"ephemeral_1h_input_tokens": 1000, "ephemeral_5m_input_tokens": 500}` |
| `server_tool_use.web_search_requests` | Pricing guide | `"server_tool_use": {"web_search_requests": 1}` |
| `server_tool_use.web_fetch_requests` | Pricing guide | present in the web-fetch example |
| `server_tool_use.code_execution_requests` | Pricing guide | `"server_tool_use": {"code_execution_requests": 1}` |
| `service_tier` | Usage API `group_by`/filter dimension name, plus explicit mention of `priority`/`batch`/`standard` values | Confirmed as a *dimension name* on the reporting APIs; confirmed as a per-response field in the general Messages API by context (service tier is selectable per-request and must be echoed back) — `UNVERIFIED` as a literal quoted response example |
| `inference_geo` | Usage API dimension (§1.2), pricing page (data residency multiplier), context-awareness docs | Values `global`/`us`/`not_available` |
| `speed` | Usage API dimension, needs `fast-mode-2026-02-01` beta; fast-mode docs describe `response.usage.speed` reporting which speed was used | Values `standard`/`fast` |
| `iterations` | Not found anywhere in this research | `UNVERIFIED` — could not confirm this field exists on the standard `usage` object; may be specific to a beta feature (e.g. programmatic tool calling, task budgets) not covered by the pages fetched this session |

Two real, verbatim response examples from the official pricing page (useful as ground truth for a parser test fixture):
```json
{
  "usage": {
    "input_tokens": 105,
    "output_tokens": 239,
    "server_tool_use": { "code_execution_requests": 1 }
  }
}
```
```json
{
  "usage": {
    "input_tokens": 105,
    "output_tokens": 6039,
    "cache_read_input_tokens": 7123,
    "cache_creation_input_tokens": 7345,
    "server_tool_use": { "web_search_requests": 1 }
  }
}
```
**Source:** https://platform.claude.com/docs/en/about-claude/pricing

**Context window accounting note:** quoted, *"If you use prompt caching, the input count is split across `input_tokens`, `cache_read_input_tokens`, and `cache_creation_input_tokens`, and all three count toward the window"* and — critically for ITPM rate-limit math (§7.2) — `input_tokens` in the response **only counts tokens after the last cache breakpoint**, not total input; total input = `cache_read_input_tokens + cache_creation_input_tokens + input_tokens`.

**Source:** https://platform.claude.com/docs/en/build-with-claude/context-windows and https://platform.claude.com/docs/en/api/rate-limits

### 7.2 Rate-limit response headers (fully confirmed, quoted table)

| Header | Meaning |
|---|---|
| `retry-after` | Seconds to wait before retrying. **Not sent** on the spend-cap 429 (§7.3). |
| `anthropic-ratelimit-requests-limit` / `-remaining` / `-reset` | Request-rate window (RFC 3339 reset time) |
| `anthropic-ratelimit-tokens-limit` / `-remaining` / `-reset` | Combined token window — shows the **most restrictive** currently-binding limit (e.g. workspace override if one applies); if no workspace limit applies, shows input+output total |
| `anthropic-ratelimit-input-tokens-limit` / `-remaining` / `-reset` | Input-token-specific window |
| `anthropic-ratelimit-output-tokens-limit` / `-remaining` / `-reset` | Output-token-specific window |
| `anthropic-priority-input-tokens-limit` / `-remaining` / `-reset` | Priority Tier only |
| `anthropic-priority-output-tokens-limit` / `-remaining` / `-reset` | Priority Tier only |
| `anthropic-fast-*` | Fast-mode-specific limits (referenced, not enumerated on this page) |
| `request-id` | Globally unique per-request ID, e.g. `req_018EeWyXxfu5pfWkrYcMdjWG` |
| `anthropic-organization-id` | Org owning the credential |
| `anthropic-workspace-id` | `wrkspc_`-prefixed workspace the credential resolved to (absent for Admin API calls or pre-auth failures) |

**Cache-aware rate limiting — important for a connector estimating headroom:** for most models, `cache_read_input_tokens` does **not** count toward ITPM (only `input_tokens` + `cache_creation_input_tokens` do) — quoted: *"With a 2,000,000 ITPM limit and an 80% cache hit rate, you could effectively process 10,000,000 total input tokens per minute."* Exception: **Claude Haiku 3.5 counts `cache_read_input_tokens` toward ITPM** (footnoted exception). OTPM counts only actually-generated output tokens in real time — `max_tokens` does not affect OTPM math. Rate limits use a **token-bucket algorithm** (continuous replenishment, not fixed-interval reset), applied **per model** (not shared across models), and currently **shared across `inference_geo` values** (a `us`-pinned request and a `global` request draw from the same bucket).

**Source:** https://platform.claude.com/docs/en/api/rate-limits (fetched in full — response-headers table and cache-aware-ITPM section directly quoted)

**Usage tiers & standard limits (Claude API, RPM/ITPM/OTPM):**

| Tier | Monthly spend cap | Opus 5 (RPM/ITPM/OTPM) | Sonnet 5 (RPM/ITPM/OTPM) | Haiku 4.5 (RPM/ITPM/OTPM) |
|---|---|---|---|---|
| Start | $500 | 1,000 / 2,000,000 / 400,000 | 1,000 / 2,000,000 / 400,000 | 1,000 / 2,000,000 / 400,000 |
| Build | $1,000 | 5,000 / 5,000,000 / 1,000,000 | 5,000 / 5,000,000 / 1,000,000 | 5,000 / 5,000,000 / 1,000,000 |
| Scale | $200,000 | 10,000 / 10,000,000 / 2,000,000 | 10,000 / 10,000,000 / 2,000,000 | 10,000 / 10,000,000 / 2,000,000 |
| Custom | negotiated | negotiated | negotiated | negotiated |

Fable 5.x (5 and 5.1 combined) has its own, lower pool (e.g. Start: 1,000 RPM / 500,000 ITPM / 100,000 OTPM); Opus 4.x (4.5–4.8, excluding Opus 5) shares one combined pool separate from Opus 5's own pool; Sonnet 4.x (4.5/4.6, excluding Sonnet 5) likewise shares a pool separate from Sonnet 5.

**Source:** https://platform.claude.com/docs/en/api/rate-limits (full tier tables, condensed above — exact numbers directly quoted)

### 7.3 Spend-limit vs. rate-limit errors (a connector should distinguish these)

Both return HTTP 429 with `error.type: "rate_limit_error"`, but:
- **True rate limit:** carries `retry-after`.
- **Spend cap reached (org-tier monthly cap):** quoted example —
  ```json
  {
    "type": "error",
    "error": {
      "type": "rate_limit_error",
      "message": "You have reached your API usage limits: your organization has crossed its monthly API usage threshold, set based on your organization's API tier. You will regain access on 2026-09-01 at 00:00 UTC.",
      "details": { "error_code": "enforced_spend_limit_reached" }
    },
    "request_id": "req_018EeWyXxfu5pfWkrYcMdjWG"
  }
  ```
  No `retry-after` header; `error.details.error_code: "enforced_spend_limit_reached"` is the disambiguator. Retrying (including SDK auto-retry) fails until the next calendar month.
- **Self-imposed spend limit** (below the tier cap): HTTP **400**, `invalid_request_error`, message starting *"You have reached your specified API usage limits"* (or *"...specified workspace API usage limits"*).
- **Claude Code workspace limit specifically:** can return a 429 **with** `retry-after`, unlike the general spend-cap 429.

**Source:** https://platform.claude.com/docs/en/api/rate-limits#spend-limits

---

## Connector implications

Per-source assessment for building clai's data pipeline:

| Source | Reliability tier | Attribution available | Cost availability | Minimal polling strategy |
|---|---|---|---|---|
| **Admin API `usage_report/messages` + `cost_report`** (§1.2–1.3) | Official API, billed/authoritative | api_key_id, workspace_id (org-level only — no per-human-user field on the general endpoint) | Both: raw tokens *and* Anthropic-computed USD cost | Poll `1d` buckets once/hour is plenty (5-min data lag, revisions possible); never need more than once/minute even for near-real-time — cap page size at 31 `1d` buckets or 168 `1h` / 1440 `1m` |
| **Admin API `usage_report/claude_code`** (§1.4) | Official API, per-user | **Per-user** (email or API key name), terminal type, customer_type | Both — includes `estimated_cost` per model per user | One request per day per `starting_at` date; 1-hour data lag — poll daily, backfill T-1 |
| **Claude Enterprise Analytics API** (§5.3) | Official API, billed/authoritative for usage-based Enterprise; usage-credit-only for seat-based | Per-user, per-product, RBAC group, Slack channel | Both, org- and per-user-level | Cost/usage: poll every few hours, always re-fetch the last ~30 days (late-arriving revisions); engagement: poll once/day after 10:00 UTC |
| **Claude Code OpenTelemetry** (§3) | Official, self-hosted collector required, real-time | Richest of all sources: session, user (email/account_uuid), model, agent/skill/plugin/MCP-server, terminal type, org | `cost_usd` computed and streamed **per API call** in `claude_code.api_request` | Push-based, not polled — stand up an OTLP collector; this is the only sub-minute-latency source |
| **Local JSONL transcripts** (§2) | Unofficial schema (files are real and officially inventoried, but line-level fields are community-reverse-engineered) | Session, project path (cwd), git branch — but **no org/user identity field beyond what's in the transcript itself** | Must compute — raw `usage` fields present per turn, no dollar figure; must apply your own price table (§6.7) and handle dedup + `<synthetic>` exclusion | File-watch (`inotify`/`fswatch`) on `~/.claude/projects/**/*.jsonl`, or poll mtimes every 30–60s; single-machine only, doesn't see other devices |
| **`stats-cache.json` / `history.jsonl`** (§2.4–2.5) | Unofficial schema, local-only | Local machine only | `stats-cache.json` may carry a precomputed `costUSD` per the task brief's expected shape, but this session could not confirm the field names — verify empirically first | Same as transcripts — local file poll, single machine |
| **Unofficial OAuth usage endpoint** (§4.3) | Unofficial, undocumented, **ToS-risky for non-Claude-Code use** (§4.6) | Whole-account only (five_hour/seven_day utilization %), no per-session breakdown | No dollar figure — utilization percentage only | Avoid for a commercial connector; if used at all, only as a passive read of Claude Code's *own* stored credential on the user's machine, never by asking a user to paste a token in |
| **claude.ai data export** (§4.7) | Official, but **content-only** — manual/on-demand, not an API | Per-conversation only | **None found** — no token counts or model names confirmed present | One-off import when a user explicitly requests it; not pollable (email-delivered ZIP); do not build cost features on this without first verifying the schema against a real export |
| **Compliance API** (§5.4) | Official API, per-event | Full actor identity (email, user_id, IP) | None — audit/content only, not cost | Not a cost source; only relevant if clai adds an audit/attribution feature layered on top of another cost source |

**Recommended architecture:** for an **individual/Pro/Max** user, local JSONL + `stats-cache.json` (§2) is the only option (no Admin API access) — accept the dedup/pricing-table burden and clearly label figures as estimates, matching Anthropic's own `/usage` disclaimer language. For an **API/Console org**, the Admin API (§1) is authoritative and should be the primary source, with OpenTelemetry (§3) layered in only if the org wants sub-hour granularity or richer per-tool/per-skill attribution than the Admin API exposes. For an **Enterprise org**, the connector must detect org type and switch to the Analytics API (§5.3) — a Console Admin API key will not work there, and vice versa; this is the single most important branch in the whole integration, since guessing wrong produces silent 403s or an empty-looking (wrong-endpoint) dataset rather than an obvious error.
