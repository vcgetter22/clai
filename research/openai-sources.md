# OpenAI / ChatGPT / Codex Usage & Cost Data — Engineering Reference for `clai`

Research date: **2026-09-03**. Compiled from official docs (`developers.openai.com`, `learn.chatgpt.com`, `help.openai.com`, `platform.openai.com`), the live `openai/codex` GitHub source (main branch, Rust crates `codex-rs/{login,protocol,history,rollout}`), Microsoft Learn, and corroborating secondary sources (marked). Every claim below is tagged with a source. Claims that could not be independently verified, or where sources actively conflicted, are marked **UNVERIFIED**.

**Read this before you build anything on this doc:**

1. `platform.openai.com`, `openai.com/api/pricing`, `openai.com/chatgpt/pricing`, and most of `help.openai.com` returned HTTP 403 to automated fetches in this session (Cloudflare bot protection). `developers.openai.com`, `learn.chatgpt.com`, and GitHub raw content were fetchable and are the primary sources here. Anything sourced only from `developers.openai.com`/`learn.chatgpt.com` via the fetch tool's AI-summarization layer should be treated as **high-confidence but not a verbatim byte-for-byte capture** — re-fetch the live page before hard-coding field names into production parsers.
2. The model lineup has moved well past this researcher's own training knowledge (cutoff January 2026). As of this research date, OpenAI is shipping a **gpt-5.1 → gpt-5.6** dated-family lineage (with per-family sub-tiers, e.g. "Sol/Terra/Luna" for gpt-5.6) that did not exist at training time. Pricing tables in §6 for these newer families come from a single automated fetch of the official pricing page and are **cross-validated for internal consistency** (cache-discount ratios match known per-family patterns) but should be treated as a snapshot to re-verify, not a stable contract.
3. **OpenAI made ChatGPT text chat unlimited on every plan (including Free) on 2026-08-06.** This obsoletes a large fraction of the "message caps" figures that still circulate in search results and blog posts as of this research date. See §2.
4. Three *different* things are all called "Admin key" or "Admin API key" across OpenAI's product surface, and connector code must not conflate them: (a) the **API Platform organization Admin key** (§1, `platform.openai.com/settings/organization/admin-keys`, org-owner-only, used for Usage/Costs/org-mapping endpoints), (b) the **ChatGPT workspace Admin key** (§3, generated in the ChatGPT Enterprise/Business Admin Console, used for the Compliance API and Codex Analytics API), and (c) a **SCIM bearer token** (§3, also from the ChatGPT admin console, identity-provisioning only). They live on different hosts (`api.openai.com` vs `api.chatgpt.com` vs `api.openai.com/scim/v2`) and are not interchangeable.

---

## 1. Usage API & Costs API (Admin key, API Platform)

