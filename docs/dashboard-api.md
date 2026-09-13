# clai dashboard API contract

The dashboard SPA (`apps/dashboard`) talks to a small JSON API served by either the CLI
(`clai dashboard`, local mode, bound to 127.0.0.1, no auth) or the team server (`clai-server`,
team mode, bearer-token auth). Both serve the same static SPA at `/` and the API under `/api`.

All amounts are USD numbers. Timestamps are ISO-8601 UTC strings. Day keys are `YYYY-MM-DD` in
the store's configured timezone.

## Common query parameters

| Param | Values | Notes |
|---|---|---|
| `since` | `7d`, `30d`, `90d`, `4w`, `today`, `week`, `month`, `all`, `YYYY-MM-DD` | default `30d` |
| `until` | ISO or `YYYY-MM-DD` | optional, exclusive |
| `provider` | `anthropic`, `openai`, `google`, ... | optional |
| `source` | `claude-code`, `codex-cli`, `anthropic-admin`, ... | optional |
| `project` | project label | optional |
| `actor` | actor key (email / user id / api key id / `me`) | optional |
| `billing` | `api`, `subscription`, `unknown` | optional |
| `model` | canonical model key | optional |

## Shared shapes

```ts
type TokenUsage = { input: number; output: number; cacheRead: number; cacheWrite5m: number; cacheWrite1h: number; reasoning?: number; requests: number; webSearches?: number; webFetches?: number };
type Breakdown = { key: string; usd: number; computedUsd: number; billedUsd: number | null; events: number; usage: TokenUsage; share: number };
type Forecast = { month: string; daysElapsed: number; daysInMonth: number; mtdUsd: number; projectedUsd: number; avgDailyUsd: number; lastMonthUsd: number | null; deltaVsLastMonth: number | null; method: 'weekday-weighted' | 'run-rate' | 'insufficient-data'; confidence: 'low' | 'medium' | 'high' };
type Insight = { id: string; kind: string; severity: 'info' | 'opportunity' | 'warning' | 'critical'; title: string; detail: string; impactUsdPerMonth?: number; action?: string; evidence: Record<string, unknown> };
type DeclaredSubscription = { id: string; provider: string; plan: string; label?: string; priceMonthly: number; seats?: number; appliesTo?: { sources?: string[]; actorKeys?: string[] } };
type Budget = { id: string; name: string; amountUsd: number; period: 'month'; scope?: { provider?: string; source?: string; project?: string; actorKey?: string } };
type Seat = { actorKey: string; label?: string; provider: string; plan: string; priceMonthly: number };
type Session = { sessionId: string; started: string; ended: string; project: string | null; source: string; provider: string; models: string[]; usd: number; events: number; usage: TokenUsage; maxContext: number };
type UsageEvent = { id: string; ts: string; source: string; provider: string; model: string; modelKey: string | null; surface: string; billing: string; plan?: string; granularity: string; actor: Record<string, string>; context: Record<string, unknown>; usage: TokenUsage; cost: { billedUsd: number | null; computedUsd: number | null; currency: 'USD'; confidence: 'billed' | 'computed' | 'estimated' | 'none' } };
```

## Endpoints

### `GET /api/health`
```json
{ "ok": true, "version": "0.1.0", "mode": "local" | "team", "timeZone": "Europe/Berlin", "db": { "events": 12345, "first": "2026-06-01T..", "last": "2026-09-03T.." }, "pricingVersion": "2026-09-03", "authRequired": false }
```
In team mode this endpoint is public (no bearer token) and the response has no `db` field, so an
unauthenticated caller cannot learn how much data the server holds; `db` is present only in local
mode, where there is no auth to bypass.

### `GET /api/summary` (common params)
```json
{
  "range": { "since": "2026-08-04T..|null", "until": null, "timeZone": "Europe/Berlin" },
  "totals": { "usd": 0, "computedUsd": 0, "billedUsd": null, "events": 0, "usage": TokenUsage },
  "today": { "usd": 0, "events": 0 },
  "thisMonth": { "usd": 0, "events": 0 },
  "lastMonth": { "usd": 0, "events": 0 },
  "forecast": Forecast,
  "byProvider": Breakdown[], "byModel": Breakdown[], "bySource": Breakdown[], "byProject": Breakdown[], "bySurface": Breakdown[], "byBilling": Breakdown[],
  "daily": [{ "day": "2026-09-01", "usd": 12.3, "events": 45, "byProvider": { "anthropic": 10.1, "openai": 2.2 } }],
  "subscriptions": [{ "subscription": DeclaredSubscription, "mtdUsd": 0, "projectedUsd": 0, "lastMonthUsd": 0, "multiple": 0 }],
  "budgets": [{ "budget": Budget, "mtdUsd": 0, "projectedUsd": 0, "usedPct": 0, "projectedPct": 0 }]
}
```
`daily` is filled for every day in the range (zeros included), ordered ascending. Costs of
subscription-billed usage are API-equivalent values (what the same tokens would cost at list price).