**Base URL:** `https://api.openai.com/v1`
**Auth:** `Authorization: Bearer <ADMIN_KEY>` — an **organization Admin API key**, distinct from project API keys (`sk-proj-...`). Only **API Platform organization owners** can create one, from `platform.openai.com/settings/organization/admin-keys` → "Create new admin key" → select permission scopes for the integration. [help.openai.com/en/articles/20001407](https://help.openai.com/en/articles/20001407-managing-admin-keys-in-the-credentials-tab), [developers.openai.com/api/docs/guides/admin-apis](https://developers.openai.com/api/docs/guides/admin-apis)

SDK support: Node ≥6.36.0 (`adminAPIKey`), Python ≥2.34.0 (`admin_api_key`), Go ≥3.34.0 (`WithAdminAPIKey()`), Ruby ≥0.61.0 (`admin_api_key`), Java ≥4.34.0 (`adminApiKey()`). [developers.openai.com/api/docs/guides/admin-apis](https://developers.openai.com/api/docs/guides/admin-apis)

### 1.1 Common envelope (all `/organization/usage/*` and `/organization/costs`)

All endpoints return a paginated list of time buckets:

```json
{
  "object": "page",
  "data": [
    {
      "object": "bucket",
      "start_time": 1735689600,
      "end_time": 1735776000,
      "results": [ { "...": "endpoint-specific result object, see below" } ]
    }
  ],
  "has_more": false,
  "next_page": null
}
```

Pagination: pass the previous response's `next_page` as the `page` query parameter; loop while `has_more` is `true`. [developers.openai.com/cookbook/examples/completions_usage_api](https://developers.openai.com/cookbook/examples/completions_usage_api)

### 1.2 GET `/organization/usage/completions`

| Param | Type | Required | Notes |
|---|---|---|---|
| `start_time` | integer (unix s) | **yes** | inclusive |
| `end_time` | integer (unix s) | no | exclusive |
| `bucket_width` | `"1m"` \| `"1h"` \| `"1d"` | no | default `"1d"` |
| `limit` | integer | no | buckets to return; default/max varies by `bucket_width`: `1d`→7 (max 31), `1h`→24 (max 168), `1m`→60 (max 1440) — **UNVERIFIED exact max values**, but the tiering pattern (finer bucket ⇒ smaller max lookback per request) is corroborated |
| `page` | string | no | cursor from `next_page` |
| `project_ids[]` | string[] | no | filter |
| `user_ids[]` | string[] | no | filter |
| `api_key_ids[]` | string[] | no | filter |
| `models[]` | string[] | no | filter |
| `batch` | boolean | no | omit = both batch and non-batch |
| `group_by[]` | array of `project_id`\|`user_id`\|`api_key_id`\|`model`\|`batch`\|`service_tier` | no | any combination; ungrouped dimensions return `null` |

Source: [developers.openai.com/api/reference/typescript/.../usage/methods/completions](https://developers.openai.com/api/reference/typescript/resources/admin/subresources/organization/subresources/usage/methods/completions), [developers.openai.com/cookbook/examples/completions_usage_api](https://developers.openai.com/cookbook/examples/completions_usage_api)

**Result object** — the stable, widely-documented field set (matches the cookbook example and most third-party guides):

```json
{
  "object": "organization.usage.completions.result",
  "input_tokens": 1200,
  "input_cached_tokens": 300,
  "output_tokens": 450,
  "input_audio_tokens": 0,
  "output_audio_tokens": 0,
  "num_model_requests": 12,
  "project_id": "proj_abc",
  "user_id": "user_abc",
  "api_key_id": "key_abc",
  "model": "gpt-4o-2024-08-06",
  "batch": false,
  "service_tier": "default"
}
```

**UNVERIFIED — possible newer/finer breakdown:** one fetch of the current API reference returned a substantially richer field list on the same result object: `input_cache_write_tokens`, `input_uncached_tokens`, `input_text_tokens`, `output_text_tokens`, `input_cached_text_tokens`, `input_image_tokens`, `input_cached_image_tokens`, `output_image_tokens` (in addition to all fields above). This did **not** appear in the cookbook page or in most secondary sources, so it may be (a) a genuine recent per-modality breakdown addition, or (b) an artifact of the fetch tool's summarization. **Action for connector code: log every raw key actually present in your own API responses and treat this field list as an open/growing set, not a closed schema.** Source: [developers.openai.com/api/reference/typescript/.../methods/completions](https://developers.openai.com/api/reference/typescript/resources/admin/subresources/organization/subresources/usage/methods/completions)

**Reasoning tokens:** the completions-usage result has **no separate `reasoning_tokens` field**. Reasoning tokens are billed at the output-token rate and are folded into `output_tokens` (confirmed for the per-call Chat Completions/Responses `usage` object in §7; the org Usage API aggregates from the same billing ledger, so the same inclusion almost certainly holds — **inferred, not explicitly documented for this specific endpoint**). [community.openai.com discussion, corroborated](https://community.openai.com/t/how-are-reasoning-tokens-cached-tokens-input-tokens-and-output-tokens-counted-for-billing/1386849)

**Cached-token pricing implication:** `input_cached_tokens` is a raw count with no dollar figure attached — the Usage API never tells you what caching *saved* you. A connector must multiply by the model's cached-input rate from §6 itself; the Costs API (§1.9) gives you the actual billed dollars but does not break "cached vs. uncached" out as separate line items — it only distinguishes by the `line_item` string (e.g., `"gpt-4o-2024-08-06, input"` vs `"gpt-4o-2024-08-06, cached_input"` vs `"gpt-4o-2024-08-06, output"` — inferred format from the `line_item` grouping option, exact string grammar **UNVERIFIED**).

**Data latency:** community reports describe "usually a few minutes" between an API call and its appearance in Usage API results; this is **not a documented SLA**. [community.openai.com threads, secondary](https://community.openai.com/t/api-usage-dashboard-not-updating-updating-slowly/692234)

### 1.3 GET `/organization/usage/embeddings`

Params: same shape as completions minus `batch`; `group_by[]` ∈ `project_id`\|`user_id`\|`api_key_id`\|`model`.

Result: `object: "organization.usage.embeddings.result"`, `input_tokens`, `num_model_requests`, `project_id`, `user_id`, `api_key_id`, `model`. [developers.openai.com/api/reference/.../methods/embeddings](https://developers.openai.com/api/reference/typescript/resources/admin/subresources/organization/subresources/usage/methods/embeddings)

### 1.4 GET `/organization/usage/moderations`

Same param shape as embeddings. Result: `object: "organization.usage.moderations.result"`, `input_tokens`, `num_model_requests`, `project_id`, `user_id`, `api_key_id`, `model`. [developers.openai.com/api/reference/.../methods/moderations](https://developers.openai.com/api/reference/typescript/resources/admin/subresources/organization/subresources/usage/methods/moderations)

### 1.5 GET `/organization/usage/images`

Extra params: `sizes[]` (e.g. `256x256`, `512x512`, `1024x1024`, `1792x1792`, `1024x1792`), `sources[]` (`image.generation`\|`image.edit`\|`image.variation`); `group_by[]` also accepts `size`, `source`.

Result: `object: "organization.usage.images.result"`, `images` (count), `num_model_requests`, `size`, `source`, `project_id`, `user_id`, `api_key_id`, `model`. [developers.openai.com/api/reference/.../methods/images](https://developers.openai.com/api/reference/go/resources/admin/subresources/organization/subresources/usage/methods/images)

### 1.6 GET `/organization/usage/audio_speeches`

Same param shape as embeddings. Result: `object: "organization.usage.audio_speeches.result"`, `characters` (count), `num_model_requests`, `project_id`, `user_id`, `api_key_id`, `model`. [developers.openai.com/api/reference/.../methods/audio_speeches](https://developers.openai.com/api/reference/typescript/resources/admin/subresources/organization/subresources/usage/methods/audio_speeches)

### 1.7 GET `/organization/usage/audio_transcriptions`

Same param shape as embeddings. Result: `object: "organization.usage.audio_transcriptions.result"`, `seconds` (duration transcribed), `num_model_requests`, `project_id`, `user_id`, `api_key_id`, `model`. [developers.openai.com/api/reference/.../methods/audio_transcriptions](https://developers.openai.com/api/reference/typescript/resources/admin/subresources/organization/subresources/usage/methods/audio_transcriptions)

### 1.8 GET `/organization/usage/vector_stores` and `/organization/usage/code_interpreter_sessions`

`vector_stores`: params `start_time`, `end_time`, `bucket_width`, `limit`, `page`, `project_ids[]`, `group_by[]` (only `project_id` supported). Result: `object: "organization.usage.vector_stores.result"`, `usage_bytes`, `project_id`.

`code_interpreter_sessions`: identical param shape. Result: `object: "organization.usage.code_interpreter_sessions.result"`, `num_sessions`, `project_id`.

Sources: [developers.openai.com/api/reference/.../methods/vector_stores](https://developers.openai.com/api/reference/typescript/resources/admin/subresources/organization/subresources/usage/methods/vector_stores), [.../methods/code_interpreter_sessions](https://developers.openai.com/api/reference/typescript/resources/admin/subresources/organization/subresources/usage/methods/code_interpreter_sessions)

### 1.9 GET `/organization/costs`

| Param | Type | Required | Notes |
|---|---|---|---|
| `start_time` | integer (unix s) | **yes** | inclusive |
| `end_time` | integer (unix s) | no | exclusive |
| `bucket_width` | `"1d"` | no | **only `1d` is supported today** |
| `limit` | integer | no | 1–180, default 7 |
| `page` | string | no | cursor |
| `project_ids[]` | string[] | no | filter |
| `api_key_ids[]` | string[] | no | filter — **UNVERIFIED whether GA or recently added**; not in the task's original assumption but corroborated by two independent fetches |
| `line_items[]` | string[] | no | filter to exact line-item name strings |
| `group_by[]` | array of `project_id`\|`line_item`\|`api_key_id` | no | |

Result object:

```json
{
  "object": "organization.costs.result",
  "amount": { "value": 0.06, "currency": "usd" },
  "line_item": "gpt-4o-2024-08-06, input",
  "project_id": "proj_abc",
  "api_key_id": null
}
```

`amount.currency` is lowercase ISO-4217 (e.g. `"usd"`). The Costs API is explicitly positioned to **reconcile with the invoice** — i.e., it's ground-truth billed dollars, not an estimate. Sources: [developers.openai.com/api/reference/.../methods/costs](https://developers.openai.com/api/reference/resources/admin/subresources/organization/subresources/usage/methods/costs), [developers.openai.com/cookbook/examples/completions_usage_api](https://developers.openai.com/cookbook/examples/completions_usage_api), [community.openai.com/t/v1-organization-costs-returning-404](https://community.openai.com/t/v1-organization-costs-returning-404/1365618)

**No `user_id` on the Costs API** — cost data is only attributable down to project/API-key/line-item, never per-ChatGPT-seat-equivalent user. For per-user *dollar* attribution you must compute it yourself from the Usage API's token counts (§1.2) using §6 pricing.

### 1.10 Admin organization-mapping endpoints

| Endpoint | Method | Purpose | Key response fields |
|---|---|---|---|
| `/organization/projects` | GET | list projects | `id`, `object="organization.project"`, `name`, `created_at`, `archived_at`, `status` (`active`\|`archived`); params `after`, `include_archived`, `limit` (1–100, default 20). **UNVERIFIED extras** seen once: `external_key_id`, `residency` |
| `/organization/projects/{project_id}/api_keys` | GET | list a project's API keys | `id`, `name`, `redacted_value`, `created_at`, `last_used_at`, `owner` |
| `/organization/projects/{project_id}/users` | GET | list a project's members | role-scoped membership (owner/member) — **UNVERIFIED exact field list**, not independently confirmed this session |
| `/organization/users` | GET | list org-level members | `id`, `object="organization.user"`, `name`, `email`, `role` (`owner`\|`reader`), `added_at`, `api_key_last_used_at`; params `after`, `emails[]`, `limit` (1–100, default 20). **UNVERIFIED extras** seen once: `created`, `developer_persona`, `is_default`, `is_scale_tier_authorized_purchaser`, `is_scim_managed`, `is_service_account`, `technical_level` |
| `/organization/admin_api_keys` | GET, POST | manage org Admin keys | POST body: `name` (required), `expires_in_seconds` (1–31,536,000, omit = never expires). Response: `id`, `name`, `value` (shown once, at creation only), `redacted_value`, `created_at`, `expires_at`, `last_used_at`, `owner{type,id,name,role}` |
| `/organization/audit_logs` | GET | audit trail | Params: `actor_emails[]`, `actor_ids[]`, `resource_ids[]`, `project_ids[]`, `event_types[]` (e.g. `api_key.created`, `project.archived`), `effective_at` (unix-second range filter), `limit` (1–100, default 20), `after`, `before`. Entry fields: `id`, `type`, `effective_at`, `actor` (session/IP/geo/UA/JA3-JA4 for human sessions, or key-tracking-ID + owner-type for API-key actors), `project`, plus a **type-specific nested object keyed by the event type** (e.g. a field literally named `project.created` on a `project.created` event) carrying that event's details |

Sources: [community.openai.com Project schema thread](https://community.openai.com/t/undocumented-api-change-on-project-schema/1368115), [developers.openai.com/api/reference/.../admin_api_keys/methods/create](https://developers.openai.com/api/reference/typescript/resources/admin/subresources/organization/subresources/admin_api_keys/methods/create), [developers.openai.com/api/reference/.../audit_logs/methods/list](https://developers.openai.com/api/reference/typescript/resources/admin/subresources/organization/subresources/audit_logs/methods/list), [help.openai.com/en/articles/9687866](https://help.openai.com/en/articles/9687866-admin-and-audit-logs-api-for-the-api-platform)

### Connector implications — §1 (Admin Usage/Costs API)

- **Reliability tier:** Official API, Tier 1 — the single best source of org-wide, multi-dimensional token *and* dollar data. Requires the customer to generate and hand over an org Admin key (org-owner action).
- **Attribution fields:** `project_id`, `user_id`, `api_key_id`, `model`, `service_tier`, `batch` on the Usage API (full attribution); Costs API drops `user_id` and `model` (model is embedded inside the `line_item` string only).
- **Cost availability:** Usage API = tokens only, you compute $ yourself (§6, watch for stale prices and cache/reasoning nuances); Costs API = actual billed $, reconciles with the invoice, but coarser dimensionality and `1d` bucket width only.
- **Minimal polling strategy:** Poll `/organization/costs` once daily (grouped by `project_id`+`line_item`) with a 24–48h trailing buffer to avoid partial-day data. Poll `/organization/usage/*` per-project/per-user at `1h` or `1d` granularity for dashboards; use `1m` only for short-lived debugging, not steady-state polling (small `limit` ceiling). Cache `/organization/projects`, `/organization/users`, and `/organization/projects/{id}/api_keys` on a slow cadence (e.g., daily) and join locally — they change rarely and are needed only as an ID→name lookup table.

---

## 2. ChatGPT Plans, Codex Usage Limits, and `~/.codex/auth.json`

### 2.1 Plan pricing (as of 2026-09-03)

| Plan | Price | Notes |
|---|---|---|
| Free | $0 | |
| Go | $8/mo | Budget tier; rolled out to ~170+ countries incl. EU/EEA/Switzerland (since Jan 2026) [openai.com/index/introducing-chatgpt-go](https://openai.com/index/introducing-chatgpt-go/) |
| Plus | $20/mo | |
| Pro | $100/mo ("Pro Codex" — 5× Codex limits) **or** $200/mo ("Pro"/"Pro Max" — 20× Codex limits, retains top Deep Research/GPT-5-Pro quotas) | Split into two tiers since **2026-04-09** — **UNVERIFIED exact tier naming**, numeric price points corroborated by multiple sources |
| Business (renamed from **Team** on **2025-08-29**, name-change only) | **$20/seat/mo annual**, **$25/seat/mo monthly** (cut from $25/$30 effective **2026-04-02**) | Minimum 2 seats (1 Standard + 1 Premium also qualifies). Includes unlimited GPT-5-family access. [help.openai.com/en/articles/12111915](https://help.openai.com/en/articles/12111915-chatgpt-business-rename-faq) |
| Enterprise | Custom / contact sales | |
| Edu | Custom | Internal plan taxonomy further splits this into `edu`, `edu_plus`, `edu_pro` — see §2.4 |

Sources: multiple secondary aggregators cross-corroborated; Business rename/pricing details confirmed via [help.openai.com/en/articles/12111915-chatgpt-business-rename-faq](https://help.openai.com/en/articles/12111915-chatgpt-business-rename-faq).

**Major policy change — 2026-08-06:** OpenAI made **text chat unlimited on every ChatGPT plan, including Free** (subject to abuse guardrails). This makes most "N messages per M hours" figures still circulating online (for plain chat) **stale**. The caps that still meaningfully apply post-change are: **"Thinking"/reasoning-mode messages, image generation, file uploads, voice, Deep Research, and Codex.** Any "message cap" signal a connector surfaces to users should be scoped to these specific features, not generic chat. **UNVERIFIED / volatile** — treat all specific numbers below as a snapshot, not a contract:

| Plan | Approx. cap (post 2026-08-06, where still applicable) |
|---|---|
| Free | ~10 "Thinking"/flagship-model messages per 5h before fallback to a mini model |
| Go | Thinking mode enabled via "+" menu, ~10 msgs/5h |
| Plus | ~160 GPT-5.x messages/3h (figure may predate the Aug-6 change and now only apply to Thinking mode), ~3,000 Thinking messages/week, ~80 uploads/3h |
| Pro | "Unlimited, subject to abuse guardrails" — no published hard numeric cap |

### 2.2 Codex usage limits inside ChatGPT plans

Codex (CLI, IDE extension, and cloud tasks together) is metered by **two independent rolling quotas**, token/credit-based rather than fixed-message-count:

1. **5-hour rolling window** — not clock-aligned; starts rolling from your first use in the period. Shared across local CLI, IDE extension, and cloud tasks.
2. **7-day rolling weekly window** — a sustained-usage cap layered on top of the 5-hour window.

[inventivehq.com/blog/codex-cli-usage-rate-limits](https://inventivehq.com/blog/codex-cli-usage-rate-limits) (secondary, cross-corroborated by multiple similar guides)

Credit-rate table (from `learn.chatgpt.com/docs/pricing`, via automated fetch — **UNVERIFIED, re-check live**):

| Model | Input credits/1M tok | Cached input | Output credits/1M tok |
|---|---|---|---|
| GPT-5.6 Sol | 100 | 10 | 500 |
| GPT-5.6 Terra | 50 | 5 | 300 |
| GPT-5.6 Luna | 5 | 0.5 | 30 |

"GPT-5.6 usage averages 5–30 credits per message." Plan multipliers found: Plus is the baseline 5h-window allowance; Pro-5× and Pro-20× scale that baseline ×5 and ×20 respectively; Business ≈ Plus baseline per seat. Exact weekly-window numbers were **not** surfaced by any source this session. [learn.chatgpt.com/docs/pricing](https://learn.chatgpt.com/docs/pricing)

### 2.3 How Codex reports remaining usage (four ways, in order of connector-friendliness)

1. **Codex CLI `app-server` JSON-RPC (best for a connector).** Launch `codex -s read-only -a never app-server`, speak JSON-RPC over stdin/stdout: `initialize` → `account/read` → `account/rateLimits/read`. Returns structured primary+secondary usage windows with reset timestamps and a credits snapshot (`balance`, `hasCredits`, `unlimited`). This is the *only* fully machine-readable, officially-shipped local interface. [github.com/steipete/CodexBar/blob/main/docs/codex.md](https://github.com/steipete/CodexBar/blob/main/docs/codex.md)
2. **`/status` inside the interactive Codex CLI TUI.** Human-readable text only: a `Credits:` line, a `5h limit` line (percent + reset text), a `Weekly limit` line (percent + reset text). Must be screen/PTY-scraped — fragile across CLI versions, and launching bare `codex` can trigger interactive auth / open a browser tab, so treat this as a manual-diagnostic path, not an automation target. [github.com/steipete/CodexBar/blob/main/docs/codex.md](https://github.com/steipete/CodexBar/blob/main/docs/codex.md)
3. **Rollout JSONL session logs.** `event_msg` records with `payload.type == "token_count"` carry both cumulative token totals and a full `rate_limits` snapshot. See §5.4 for the exact structure — this is the richest *offline* signal (no network call needed) but only reflects the local machine's own sessions.
4. **UNOFFICIAL: `GET https://chatgpt.com/backend-api/wham/usage`** with `Authorization: Bearer <ChatGPT access token>` (the `tokens.access_token` from `auth.json`, §2.4). Companion endpoint `GET https://chatgpt.com/backend-api/wham/rate-limit-reset-credits` for reset-credit inventory. Response shape (from tool source, not an OpenAI spec): `rate_limit.primary_window` / `secondary_window` map to the session(5h)/weekly lanes; `additional_rate_limits[]` carries model-specific limits (e.g., a "GPT-5.3-Codex-Spark" quota) as named extra windows. This is what **CodexBar**, **Codex-Usage**, and similar community tools call. There is also a **human dashboard** at `https://chatgpt.com/codex/settings/usage` that these tools additionally screen-scrape (via a hidden WebView + imported browser cookies) for extras the JSON endpoint doesn't expose (code-review-remaining %, credit purchase history, a Recharts usage-breakdown chart). **Mark this entire path UNOFFICIAL/undocumented — no SLA, can change or break without notice, and scraping the dashboard requires handling the user's ChatGPT session cookies, which is a materially higher-risk integration than the other three options.** Sources: [github.com/steipete/CodexBar/blob/main/docs/codex.md](https://github.com/steipete/CodexBar/blob/main/docs/codex.md), [github.com/MacSteini/Codex-Usage](https://github.com/openai/codex/issues/10869) (issue thread confirming the endpoint), [github.com/openai/codex/issues/10869](https://github.com/openai/codex/issues/10869)

### 2.4 `~/.codex/auth.json` — verified exact structure

Pulled directly from the live `openai/codex` Rust source (`codex-rs/login/src/auth/storage.rs`, struct `AuthDotJson`, and `codex-rs/login/src/token_data.rs`, struct `TokenData`) — this is ground truth, not a docs paraphrase:

```json
{
  "auth_mode": "chatgpt",
  "OPENAI_API_KEY": null,
  "tokens": {
    "id_token": "<JWT>",
    "access_token": "<JWT>",
    "refresh_token": "rt_...",
    "account_id": "acct_..."
  },
  "last_refresh": "2026-09-03T12:00:00Z",
  "agent_identity": null,
  "personal_access_token": null,
  "bedrock_api_key": null,
  "bedrock_access_keys": null
}
```

Field notes:
- `auth_mode` — wire values (verified from the `AuthMode` enum's serde attributes): `"apikey"`, `"chatgpt"`, `"chatgptAuthTokens"`, `"headers"`, `"agentIdentity"`, `"personalAccessToken"`, `"bedrockApiKey"`, `"bedrockAccessKeys"`. The last two are new: Codex can now authenticate through a customer's **own AWS Bedrock account** rather than OpenAI directly — a third billing path entirely outside OpenAI's own metering (flag and skip in an OpenAI-focused connector).
- `OPENAI_API_KEY` — present (non-null) only when the user ran `codex login --with-api-key`; this key is billed via standard OpenAI API metering (§6), **not** counted against the 5h/weekly ChatGPT Codex quotas.
- `tokens.id_token` is serialized as the raw JWT string. Decoded, its claims include `email`, `chatgpt_plan_type`, `chatgpt_user_id`, `chatgpt_account_id`, `chatgpt_account_is_fedramp`.
- `last_refresh` is an **ISO-8601 UTC datetime string**, not a Unix timestamp.
- `agent_identity`, `personal_access_token`, `bedrock_api_key`, `bedrock_access_keys` are newer fields not mentioned in most public write-ups of this file — present for non-interactive/CI and Bedrock auth flows.

Source: [github.com/openai/codex — codex-rs/login/src/auth/storage.rs](https://github.com/openai/codex/blob/main/codex-rs/login/src/auth/storage.rs), [codex-rs/login/src/token_data.rs](https://github.com/openai/codex/blob/main/codex-rs/login/src/token_data.rs) (fetched directly from GitHub raw content, 2026-09-03).

**Plan-type raw values** (verified from `codex-rs/protocol/src/auth.rs`, enum `KnownPlan::raw_value()`): `free`, `go`, `plus`, `pro`, `prolite`, `team` (legacy, pre-rename), `self_serve_business_prolite`, `self_serve_business_usage_based`, `business`, `ent26`, `enterprise_cbp_automation`, `enterprise_cbp_usage_based`, `enterprise` (alias `hc`), `edu` (alias `education`), `edu_plus`, `edu_pro`. This is the authoritative, current plan taxonomy used internally by Codex — more granular than the public-facing plan names in §2.1. Source: [github.com/openai/codex — codex-rs/protocol/src/auth.rs](https://github.com/openai/codex/blob/main/codex-rs/protocol/src/auth.rs)

### 2.5 Billing-mode summary

| `auth_mode` | Billing path | Counts against Codex 5h/weekly quota? |
|---|---|---|
| `apikey` (`OPENAI_API_KEY` set) | Standard OpenAI API metering, §6 rates | No |
| `chatgpt` / `chatgptAuthTokens` / `personalAccessToken` / `agentIdentity` | ChatGPT plan's included Codex allotment, routed through OpenAI's backend | Yes |
| `bedrockApiKey` / `bedrockAccessKeys` | Customer's own AWS Bedrock account | No (out of scope for OpenAI-native cost tracking) |

### Connector implications — §2 (Plans / Codex limits / auth.json)

- **Reliability tier:** Mixed. Plan pricing/limits pages = public marketing docs (no versioning, changes without notice — confirmed by the Aug-6 policy shift). `auth.json` + rollout logs = local files, Tier "high reliability, single machine." `app-server` JSON-RPC = local official interface, the best machine-readable option. `wham/usage` HTTP endpoint = unofficial, Tier "fragile."
- **Attribution fields:** `auth.json` → `account_id`, decoded-JWT `email`, `chatgpt_plan_type` — good single-user identity, no org-wide roster (that's §3).
- **Cost availability:** Codex-via-ChatGPT-plan is **not** billed per token — there is no dollar figure to fetch; a connector must either (a) compute an equivalent-$-if-it-were-API-billed estimate from token counts × §6 rates, or (b) report consumption as "% of 5h/weekly quota," which is the more honest signal since no charge actually occurs per call. Codex-via-API-key is billed exactly per §6 and reconciles with §1's Costs API.
- **Minimal polling strategy:** Prefer the `codex app-server` JSON-RPC `account/rateLimits/read`, called on-demand around each Codex invocation, over PTY-scraping `/status` or hitting the unofficial `wham/usage` endpoint. For continuous local monitoring, tail newly-appended lines in the active `~/.codex/sessions/**/rollout-*.jsonl` file rather than re-parsing whole files or polling any network endpoint.

---

## 3. ChatGPT Business/Enterprise Admin Analytics, Compliance API, SCIM

Five distinct surfaces, gated by plan:

### 3.1 Workspace analytics (interactive dashboard)

- **Business:** a "Workspace analytics" dashboard (replaced the older "User analytics") gives a workspace-level adoption + Codex-usage view. **Business has no data/CSV export at all** — this is an explicit, confirmed Business-tier limitation. [help.openai.com FAQ, secondary-corroborated](https://help.openai.com/en/articles/8542115-chatgpt-business-general-faq)
- **Enterprise/Edu:** admins/owners/analytics-viewers get **on-demand CSV export for Users, GPTs, and Projects**, selectable by week or month (no custom date ranges). Lives in the **Global Admin Console**, which unifies ChatGPT + Codex credit usage in one place with breakdowns by user/product/model. Dashboard URL pattern: `https://chatgpt.com/admin/usage`. Sources: [worklytics.co/blog/how-to-export-analyze-chatgpt-enterprise-usage-data](https://www.worklytics.co/blog/how-to-export-analyze-chatgpt-enterprise-usage-data), [learn.chatgpt.com/docs/enterprise/governance](https://learn.chatgpt.com/docs/enterprise/governance)

### 3.2 Codex (Enterprise) Analytics API

Purpose (verified via two independent `learn.chatgpt.com` pages): "aggregated Codex usage and activity metrics for a ChatGPT workspace," for automated recurring reports and BI joins — explicitly **not** for raw audit records (use the Compliance API, §3.3, for that).

- **Auth:** a **Platform organization API key** whose organization matches the workspace's linked organization — this is yet a *third* key type (see the header note at the top of this document).
- **Endpoint (UNVERIFIED exact path):** one automated search summary produced `GET https://api.chatgpt.com/v1/analytics/codex/workspaces/{workspace_id}/usage`. The authoritative, current reference lives behind an **authenticated interactive API-reference UI** at `https://chatgpt.com/public/admin/api-reference#tag/Codex%20Enterprise%20Analytics`, which could not be crawled without a live session — **treat the exact path/params/response schema as unverified until you can load that page with a real account.**
- **Endpoint families described (not exact paths):** (a) daily/weekly UTC-aligned buckets of threads, turns, credits, and per-client-surface breakdown; (b) threads/turns by surface (CLI vs. IDE vs. cloud) for adoption signals; (c) PR-review throughput and issue classification by priority.

Sources: [learn.chatgpt.com/docs/enterprise/analytics-api](https://learn.chatgpt.com/docs/enterprise/analytics-api), [learn.chatgpt.com/docs/enterprise/admin-setup](https://learn.chatgpt.com/docs/enterprise/admin-setup), [codex.danielvaughan.com/.../codex-enterprise-analytics-compliance-apis-governance-dashboards](https://codex.danielvaughan.com/2026/05/11/codex-enterprise-analytics-compliance-apis-governance-dashboards/) (secondary)

### 3.3 Compliance API

- **Base URL (confirmed working path fragment, from a live community bug report):** `https://api.chatgpt.com/v1/compliance/workspaces/{workspace_id}/conversations` — `GET`, `Authorization: Bearer <workspace Admin key>`, params `limit`, `after`; response `{ data: [...], has_more: bool, last_id: string }`. [community.openai.com/t/governance-apis-for-chatgpt-enterprise/1139692](https://community.openai.com/t/governance-apis-for-chatgpt-enterprise/1139692)
- **Other endpoints (structure confirmed generally, per-field schema NOT independently verified this session):** `/users`, `/conversations`, `/memories`, `/gpts`, `/projects`, and message-level detail nested under conversations. "The API provides a record of time-stamped interactions, including conversations, uploaded files, workspace GPT configuration and metadata, memories, and workspace users." **UNVERIFIED** whether message objects expose `model_slug` directly (plausible given ChatGPT export's own schema uses that field name, §4, but not confirmed for this API).
- **Auth/permissions:** a **workspace-scoped Admin key**, created by a workspace owner or admin (Settings → Security/Credentials → Admin keys), with per-resource grantable scopes. "**Only a workspace owner** can grant broad compliance access or the Conversation-messages permission" — i.e., message-body access is a specially gated, more sensitive scope than the rest of the API.
- **Retention/latency:** now branded the "**OpenAI Compliance Logs Platform**" — exports as **immutable, time-windowed JSONL log files** with **minutes-level latency** (per one secondary source — directionally solid, exact SLA **UNVERIFIED**). A **30-day retention window** applies to captured conversation content, including ephemeral/temporary chats, specifically for this compliance-capture purpose (separate from whatever retention applies to the user-facing chat history itself).
- **Available on:** ChatGPT Enterprise, Edu, and "ChatGPT for Teachers" — **not** Business.

Sources: [help.openai.com/en/articles/9261474](https://help.openai.com/en/articles/9261474-openai-compliance-platform-for-enterprise-and-edu-customers), [help.openai.com/en/articles/11327494-compliance-api-vs-user-analytics-in-chatgpt-enterpriseedu](https://help.openai.com/en/articles/11327494-compliance-api-vs-user-analytics-in-chatgpt-enterpriseedu), [community.openai.com/t/governance-apis-for-chatgpt-enterprise/1139692](https://community.openai.com/t/governance-apis-for-chatgpt-enterprise/1139692)

### 3.4 SCIM (identity/roster provisioning, not usage data)

- **Base URL:** `https://api.openai.com/scim/v2` (note: `api.openai.com`, not `api.chatgpt.com`). Confirmed endpoint: `/Users`; a `/Groups` endpoint is implied by the SCIM 2.0 spec but **not independently confirmed** this session.
- **Auth:** a static bearer token generated in the Admin Console (Settings → Security → SCIM Provisioning).
- **Requirements:** at least one verified domain; supports Okta Workforce, Microsoft Entra ID, Google Workspace, Ping, or custom SCIM.
- **Use for a connector:** resolving `user_id` → org identity / IdP group membership for roll-up reporting — it carries **no usage or cost data**.

Sources: [help.openai.com/en/articles/9627404](https://help.openai.com/en/articles/9627404-openai-chatgpt-scim-integration-faq), [learn.chatgpt.com/docs/enterprise/groups-and-provisioning](https://learn.chatgpt.com/docs/enterprise/groups-and-provisioning)

### 3.5 "Codex usage dashboard" in workspace settings

Human-facing page at `https://chatgpt.com/codex/settings/usage` (URL confirmed via CodexBar's own source docs, §2.3 item 4) — shows rate limits, credits remaining, code-review-remaining %, a usage-breakdown chart, and credit-purchase history. **No documented API backs this page**; it's the same page community tools optionally screen-scrape.

### Connector implications — §3 (Business/Enterprise admin surfaces)

- **Reliability tier:** CSV export & workspace-analytics dashboard = manual/export tier, **Enterprise/Edu only** (Business gets nothing programmatic). Codex Analytics API + Compliance API = official APIs but Enterprise/Edu-gated and thinly documented in public, static form (the canonical reference is an authenticated interactive Swagger-style page). SCIM = official, identity-only.
- **Attribution fields:** Compliance API offers the richest attribution in the entire OpenAI ecosystem (user + conversation + message-level), but it's compliance-purposed, not cost-purposed, and almost certainly carries no token/dollar fields. Codex Analytics API gives aggregated per-user/per-surface/per-model Codex activity. Workspace-analytics CSV gives per-user/per-GPT/per-project rollups.
- **Cost availability:** none of these four surfaces are documented to return dollar costs directly. Enterprise/Business billing lives in a separate "Billing" area of the Global Admin Console with no confirmed API of its own — combine with §1 (org-level Usage/Costs API) or §6 pricing math. ChatGPT-plan-consumed Codex credits are a wholly separate ledger from API-key spend (§2.5).
- **Minimal polling strategy:** **Business customers get no API at all** — a connector can only offer manual CSV-paste / dashboard-screenshot workflows, or fall back to per-machine local rollout-log scanning (§5). For Enterprise/Edu, poll the Codex Analytics API at its documented (daily/weekly) bucket granularity once you have live-account access to confirm the real schema; treat the Compliance API as an on-demand/audit pull rather than a polling target, given its purpose and likely stricter rate limits.

---

## 4. ChatGPT Data Export

Triggered from Settings → Data controls → Export data (or admin-initiated for Enterprise workspaces). A download link is emailed; the payload is a `.zip`.

### 4.1 Zip contents

| File | Contents |
|---|---|
| `conversations.json` | Full chat history — every message, every conversation, across the account's lifetime. Primary data source. |
| `chat.html` | Static, human-readable HTML rendering of the same history. |
| `message_feedback.json` | Thumbs-up/down feedback events. |
| `model_comparisons.json` | A/B model-comparison votes (often an empty array for most users). |
| `user.json` | Account profile — name, email, account creation date. |
| `shared_conversations.json` | Metadata for conversations the user published via a public share link. |
| *(images/uploads)* | Generated images (e.g. DALL·E/gpt-image outputs) and uploaded files may ship as separate asset files referenced by pointers inside message `content.parts`. **UNVERIFIED exact folder layout.** |

Sources: multiple cross-corroborating community guides, e.g. [ai-chat-importer.com/guides/chatgpt-export-format-explained](https://ai-chat-importer.com/guides/chatgpt-export-format-explained); official trigger point at [help.openai.com/en/articles/7260999](https://help.openai.com/en/articles/7260999-how-do-i-export-my-chatgpt-history-and-data).

### 4.2 `conversations.json` schema

An array of conversation objects. This schema has been stable for multiple years and is consistent across every source checked (including the task's own prior knowledge, itself a signal of stability):

```json
[
  {
    "title": "Example conversation",
    "create_time": 1735689600.123,
    "update_time": 1735689650.456,
    "mapping": {
      "node-uuid-1": {
        "id": "node-uuid-1",
        "message": {
          "id": "msg-uuid-1",
          "author": { "role": "assistant", "name": null, "metadata": {} },
          "create_time": 1735689601.0,
          "update_time": null,
          "content": {
            "content_type": "text",
            "parts": ["Hello! How can I help?"]
          },
          "status": "finished_successfully",
          "end_turn": true,
          "weight": 1.0,
          "metadata": {
            "model_slug": "gpt-5",
            "default_model_slug": "auto",
            "parent_id": "msg-uuid-0",
            "request_id": "req_abc123",
            "timestamp_": "absolute",
            "finish_details": { "type": "stop" }
          },
          "recipient": "all",
          "channel": null
        },
        "parent": "node-uuid-0",
        "children": ["node-uuid-2"]
      }
    },
    "moderation_results": [],
    "current_node": "node-uuid-2",
    "plugin_ids": null,
    "conversation_id": "conv-uuid",
    "conversation_template_id": null,
    "gizmo_id": null,
    "gizmo_type": null,
    "is_archived": false,
    "default_model_slug": "auto",
    "conversation_origin": null,
    "voice": null,
    "async_status": null,
    "id": "conv-uuid"
  }
]
```

`content_type` values observed across the product's history: `text`, `code`, `multimodal_text`, `thoughts` (reasoning/CoT summaries for o-series and "Thinking"/GPT-5-thinking models — **not** the full raw reasoning trace that was actually billed, just a user-facing summary), `reasoning_recap`, `tether_browsing_display`, `tether_quote`, `execution_output`, `user_editable_context`, `model_editable_context`. Treat this as an open set.

**No token counts anywhere in the export.** A connector must estimate using `tiktoken`:

| Encoding | Model families |
|---|---|
| `o200k_base` | gpt-4o family, gpt-4.1 family, gpt-5 family (incl. thinking/pro/codex variants), o1/o3/o4 family |
| `cl100k_base` | gpt-4, gpt-4-turbo, gpt-3.5-turbo, legacy `text-davinci-*`, `text-embedding-ada-002` |

Recommendation: maintain a `model_slug → encoding` lookup, defaulting unrecognized/future slugs to `o200k_base` (OpenAI's modern default), and re-verify periodically — new model families can introduce new encodings without warning.

`model_slug` values observed (open set, do not treat as exhaustive): `gpt-4`, `gpt-4o`, `gpt-4o-mini`, `gpt-5`, `gpt-5-thinking`, `gpt-5-pro`, `gpt-5-codex`, `o1`, `o3`, `o3-mini`, `o4-mini`, `auto`, `text-davinci-002-render-sha` (legacy GPT-3.5 slug — confirmed via a live OpenAI community bug thread, [community.openai.com/t/806632](https://community.openai.com/t/chatgpt-com-seems-to-be-using-text-davinci-002-render-sha-not-gpt-3-5-turbo-when-you-select-chatgpt-3-5-as-the-model/806632)), `text-davinci-002-plugins`, `gpt-4-plugins`, `gpt-4-browsing` (legacy). **UNVERIFIED:** whether the gpt-4.1 slug is literally `gpt-4-1` or `gpt-4.1` in real exports — log the actual observed string rather than assuming.

### Connector implications — §4 (Data export)

- **Reliability tier:** User-initiated export — no live polling possible; generation isn't instant and arrives via an emailed link.
- **Attribution fields:** single account only (the exporting user). For org-wide attribution, use §3 instead.
- **Cost availability:** none. 100% must-compute via `tiktoken` + §6 pricing, and even that is an **estimate** — hidden/full reasoning traces for thinking models are not reconstructable from the `thoughts` content type (which is a redacted summary, not the raw billed reasoning tokens), so token estimates from this file will systematically undercount reasoning-heavy conversations.
- **Minimal polling strategy:** not pollable. Best used as a periodic (e.g. monthly) backfill/reconciliation source, not the primary live data path.

---

## 5. Codex CLI Local Data (`~/.codex/`)

All of §5 below (except where marked) was pulled directly from the live `openai/codex` GitHub repository (`main` branch, `codex-rs/` Rust workspace) on 2026-09-03 — this is source-code ground truth, current as of this research date, and notably **more elaborate than the simple JSONL-only model many public write-ups describe.** The project has grown a multi-agent orchestration layer, an OS-keyring credential store option, Bedrock auth, and a SQLite-backed session index since most third-party documentation was written.

### 5.1 `$CODEX_HOME` (default `~/.codex/`) layout

| Path | Purpose |
|---|---|
| `config.toml` | User config (model, `approval_policy`, `sandbox_policy`, etc.). Project-level overrides are read from `.codex/config.toml` walked from the repo root down to the current working directory. |
| `auth.json` | See §2.4. |
| `sessions/YYYY/MM/DD/rollout-<timestamp>-<thread_id>[_<rollout_id>].jsonl` | Per-session transcript + telemetry. **Exact filename grammar, verified from source:** `rollout-` + `YYYY-MM-DDTHH-MM-SS` (colons replaced with hyphens) + `-` + thread UUID, with an optional `_<rollout_id>` suffix appended only for reverted/forked threads whose rollout id differs from the stable thread id. |
| `archived_sessions/` | Flat directory (no date subfolders) for archived/older sessions. |
| *(no confirmed path)* `history.jsonl` | Cross-session command/message history in older Codex versions — **UNVERIFIED for the current architecture**; the project has moved toward the rollout-file + SQLite-index model below, so this may be legacy/deprecated. Treat as optional. |
| *(no confirmed path)* `logs/` | App logs — plausible/standard for a Rust CLI, **not independently confirmed** in this session's source dive. |

**Compression:** inactive rollout files are transparently rewritten to `<name>.jsonl.zst` (Zstandard). A reader must transparently handle both the plain `.jsonl` and the `.jsonl.zst` sibling — the "canonical" logical filename always ends in `.jsonl` even when the bytes on disk are compressed. Source: `codex-rs/rollout/src/compression.rs` (`COMPRESSED_SUFFIX = ".zst"`).

**New in the current architecture:** a SQLite-backed index (`codex-rs/rollout/src/state_db.rs`, `session_index.rs`) sits alongside the JSONL files for fast thread listing/search. The JSONL remains the source of truth for full replay; SQLite is a derived index. **UNVERIFIED exact SQLite filename/location** — a connector should treat the JSONL files as authoritative and not depend on the SQLite schema.

Sources: [github.com/openai/codex — codex-rs/rollout/src/](https://github.com/openai/codex/tree/main/codex-rs/rollout/src), [codex-rs/rollout/src/rollout_file_name.rs](https://github.com/openai/codex/blob/main/codex-rs/rollout/src/rollout_file_name.rs), [codex-rs/rollout/src/compression.rs](https://github.com/openai/codex/blob/main/codex-rs/rollout/src/compression.rs)

### 5.2 Rollout JSONL record shape

Each line is one `RolloutLine`:

```json
{"timestamp": "2026-09-03T12:00:00.000Z", "ordinal": 42, "type": "<variant>", "payload": { "...": "..." }}
```

`type` is a snake_case serde tag. **Verified current variant set** (from `codex-rs/history/src/rollout_payload.rs`, enum `RolloutItemWire`): `session_meta`, `response_item`, `inter_agent_communication`, `inter_agent_communication_metadata`, `compacted`, `turn_context`, `token_usage_record`, `world_state`, `retained_context`, `security_risk_score`, `event_msg`, `realtime_item`. The task's originally-assumed set (`session_meta`, `response_item`, `event_msg`, `turn_context`, `compacted`) is a correct subset — current builds add multi-agent orchestration (`inter_agent_communication*`), voice (`realtime_item`), world-state diffing (`world_state`), a standalone cumulative-usage snapshot (`token_usage_record`), and risk scoring (`security_risk_score`).

Source: [github.com/openai/codex — codex-rs/history/src/lib.rs](https://github.com/openai/codex/blob/main/codex-rs/history/src/lib.rs), [codex-rs/history/src/rollout_payload.rs](https://github.com/openai/codex/blob/main/codex-rs/history/src/rollout_payload.rs)

### 5.3 `session_meta` and `turn_context` payloads

`session_meta.payload` = a `SessionMetaLine` (a flattened `SessionMeta` plus a sibling `git` object). Key fields (abbreviated — the live struct has grown to ~25 fields to support forking/sub-agents/multi-agent history; showing the ones relevant to a usage/cost connector):

```json
{
  "session_id": "thread-uuid",
  "id": "thread-uuid",
  "forked_from_id": null,
  "parent_thread_id": null,
  "timestamp": "2026-09-03T12:00:00.000Z",
  "cwd": "/Users/me/repo",
  "originator": "codex_cli_rs",
  "cli_version": "0.55.0",
  "source": "cli",
  "model_provider": "openai",
  "base_instructions": "...",
  "git": { "commit_hash": "abc123...", "branch": "main", "repository_url": "https://github.com/org/repo.git" }
}
```

Note: the field is now `base_instructions` (renamed from the older `instructions`, which used to store the *user's* instructions — that's now saved on `turn_context` instead). `git` is a **sibling** of the flattened meta fields, not nested inside a "meta" key. `GitInfo` fields (`commit_hash`, `branch`, `repository_url`) exactly match the task's original assumption.

`turn_context.payload` = a `TurnContextItem`. Key fields: `cwd`, `workspace_roots[]`, `approval_policy`, `sandbox_policy`, `permission_profile`, `network: {allowed_domains[], denied_domains[]}`, `model`, `effort`, `summary`, plus newer fields `personality`, `collaboration_mode`, `current_date`, `timezone`, `comp_hash`, `realtime_active`, `cyber_access_program`. The task's assumed core set (`cwd`, `approval_policy`, `sandbox_policy`, `model`, `effort`, `summary`) is confirmed present.

Source: [github.com/openai/codex — codex-rs/protocol/src/protocol.rs](https://github.com/openai/codex/blob/main/codex-rs/protocol/src/protocol.rs) (lines ~3040–3260 as of this fetch)

### 5.4 `event_msg` / `token_count` and `rate_limits` — verified structure

```json
{
  "timestamp": "2026-09-03T12:05:00.000Z",
  "type": "event_msg",
  "payload": {
    "type": "token_count",
    "info": {
      "total_token_usage": {
        "input_tokens": 15000,
        "cached_input_tokens": 8000,
        "cache_write_input_tokens": 0,
        "output_tokens": 900,
        "reasoning_output_tokens": 300,
        "total_tokens": 15900
      },
      "last_token_usage": {
        "input_tokens": 1200,
        "cached_input_tokens": 900,
        "cache_write_input_tokens": 0,
        "output_tokens": 150,
        "reasoning_output_tokens": 50,
        "total_tokens": 1350
      },
      "model_context_window": 400000
    },
    "rate_limits": {
      "limit_id": "codex-plus-5h",
      "limit_name": "Codex 5-hour window",
      "normal_model_slug": "gpt-5.1-codex",
      "primary": { "used_percent": 12.5, "window_minutes": 300, "resets_at": 1735689600 },
      "secondary": { "used_percent": 40.0, "window_minutes": 10080, "resets_at": 1735776000 },
      "credits": { "has_credits": true, "unlimited": false, "balance": "1234" },
      "individual_limit": { "limit": "5000", "used": "2000", "remaining_percent": 60, "resets_at": 1735689600 },
      "spend_control_reached": false,
      "plan_type": "plus",
      "rate_limit_reached_type": null
    }
  }
}
```

**Important corrections vs. commonly-assumed schema:**
- `RateLimitWindow` has **only `resets_at`** (a Unix-second timestamp) — there is **no** `resets_in_seconds` alternative field in the current struct, despite that being a reasonable-sounding guess.
- `TokenUsage` now includes **`cache_write_input_tokens`** (the cost of *writing* to the prompt cache) as distinct from `cached_input_tokens` (a cache *read*/hit) — these are priced differently (§6) and a connector that only tracks "cached vs. not" will misprice cache-write-heavy workloads.
- `RateLimitSnapshot` carries a full **`credits`** object and an **`individual_limit`** (`SpendControlLimitSnapshot`: `limit`, `used`, `remaining_percent`, `resets_at`) plus a boolean **`spend_control_reached`** and a **`plan_type`** — these are Business/Enterprise workspace-credit concepts living directly in the local session log, not just in the org-admin APIs.
- `rate_limit_reached_type` enum values (populated only once a limit is actually hit): `rate_limit_reached`, `workspace_owner_credits_depleted`, `workspace_member_credits_depleted`, `workspace_owner_usage_limit_reached`, `workspace_member_usage_limit_reached` — these distinguish "you personally hit your plan's rate limit" from "your Business/Enterprise workspace ran out of pooled credits," which is a materially different user-facing message.

Source: [github.com/openai/codex — codex-rs/protocol/src/protocol.rs](https://github.com/openai/codex/blob/main/codex-rs/protocol/src/protocol.rs) (structs `TokenUsage`, `TokenUsageInfo`, `TokenCountEvent`, `RateLimitSnapshot`, `RateLimitWindow`, `CreditsSnapshot`, `SpendControlLimitSnapshot`, `RateLimitReachedType`, lines ~2216–2400 as of this fetch)

### 5.5 `compacted` and `response_item` payloads

`compacted.payload` (`CompactedItem`): `message`, `replacement_history` (optional), `window_number`, `first_window_id`, `previous_window_id`, `window_id`, `compaction_response_id`, and — notably — `latest_token_usage_record`, a full `TokenUsageRecord` snapshot embedded at the compaction point. This lets a resumed session recover cumulative usage totals without rescanning the entire file from the beginning: **a connector doing incremental parsing should treat the nearest preceding `compacted` (or `token_usage_record`) line as a valid checkpoint to resume totals from**, rather than always summing from byte zero.

`response_item.payload` carries the raw model turn content (message / function_call / function_call_output / reasoning items) in the same vocabulary as the Responses API's item union (§7), optionally paired with a `metadata` object (`CodexHarnessMetadata` — **UNVERIFIED exact fields**).

Source: [github.com/openai/codex — codex-rs/history/src/lib.rs](https://github.com/openai/codex/blob/main/codex-rs/history/src/lib.rs)

### 5.6 How community tools parse this (CodexBar, confirmed from its own developer docs)

- Scans `event_msg` records for `token_count` payloads **and** `turn_context` records for the active model; when both exist for a turn, **`turn_context`'s model is authoritative** for which model "bucket" a cost belongs to, since `token_count` events don't always repeat the model name.
- Local-file scan paths exactly match §5.1: `~/.codex/sessions/YYYY/MM/DD/*.jsonl` and `~/.codex/archived_sessions/*.jsonl` (or the `$CODEX_HOME`-relative equivalents).
- Also scans sibling agent formats reusing the same JSONL shape: `~/.pi/agent/sessions/**/*.jsonl` and `~/.omp/agent/sessions/**/*.jsonl` — **a generalized local-log connector should not assume `~/.codex` is the only producer of this file format.**
- Priority order for live usage data: local `app-server` JSON-RPC → optional web-dashboard scrape → local JSONL scan — i.e., even the unofficial-tool authors treat the officially-shipped RPC interface as more trustworthy than the undocumented HTTP endpoint.

Source: [github.com/steipete/CodexBar/blob/main/docs/codex.md](https://github.com/steipete/CodexBar/blob/main/docs/codex.md) (fetched in full, 2026-09-03)

### 5.7 OPENAI_API_KEY mode vs. ChatGPT-login mode — billing impact

See §2.5 for the full table. Restated for this section's context: parsing a rollout JSONL file tells you exact token counts either way, but whether those tokens correspond to a real dollar charge depends entirely on the session's `auth_mode` (recorded once per login, not per-session — a connector must cross-reference the *current* `auth.json`, since historical sessions don't self-describe which auth mode was active unless you also snapshot `auth.json` over time).

### Connector implications — §5 (Codex local files)

- **Reliability tier:** Local files — Tier "local, high-fidelity, single-machine." The richest per-turn signal available anywhere in this whole document (exact input/cached/cache-write/reasoning/output split per turn, provider-reported not estimated), but it only covers machines the connector's agent actually runs on; there's no central aggregation without shipping this data somewhere yourself.
- **Attribution fields:** `session_meta.originator`, `cli_version`, `cwd`, and `git.{branch,commit_hash,repository_url}` give strong per-project/per-repo attribution for free. Account/user identity comes from cross-referencing `auth.json` (§2.4), not from the rollout file itself. There is no native concept of "which teammate" beyond the single local OS user unless the connector separately captures OS username/hostname.
- **Cost availability:** token counts are exact; dollar cost must still be computed using §6, keyed off `turn_context.model` — **except** when billing routes through a ChatGPT plan rather than an API key, in which case "% of 5h/weekly quota consumed" (from the embedded `rate_limits` block) is a more honest signal than a fabricated dollar amount, since nothing is actually charged per call in that mode.
- **Minimal polling strategy:** Tail (don't re-read) the newest `rollout-*.jsonl` for each active session — track a byte offset, read only newly-appended complete lines, and extract just `token_count` and `turn_context` records for a lightweight live meter. Run a slower full-directory walk (handling `.jsonl.zst` compressed siblings) on a longer interval (e.g., hourly) to pick up sessions from other surfaces (IDE extension, cloud tasks) and backfill history. Resume incremental parsing from the nearest `compacted`/`token_usage_record` checkpoint rather than always summing from the start of the file.

---

## 6. OpenAI API Pricing

**Caveat repeated from the top of this document:** this table is sourced from a single automated fetch of `developers.openai.com/api/docs/pricing.md` (the official pricing page, redirected from `platform.openai.com/docs/pricing`), cross-checked against WebSearch queries that **partially conflicted** with each other for the newest model families. The pricing.md-sourced numbers below are treated as primary because they are **internally consistent with known, model-family-specific cache-discount ratios** (gpt-5-family caches at exactly 10% of input price; gpt-4.1-family at 25%; gpt-4o-family at 50% — all independently correct patterns), which a naive hallucination would be unlikely to reproduce correctly across three different ratios. **Re-verify against the live page before using these numbers to bill real customers.**

### 6.1 Flagship text models — standard tier, USD per 1M tokens

| Model | Input | Cached input | Output |
|---|---|---|---|
| gpt-5.6-sol | $4.00 | $0.40 | $20.00 |
| gpt-5.6-terra | $2.00 | $0.20 | $12.00 |
| gpt-5.6-luna | $0.20 | $0.02 | $1.20 |
| gpt-5.5 | $5.00 | $0.50 | $30.00 |
| gpt-5.5-pro | $30.00 | — | $180.00 |
| gpt-5.4 | $2.50 | $0.25 | $15.00 |
| gpt-5.4-mini | $0.75 | $0.075 | $4.50 |
| gpt-5.4-nano | $0.20 | $0.02 | $1.25 |
| gpt-5.4-pro | $30.00 | — | $180.00 |
| gpt-5.2 | $1.75 | $0.175 | $14.00 |
| gpt-5.2-pro | $21.00 | — | $168.00 |
| gpt-5.1 | $1.25 | $0.125 | $10.00 |
| gpt-5 | $1.25 | $0.125 | $10.00 |
| gpt-5-mini | $0.25 | $0.025 | $2.00 |
| gpt-5-nano | $0.05 | $0.005 | $0.40 |
| gpt-5-pro | $15.00 | — | $120.00 |
| gpt-4.1 | $2.00 | $0.50 | $8.00 |
| gpt-4.1-mini | $0.40 | $0.10 | $1.60 |
| gpt-4.1-nano | $0.10 | $0.025 | $0.40 |
| gpt-4o | $2.50 | $1.25 | $10.00 |
| gpt-4o-mini | $0.15 | $0.075 | $0.60 |
| o1 | $15.00 | $7.50 | $60.00 |
| o1-pro | $150.00 | — | $600.00 |
| o3-pro | $20.00 | — | $80.00 |
| o3 | $2.00 | $0.50 | $8.00 |
| o4-mini | $1.10 | $0.275 | $4.40 |
| o3-mini | $1.10 | $0.55 | $4.40 |
| gpt-3.5-turbo | $0.50 | — | $1.50 |

**UNVERIFIED / CONFLICTING** — independent WebSearch queries for the same gpt-5.6 family returned different numbers in different runs: Sol as $5.00/$30.00 (vs. $4.00/$20.00 above), Terra as $2.50/$15.00 *or* $2.00/$12.00, Luna as $1.00/$6.00 *or* $0.20/$1.20 (this last one matches the table above). **A "long-context" surcharge was also reported** by one secondary source: Sol $10/$45, Terra $4/$18, Luna $0.40/$1.80 for long-context requests — **not corroborated elsewhere, treat as unverified.**

Sources: [developers.openai.com/api/docs/pricing.md](https://developers.openai.com/api/docs/pricing.md) (primary), cross-referenced against [cloudzero.com/blog/openai-pricing](https://www.cloudzero.com/blog/openai-pricing/), [aipricing.guru/openai-pricing](https://www.aipricing.guru/openai-pricing/) (secondary, conflicting on newest models)

### 6.2 Codex-specific model aliases

| Model | Input | Output | Note |
|---|---|---|---|
| gpt-5-codex | $1.25 | $10.00 | Matches gpt-5 base rate — codex variants appear to be priced identically to their base model |
| gpt-5.1-codex | $1.25 | $10.00 | |
| gpt-5.1-codex-mini | $0.25 | $2.00 | |
| codex-mini-latest | **CONFLICTING**: $0.75/$3.00 (one source) vs. $1.50/$6.00 (another source) | | **UNVERIFIED — resolve before billing** |

### 6.3 Batch API (50% discount, confirmed multiple ways)

| Model | Input | Cached input | Output |
|---|---|---|---|
| gpt-5.6-sol | $2.00 | $0.20 | $10.00 |
| gpt-5.6-terra | $1.00 | $0.10 | $6.00 |
| gpt-5.6-luna | $0.10 | $0.01 | $0.60 |
| gpt-5.5 | $2.50 | $0.25 | $15.00 |
| gpt-5.5-pro | $15.00 | — | $90.00 |
| gpt-5 | $0.625 | $0.0625 | $5.00 |
| gpt-5-mini | $0.125 | $0.0125 | $1.00 |
| o1 | $7.50 | — | $30.00 |
| o3 | $1.00 | — | $4.00 |

**Flex and Priority tiers exist** (lower-cost/higher-latency "flex" for select reasoning models; higher-cost/guaranteed-low-latency "priority") but **specific multipliers were not corroborated this session — UNVERIFIED**, flag for direct verification against the live pricing page.

### 6.4 Embeddings

| Model | Price per 1M tokens |
|---|---|
| text-embedding-3-small | $0.02 |
| text-embedding-3-large | $0.13 |
| text-embedding-ada-002 | $0.10 |

High confidence — consistent across every source checked this session.

### 6.5 Image generation

| Model | Text input | Cached input | Output |
|---|---|---|---|
| gpt-image-1 | $5.00/1M tok | $1.25/1M tok | $40.00/1M tok |
| gpt-image-1-mini | $2.00/1M tok | $0.20/1M tok | $8.00/1M tok |

Pricing is token-based (image output is billed as image "tokens" representing patches), not a flat per-image fee. **UNVERIFIED**: successor/newer image models beyond gpt-image-1-mini were referenced once as "gpt-image-2" by a secondary aggregator ($8/$30 in, $30 image-out) — not corroborated elsewhere, likely either a genuine newer release beyond this researcher's visibility or an aggregator error.

### 6.6 Audio: transcription, TTS, realtime

| Model | Price |
|---|---|
| whisper-1 | $0.006/minute |
| gpt-4o-transcribe | $2.50/1M input tok, $10.00/1M output tok (≈$0.006/min equivalent) |
| gpt-4o-mini-transcribe | ≈$0.003/min (secondary source) |
| tts-1 | $15.00/1M characters |
| tts-1-hd | $30.00/1M characters |
| gpt-4o-mini-tts | $0.60/1M text-input tokens (**UNVERIFIED** whether this is input-text-token price only, or also covers audio output — one source separately cited $12.00/1M output characters for what may be the same model; reconcile before billing) |

Realtime API — **CONFLICTING figures across sources, present both:**

| Model | Text in/out (per 1M tok) | Audio in/out (per 1M tok) |
|---|---|---|
| gpt-realtime-2.1 | $4.00 / $24.00 (one source) or $5.00 / $20.00 (another) | $32.00 / $64.00 (one source) or $100.00 / $200.00 (another) |
| gpt-realtime-2.1-mini | — | $10.00 / $20.00 |

**UNVERIFIED — significant conflict, verify live before use.** Rough practical estimate from one secondary source: $0.06–$0.11/min for a typical agent on gpt-realtime-2.1, $0.02–$0.05/min on the mini variant, once prompt caching is engaged.

### 6.7 Tool / built-in-tool costs

| Tool | Price |
|---|---|
| Web search | $10.00 per 1,000 calls, **plus** search-content tokens billed at the calling model's normal input rate |
| File search storage | $0.10/GB per day (first 1 GB free) |
| Code interpreter session | $0.03 per session (this researcher's training-knowledge figure, corroborated in spirit though not in exact number this session) — **one secondary source instead reported a wide $0.03–$1.92 per 20-minute-session range; UNVERIFIED which applies today** |
| computer-use-preview | $3.00/1M input tok, $12.00/1M output tok (**UNVERIFIED whether this is the standard or batch rate** — the one source found labeled it ambiguously) |

### 6.8 Deprecations and dated snapshots

Not independently re-verified with specific dates this session. OpenAI maintains a live deprecations page (`platform.openai.com/docs/deprecations`, could not be fetched directly this session due to the 403 issue noted at the top of this document) — **a connector should poll that page/its sitemap periodically rather than hard-coding deprecation dates**, given how fast this model lineup is turning over (multiple dated sub-families per year as of 2026).

### Connector implications — §6 (Pricing)

- **Reliability tier:** Public docs page — Tier "changes without notice, no versioning, no changelog API." This is the single **highest-churn** data source in this entire document (see the internal conflicts above) and the one most in need of a scheduled re-scrape, not a one-time hard-coded table.
- **Attribution fields:** none — this is a static reference table, not a data feed.
- **Cost availability:** this *is* the cost-availability source of truth for every "must-compute" case elsewhere in this document (§2 Codex-via-plan, §4 export estimation, §5 local logs, §7 proxy capture, §8 Azure token metrics).
- **Minimal polling strategy:** re-fetch and diff this table on a scheduled job (daily is reasonable given observed churn) rather than embedding it as a static constant; alert on new/unrecognized model names appearing in §1/§5/§7 usage data that aren't yet in your local price table, since new-model lag is the most common way a usage tracker silently underprices spend.

---

## 7. Per-Call Response `usage` Object Fields (for a proxy/SDK-wrapper collector)

This is the lowest-latency, highest-fidelity data source in this document, but it requires the customer to route calls through `clai`'s own proxy or SDK wrapper — OpenAI does not push this data anywhere on its own.

### 7.1 Chat Completions API — `response.usage`

```json
{
  "prompt_tokens": 1200,
  "completion_tokens": 450,
  "total_tokens": 1650,
  "prompt_tokens_details": { "cached_tokens": 300, "audio_tokens": 0 },
  "completion_tokens_details": {
    "reasoning_tokens": 120,
    "audio_tokens": 0,
    "accepted_prediction_tokens": 0,
    "rejected_prediction_tokens": 0
  }
}
```

- `cached_tokens` is populated only for prompts ≥1024 tokens (below that threshold, no caching occurs and the field is 0).
- `reasoning_tokens` are not visible as answer text but count toward — and are billed as — output tokens; `reasoning_tokens` is a sub-breakdown of `completion_tokens`, not additional to it.
- `accepted_prediction_tokens` / `rejected_prediction_tokens` are specific to the Predicted Outputs feature; rejected tokens are still billed as completion tokens even though they don't appear in the final output.

Sources: [community.openai.com/t/721149](https://community.openai.com/t/doubt-on-prompt-tokens-and-completion-tokens/721149), [developers.openai.com/api/reference/.../completions](https://developers.openai.com/api/reference/resources/completions/methods/create)

### 7.2 Responses API — `response.usage`

```json
{
  "input_tokens": 1200,
  "output_tokens": 450,
  "total_tokens": 1650,
  "input_tokens_details": { "cached_tokens": 300 },
  "output_tokens_details": { "reasoning_tokens": 120 }
}
```

Same billing semantics as §7.1 (reasoning tokens are a sub-total of `output_tokens`, billed at the output rate). Cached-token computation: hidden system tokens are subtracted from the last matched cache breakpoint, then rounded down to the nearest multiple of 128 — i.e., `cached_tokens` can under-report the true cache hit slightly due to this rounding. Source: [developers.openai.com/api/docs/guides/prompt-caching](https://developers.openai.com/api/docs/guides/prompt-caching), [community.openai.com/t/1386849](https://community.openai.com/t/how-are-reasoning-tokens-cached-tokens-input-tokens-and-output-tokens-counted-for-billing/1386849)

Note also each response object carries a top-level **`service_tier`** field (e.g. `default`, `flex`, `priority`, `batch`) alongside `usage` — a proxy must capture this too, since it changes which §6 price column applies to that call's tokens.

### 7.3 HTTP rate-limit headers (every `api.openai.com` response)

| Header | Meaning |
|---|---|
| `x-ratelimit-limit-requests` | Max requests allowed before exhausting the window |
| `x-ratelimit-limit-tokens` | Max tokens allowed before exhausting the window |
| `x-ratelimit-remaining-requests` | Requests left in the current window |
| `x-ratelimit-remaining-tokens` | Tokens left in the current window |
| `x-ratelimit-reset-requests` | Time until request-window reset, as a duration string (e.g. `"6s"`, `"1m30s"`) — **not** an absolute timestamp, unlike Codex's `resets_at` (§5.4) |
| `x-ratelimit-reset-tokens` | Same, for the token window |
| `x-ratelimit-limit-project-tokens` / `x-ratelimit-remaining-project-tokens` | Present only when a project-scoped token limit applies |
| `retry-after-ms` | Present on 429 responses |

Source: [community.openai.com/t/1366625](https://community.openai.com/t/openai-response-x-ratelimit-header-values-1-and-0/1366625), [developers.openai.com/api/docs/guides/rate-limits](https://developers.openai.com/api/docs/guides/rate-limits)

### Connector implications — §7 (Per-call usage / proxy capture)

- **Reliability tier:** Official API, Tier 1 — the most granular, real-time signal possible (per-call, not aggregated or delayed like §1's Usage API).
- **Attribution fields:** none supplied by OpenAI beyond "which API key made this call" — a proxy must stamp its own user/session/feature metadata at call time, since nothing is echoed back identifying the calling end-user.
- **Cost availability:** tokens only, never dollars — price every call yourself via §6, correctly handling cached-vs-uncached input, cache-write costs (§5.4), reasoning-token output rates, and the call's `service_tier` (default/flex/priority/batch all have different §6 price columns).
- **Minimal polling strategy:** this is not a polling source — it's a wrap-every-call instrumentation point. The "polling strategy" is really "capture synchronously on every response," making it the lowest-latency but highest-integration-effort source in this document (it requires the customer to route traffic through `clai`'s proxy/SDK wrapper, unlike §1 or §3 which need zero code changes on the customer's side).

---

## 8. Azure OpenAI

### 8.1 Cost Management Query API (billing-grade $, reconciles with the Azure invoice)

```
POST https://management.azure.com/{scope}/providers/Microsoft.CostManagement/query?api-version=2025-03-01
Authorization: Bearer <AAD token>  (OAuth2, scope "user_impersonation")
```

`{scope}` can be a subscription, resource group, Billing Account, Department, Enrollment Account, Management Group, Billing Profile, Invoice Section, or Customer — e.g. `/subscriptions/{subscriptionId}` or `/providers/Microsoft.Billing/billingAccounts/{billingAccountId}`.

Request body:

```json
{
  "type": "Usage",
  "timeframe": "MonthToDate",
  "dataset": {
    "granularity": "Daily",
    "aggregation": { "totalCost": { "name": "PreTaxCost", "function": "Sum" } },
    "grouping": [{ "name": "ResourceGroup", "type": "Dimension" }],
    "filter": {
      "dimensions": { "name": "ResourceType", "operator": "In", "values": ["OpenAI"] }
    }
  }
}
```

To isolate Azure OpenAI specifically, filter on `Service name = Cognitive Services` **and** `Service tier`/`Meter subcategory = "Azure Open AI"` (or `"Azure Open AI Reservation"` for PTU commitments) — a plain `ResourceType = OpenAI` filter is simpler but **misses reservation/PTU purchase line items**.

Response:

```json
{
  "name": "query-guid",
  "type": "microsoft.costmanagement/Query",
  "properties": {
    "columns": [{ "name": "PreTaxCost", "type": "Number" }, { "name": "ResourceGroup", "type": "String" }, { "name": "UsageDate", "type": "Number" }, { "name": "Currency", "type": "String" }],
    "rows": [[19.55, "my-rg", 20260901, "USD"]],
    "nextLink": "https://management.azure.com/...&$skiptoken=..."
  }
}
```

Rows are positional arrays matching `columns`, not objects — a connector must zip them together itself. Source: [learn.microsoft.com/en-us/rest/api/cost-management/query/usage](https://learn.microsoft.com/en-us/rest/api/cost-management/query/usage?view=rest-cost-management-2025-03-01) (fetched in full, 2026-09-03)

### 8.2 Azure Monitor metrics (`Microsoft.CognitiveServices/accounts` namespace)

Token/usage metrics relevant to Azure OpenAI (Category "Azure OpenAI - Usage" and the newer provider-agnostic "Models - Usage" category), all `Count` unit, `Total (Sum)` default aggregation, `PT1M` time grain, exportable to Log Analytics/Event Hub/Storage via Diagnostic Settings:

| Metric (display) | REST API name | Dimensions | Notes |
|---|---|---|---|
| Processed Prompt Tokens | `ProcessedPromptTokens` | ApiName, ModelDeploymentName, FeatureName, UsageChannel, Region, ModelVersion | Input tokens |
| Generated Completion Tokens | `GeneratedTokens` | (same set) | Output tokens |
| Processed Inference Tokens | `TokenTransaction` | (same set) | = prompt + generated |
| Active Tokens | `ActiveTokens` | Region, ModelDeploymentName, ModelName, ModelVersion, ServiceTierRequest/Response | Total minus cached; PTU throughput signal |
| Audio Prompt / Completion Tokens | `AudioPromptTokens` / `AudioCompletionTokens` | ModelDeploymentName, ModelName, ModelVersion, Region | |
| Prompt Token Cache Match Rate | `AzureOpenAIContextTokensCacheMatchRate` | Region, ModelDeploymentName, ModelName, ModelVersion | Percent |
| Provisioned-managed Utilization V2 | `AzureOpenAIProvisionedManagedUtilizationV2` | Region, StreamType, ModelDeploymentName, ModelName, ModelVersion | PTU capacity %; ≥100% ⇒ HTTP 429 throttling |
| Azure OpenAI Requests | `AzureOpenAIRequests` | ApiName, OperationName, Region, StreamType, ModelDeploymentName, ModelName, ModelVersion, StatusCode, IsSpillover, ServiceTierRequest/Response | Request volume/errors |
| Processed FineTuned Training Hours | `FineTunedTrainingHours` | ApiName, ModelDeploymentName, FeatureName, UsageChannel, Region | |
| Realtime API Seconds Used | `RealtimeUsageTime` | Region, ModelDeploymentName | |

Newer, provider-agnostic "Models - Usage" category (appears to be a unified successor, also covers non-OpenAI models Foundry now hosts, e.g. Anthropic — an unexpected finding): `InputTokens`, `OutputTokens`, `TotalTokens`, `AudioInputTokens`, `AudioOutputTokens`, plus Anthropic-specific `cacheReadInputTokens` / `ephemeral1hInputTokens` / `ephemeral5mInputTokens` (out of scope for an OpenAI-only connector, but worth knowing the same Monitor namespace now carries other vendors' models too — don't assume every row under `Microsoft.CognitiveServices/accounts` is OpenAI).

Latency metrics also exist (`AzureOpenAITimeToResponse`, `AzureOpenAITTLTInMS`, `AzureOpenAINormalizedTBTInMS`, `AzureOpenAINormalizedTTFTInMS`, `AzureOpenAITokenPerSecond`) — useful for performance dashboards but not cost.

**Warning surfaced directly in Microsoft's own docs:** don't confuse these with the legacy `Latency`/`TotalCalls`/etc. metrics under "Cognitive Services - HTTP Requests" — those predate Azure OpenAI-specific instrumentation and "produce misleading results" if used for Azure OpenAI workloads.

Resource logs available via Diagnostic Settings: `Audit`, `AzureOpenAIRequestUsage`, `ManagedNetworkEvent`, `RequestResponse`, `Trace` — all currently routed into the shared `AzureDiagnostics` table (not a dedicated per-resource table) when sent to Log Analytics.

Source: [learn.microsoft.com/en-us/azure/foundry/openai/monitor-openai-reference](https://learn.microsoft.com/en-us/azure/foundry/openai/monitor-openai-reference) (fetched in full, 2026-09-03 — this is a very large, actively-maintained reference page; the table above is a curated subset focused on cost/usage, not the full page which also covers Content Safety, Speech, Translator, and other Cognitive Services metrics sharing the same resource type)

### 8.3 Azure API Management token-metric policies

Two related inbound policies, XML, configured per-API/product/operation in APIM:

```xml
<llm-emit-token-metric namespace="MyLLM">
  <dimension name="API ID" />
</llm-emit-token-metric>
```

- **`azure-openai-emit-token-metric`** — Azure-OpenAI-specific (legacy/original).
- **`llm-emit-token-metric`** — newer, provider-agnostic (works for any LLM API proxied through APIM); in preview, additionally captures cached/reasoning/thinking token categories, not just total/prompt/completion.

Behavior notes: emits Application Insights **custom metrics**, using **actual token counts from the `usage` field of the real LLM response** (not estimated) — except under streaming, where counts become estimates, and can go fully inaccurate if a stream is interrupted. Up to 5 custom dimensions per policy; can be used multiple times per policy definition. Requires `include_usage: true` in the request for some OpenAI models/streaming modes to get usage data back at all.

Source: [raw.githubusercontent.com/MicrosoftDocs/azure-docs/.../llm-emit-token-metric-policy.md](https://github.com/MicrosoftDocs/azure-docs/blob/main/articles/api-management/llm-emit-token-metric-policy.md) (fetched in full, 2026-09-03), [learn.microsoft.com/en-us/azure/api-management/azure-openai-emit-token-metric-policy](https://learn.microsoft.com/en-us/azure/api-management/azure-openai-emit-token-metric-policy)

### Connector implications — §8 (Azure OpenAI)

- **Reliability tier:** Cost Management Query API = official billing-grade API, Tier 1, reconciles with the Azure invoice (like §1's OpenAI-native Costs API). Azure Monitor metrics = official telemetry API, Tier 1 for *tokens* (near-real-time, `PT1M` granularity) but carries **no cost data** — still needs an Azure-OpenAI-specific price list (different from the public OpenAI API prices in §6!) to compute $. The APIM policy = opt-in instrumentation the customer must already have deployed in their own gateway — same integration-effort tier as §7's proxy pattern.
- **Attribution fields:** Monitor metrics dimension by `ModelDeploymentName`/`ModelName`/`ModelVersion`/`Region` — **no native end-user attribution**, since Azure OpenAI resources are typically shared per-team/per-app rather than per-individual the way OpenAI's own org/project/user model works. End-user-level attribution, if needed, has to come from the APIM layer's custom dimensions (e.g., subscription key, a JWT claim) — the base Cognitive Services resource has no concept of "user" at all.
- **Cost availability:** Cost Management = actual billed Azure $ in the customer's invoice currency, and **includes PTU/reservation charges that token metrics cannot see at all** — a PTU customer can show heavy token throughput in Monitor while their Azure bill is a flat reserved-capacity charge completely decoupled from per-call token counts. Monitor metrics alone = tokens/requests only, meaningless for $ on a PTU deployment.
- **Minimal polling strategy:** Cost Management Query API is eventually-consistent at roughly daily granularity in practice — poll once/day. Azure Monitor metrics support `PT1M` granularity — poll hourly for near-real-time dashboards, but for high-volume deployments prefer setting up a **Diagnostic Setting once** (push model into Log Analytics/Event Hub) over repeated pull-polling of the Metrics REST API.

---

## Appendix: Cross-Source Priority Matrix

| # | Source | Reliability tier | Best attribution | $ availability | Plan gate | Poll cadence |
|---|---|---|---|---|---|---|
| 1 | Org Usage/Costs API | Official API | project/user/api_key/model | Costs = billed $; Usage = tokens only | Any API Platform org (Admin key, org-owner-issued) | Costs: daily. Usage: hourly/daily |
| 2 | ChatGPT plans / Codex local | Public docs + local files + local RPC | account/email (single user) | Must-compute; or % of quota | All plans (auth.json always present for Codex users) | On-demand via `app-server` RPC; tail JSONL live |
| 2u | `chatgpt.com/backend-api/wham/usage` | **Unofficial** | account | % of quota | ChatGPT-login Codex users | Avoid steady polling; no SLA |
| 3 | Codex Analytics API | Official API (thin public docs) | user/surface/model, workspace-wide | Not documented; credits only | Enterprise/Edu | Daily/weekly (schema needs live-account confirmation) |
| 3 | Compliance API | Official API | user/conversation/message, workspace-wide | None (compliance, not cost) | Enterprise/Edu/Teachers only | On-demand/audit pull |
| 3 | Workspace analytics CSV | Manual export | user/GPT/project | None | Enterprise/Edu only (**not** Business) | Weekly/monthly manual pull |
| 4 | ChatGPT data export | User export | single account | None (tiktoken estimate) | All plans | Monthly backfill, not live |
| 5 | Codex rollout JSONL | Local files | project/repo (git), account (via auth.json) | Exact tokens; $ must-compute or % quota | All Codex users, local machine only | Tail live file; hourly directory sweep |
| 6 | API pricing page | Public docs | n/a | n/a (it *is* the price list) | n/a | Daily re-scrape/diff |
| 7 | Per-call `usage` (proxy) | Official API | whatever the proxy stamps itself | Exact tokens; $ must-compute | Any API key, requires proxy integration | Every call (not polling) |
| 8 | Azure Cost Management | Official API | resource group/subscription | Billed $ (incl. PTU) | Any Azure subscription | Daily |
| 8 | Azure Monitor metrics | Official API | model deployment/region | Tokens only | Any Azure OpenAI resource | Hourly, or push via Diagnostic Setting |
| 8 | Azure APIM policy | Requires customer's own gateway | whatever custom dimensions the customer configures | Exact tokens from real `usage` | Customer already runs APIM in front of Azure OpenAI | Every call (not polling) |