### `GET /api/breakdown?dim=model|provider|source|project|actor|surface|billing|plan|day|month&limit=50`
`{ "dim": "model", "rows": Breakdown[] }`

### `GET /api/sessions?limit=50` -> `{ "sessions": Session[] }`

### `GET /api/insights` -> `{ "insights": Insight[], "generatedAt": ISO }`
Insights are computed over the last 90 days regardless of `since`; filters other than `since`/`until` apply.

### `GET /api/events?limit=100` -> `{ "events": UsageEvent[] }` (most recent first)

### `GET /api/models`
`{ "models": [{ "key": "claude-opus-5", "displayName": "Claude Opus 5", "provider": "anthropic", "tier": "frontier", "input": 5, "output": 25, "cacheRead": 0.5, "cacheWrite5m": 6.25, "cacheWrite1h": 10, "verified": true, "retired": null, "usd": 12.3, "events": 10, "usage": TokenUsage }] }`
Catalog joined with usage in range; models without usage are included with zeros (for the pricing reference page).

### `GET /api/settings`
```json
{ "mode": "local", "timeZone": "Europe/Berlin", "pricingVersion": "2026-09-03", "subscriptions": DeclaredSubscription[], "budgets": Budget[], "seats": Seat[], "sources": [{ "source": "claude-code", "events": 100, "first": ISO, "last": ISO }], "lastRuns": [{ "source": "claude-code", "started_at": ISO, "finished_at": ISO, "events_seen": 0, "events_inserted": 0, "events_updated": 0, "unpriced": 0, "ok": 1, "error": null }], "plans": [{ "provider": "anthropic", "plan": "max_20x", "display": "Claude Max 20x", "priceMonthly": 200, "seatBased": false }] }
```
`plans` is the catalog of known subscription plans for the "add plan" picker.

### `GET /api/actors` -> `{ "actors": [{ "actorKey": "me", "actor": {}, "firstDay": "..", "lastDay": "..", "usd": 0, "events": 0, "usage": TokenUsage, "seat": Seat | null }] }`

### Mutations (JSON bodies; return the updated list)
- `POST /api/settings/subscriptions` body `DeclaredSubscription` (id optional; server generates) -> `{ subscriptions }`
- `DELETE /api/settings/subscriptions/:id` -> `{ subscriptions }`
- `POST /api/settings/budgets` body `Budget` -> `{ budgets }`
- `DELETE /api/settings/budgets/:id` -> `{ budgets }`
- `POST /api/settings/seats` body `Seat` -> `{ seats }`
- `DELETE /api/settings/seats/:actorKey` -> `{ seats }`
- `POST /api/scan` (local mode only) -> `{ "results": [{ "source": "claude-code", "seen": 10, "inserted": 3, "updated": 0, "unpriced": 0, "error": null }] }`

### Team mode
- Every request except `GET /api/health` needs `Authorization: Bearer <token>`; `401` => the SPA shows a token prompt and stores the token in `localStorage['clai_token']`.
- `GET /api/whoami` -> `{ "actorKey": "a@b.c", "role": "admin" | "member", "label": "..." }`
- Members see only their own data unless role is `admin`.
- `POST /api/v1/ingest` body `{ "events": UsageEvent[] }` (used by `clai sync`, not by the SPA).
- Admin-only: `GET/POST /api/admin/tokens` (`POST` body `{ "actorKey", "role"?, "label"?, "expiresAt"? }` -> `{ "token", "actorKey", "role" }`, the token is shown once), `DELETE /api/admin/tokens/:hash`, `GET/POST /api/admin/members`. `403` for a non-admin.

## Errors
`{ "error": "message" }` with 4xx/5xx status.

## Hosted extensions

The hosted service (`clai-cloud`, a separate private repo) serves the same contract above plus a
small number of additive fields and routes — existing fields never change meaning or shape, so a
client built against this document keeps working unmodified against the hosted API. The mock
engine (`apps/dashboard/src/mock`) renders all of it behind `?mock=1&hosted=1` (combinable with
`?team=1`) so the dashboard can be built and screenshotted against it ahead of the hosted API
existing.

- `GET /api/health` gains `auth: { kind: 'token' | 'supabase' }`, naming which credential scheme
  the server accepts. **Served for real by `clai-server` today**, always as `{ kind: 'token' }` in
  team mode (self-hosted servers only ever accept `clai_*` bearer tokens); the hosted service is
  the only one that answers `{ kind: 'supabase' }`, which is what the dashboard uses to decide
  between the plain token prompt and the hosted sign-in screen.
- `GET /api/whoami` gains, all optional: `email`, `orgId`, `orgs: { id, name }[]`, `plan: 'free' |
  'plus' | 'team' | 'business' | 'self-hosted'`, `billingStatus: 'active' | 'past_due' | 'canceled'
  | null`, `upgradeUrl: string | null` (a Stripe Payment Link when the org isn't on a paid plan),
  `portalUrl: string | null` (the Stripe Billing Portal once subscribed), `tosAccepted: boolean`.
  **Served for real by `clai-server` today** with inert self-hosted defaults: `email` is the
  principal's `actorKey` when it looks like one, else `null`; `orgId: null`; `orgs: []`;
  `plan: 'self-hosted'`; `billingStatus`, `upgradeUrl`, `portalUrl` all `null`; `tosAccepted: true`
  (there is no ToS gate to run your own server).
- `POST /v1/ingest`'s response gains `dropped: number` (events rejected for being older than the
  org's retention window; always `0` from a self-hosted server, which has no retention window).
  **Served for real today** — `UpsertResult.dropped` is part of the `EventStore` interface.
- New routes, not present on `clai-server` (it answers `404` for all of them, which is exactly how
  `clai login` tells a self-hosted server apart from the hosted one — see below): `/api/auth/*`
  and `/api/me/tokens`.

Team mode's `GET /api/health` is public (no bearer token required) precisely so a load balancer
or the hosted dashboard's pre-login screen can call it; it never includes `db` (that would leak an
event count to an unauthenticated caller). `db` is present only in local mode.

### Hosted auth routes (`clai-cloud` only; public unless noted)

All bodies and responses are JSON, camelCase, same conventions as the rest of this contract. These
back both the dashboard's sign-in screen (`GET /api/health`'s `auth.kind === 'supabase'` is what
makes the SPA show it instead of the plain token prompt) and `clai login`'s device-code flow.

- `POST /api/auth/link` — sign-in screen "Send sign-in link". Body `{ email: string, tosAccepted:
  true }` (the checkbox is required client-side; the server re-checks it). Response `{ sent: true
  }`. Proxies a Supabase Auth magic link; never returns a token directly.
- `POST /api/auth/verify` — the landing page for that email's link, `#/auth/confirm?token_hash=
  ...&type=...` (params read from the hash query by `hash.ts`/`App.tsx`, not a real path, since the
  SPA is hash-routed). Body `{ tokenHash: string, type: string }` (straight from the URL). Response
  `{ token: string, refreshToken: string }`, stored by the SPA as `localStorage['clai_token']` /
  `['clai_refresh']`, then `#/auth/confirm` navigates to `#/`.
- `POST /api/auth/refresh` — called by `apps/dashboard/src/api.ts`'s `realRequest` automatically,
  at most once per request, when a call 401s and `clai_refresh` is set. Body `{ refreshToken:
  string }`. Response `{ token: string, refreshToken: string }`; a second 401 after retrying with
  the new token is treated as a real unauthorized (signs the SPA out).
- `POST /api/auth/logout` — header "Sign out". Bearer-authenticated; revokes the refresh token
  server-side. Response `{ ok: true }`. The SPA clears `clai_token`, `clai_refresh` and `clai_org`
  regardless of whether this call succeeds.
- `POST /api/auth/device` — public, rate-limited per IP; the first call of `clai login`. Body `{
  scope: 'admin' | 'member' }` (`--admin` requests, not guarantees, an admin-scoped token — the
  server still decides based on the signed-in user's actual role). Response `{ deviceCode: string,
  userCode: string, verificationUrl: string, interval: number, expiresIn: number }`. The CLI prints
  `userCode` and opens `verificationUrl` (`APP_ORIGIN/#/device?code=<userCode>`).
- `POST /api/auth/device/token` — polled by `clai login` every `interval` seconds. Body `{
  deviceCode: string }`. `200` with `{ token: string, actorKey: string, orgId: string | null, role:
  'admin' | 'member' }` once approved. Before that: `428` (or any status with body `{ error:
  'authorization_pending' }`) means keep polling; `{ error: 'expired' }` or `{ error: 'denied' }`
  (any status) means stop and report failure.
- `POST /api/auth/device/approve` — `#/device`'s "Approve this machine" button, bearer-authenticated
  (the signed-in browser approves the CLI's pending code). Body `{ userCode: string, orgId: string
  }`. Response `{ approved: true }`, or an error body when the code is unknown/expired/already used.
- `POST /api/me/tokens` — header "Connect a machine" panel: mint a `clai_*` token for the caller's
  own `actorKey`/org without going through the device flow. Bearer-authenticated. Body `{ label:
  string }`. Response `{ token: string, actorKey: string, role: 'admin' | 'member' }`, shown once
  with the exact `clai sync --server <origin> --token <token>` command.

### SPA storage keys (`localStorage`)

`clai_token` (bearer access token, sent as `Authorization: Bearer …`), `clai_refresh` (hosted-only
refresh token, never sent as a header — only in `/api/auth/refresh`'s body), `clai_org` (selected
org id, sent as `x-clai-org` on every request once set; irrelevant with zero or one org).
