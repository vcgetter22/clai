import type { RawUsageEvent } from '@claii/core';
import { emptyUsage } from '@claii/core';
import type { ApiConnector, ConnectorContext } from '../types.js';
import { num, str } from '../util/files.js';
import { compact, compactTags, describeAuthError, isoDayRange, markPulled, parseLinkHeader, parseNdjson, requestJson, requestText, resolveWindow } from './http.js';

/**
 * GitHub Copilot admin/billing APIs for an organization (optionally centralized at an enterprise).
 * Three independent data sources are pulled, all under `source: 'github-copilot'`:
 *
 *  1. `GET /orgs/{org}/copilot/billing/seats` — current per-seat snapshot (who has a Copilot seat,
 *     last activity, plan). Confirmed, long-stable shape.
 *  2. `GET /orgs/{org}/copilot/metrics/reports/users-1-day?day=YYYY-MM-DD` — the 2026 Copilot Metrics
 *     "reports" API: returns signed NDJSON download links per day, one line per user, including
 *     `ai_credits_used`. Confirmed endpoint/envelope shape (fetched from GitHub's live REST API docs,
 *     docs.github.com/en/rest/copilot/copilot-usage-metrics, 2026-09-03) but the exact field names
 *     *inside* each NDJSON line are NOT documented on that page — read defensively below.
 *  3. `GET /organizations/{org}/settings/billing/usage` — the general per-product billing usage
 *     report (confirmed shape, docs.github.com/en/rest/billing/usage, fetched 2026-09-03), filtered
 *     to Copilot rows, giving an authoritative billed dollar figure per SKU/day.
 *
 * Source: research/other-sources.md §3 ("GitHub Copilot"). That section confirms this connector must
 * target the 2026 report-based Metrics API, NOT the legacy `GET /orgs/{org}/copilot/metrics` inline-
 * JSON endpoint (fully sunset 2026-04-02) — this file only ever calls the `.../reports/...` paths, so
 * it is already on the current API. It also confirms the per-user NDJSON record's field names
 * (`user_id`, `user_login`, `day`, `enterprise_id`, `ai_adoption_phase`, `ai_credits_used`,
 * `code_acceptance_activity_count`, `code_generation_activity_count`, `loc_added_sum`,
 * `loc_deleted_sum`) and the billing-usage `usageItems[]` field list read below. The exact key names
 * *inside* each NDJSON line beyond that confirmed list are still not spelled out on a single page, so
 * unrecognized fields are still ignored rather than assumed, via `num()`/`str()`/optional chaining —
 * a renamed or missing field degrades to 0/undefined/skipped-row instead of throwing.
 *
 * Headers: `Accept: application/vnd.github+json`, `X-GitHub-Api-Version` on every GitHub API call —
 * NOT on the signed NDJSON download links, which point off-github.com and are pre-authenticated.
 */

const BASE = 'https://api.github.com';
const GITHUB_API_VERSION = '2026-03-10';
/** GitHub AI Credits, GitHub's Copilot usage-based billing unit since June 2026: 1 credit = $0.01. */
const USD_PER_AI_CREDIT = 0.01;

function githubHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': GITHUB_API_VERSION };
}

// ---- GET /orgs/{org}/copilot/billing/seats — per-seat snapshot --------------------------------

interface CopilotSeat {
  created_at?: string;
  updated_at?: string;
  pending_cancellation_date?: string | null;
  last_activity_at?: string | null;
  last_activity_editor?: string | null;
  plan_type?: string;
  assignee?: { login?: string; id?: number };
}

interface CopilotSeatsPage {
  total_seats?: number;
  seats?: CopilotSeat[];
}

export function mapSeat(seat: CopilotSeat, now: Date): RawUsageEvent | null {
  const login = str(seat.assignee?.login);
  if (!login) return null;
  const day = now.toISOString().slice(0, 10);
  return {
    ts: now.toISOString(),
    source: 'github-copilot',
    provider: 'github',
    model: 'unknown',
    surface: 'ide',
    billing: 'subscription',
    granularity: 'day',
    actor: { userId: login },
    context: {},
    usage: emptyUsage(),
    meta: compact({
      lastActivityAt: str(seat.last_activity_at ?? undefined),
      lastActivityEditor: str(seat.last_activity_editor ?? undefined),
      planType: str(seat.plan_type),
      pendingCancellationDate: str(seat.pending_cancellation_date ?? undefined),
    }),
    // Seats is a point-in-time snapshot re-fetched on every pull, not a time series — the day +
    // login natural key makes same-day re-pulls idempotent instead of piling up duplicate rows.
    naturalKey: ['seat', day, login],
  };
}

async function* pullSeats(ctx: ConnectorContext, headers: Record<string, string>, org: string): AsyncGenerator<RawUsageEvent> {
  const now = ctx.now();
  let url = `${BASE}/orgs/${encodeURIComponent(org)}/copilot/billing/seats`;
  let first = true;
  let guard = 0;
  while (url && guard++ < 200) {
    let res;
    try {
      res = await requestJson<CopilotSeatsPage>(ctx, url, { headers, query: first ? { per_page: 100 } : undefined });
    } catch (err) {
      ctx.log.warn(`github-copilot: failed to fetch billing seats: ${(err as Error).message}`);
      return;
    }
    first = false;
    for (const seat of res.body.seats ?? []) {
      const ev = mapSeat(seat, now);
      if (ev) yield ev;
    }
    const links = parseLinkHeader(res.headers.get('link'));
    url = links['next'] ?? '';
  }
}

// ---- GET .../copilot/metrics/reports/users-1-day — signed NDJSON, one line per user per day ---

interface CopilotMetricsReportLinks {
  download_links?: string[];
  report_day?: string;
}

/**
 * Row shape per research/other-sources.md §3: the per-user NDJSON record's confirmed field names are
 * `user_id`, `user_login`, `day`, `enterprise_id`, `ai_adoption_phase`, `ai_credits_used`,
 * `code_acceptance_activity_count`, `code_generation_activity_count`, `loc_added_sum`,
 * `loc_deleted_sum` (plus nested by-CLI/by-IDE/by-feature breakdowns not read here). `date`/`login`
 * are kept as defensive fallback spellings alongside the confirmed `day`/`user_login` in case a
 * report variant renames them; anything else in the line is ignored.
 */
interface CopilotUserMetricsRow {
  day?: string;
  date?: string;
  user_id?: string | number;
  user_login?: string;
  login?: string;
  user?: { login?: string };
  enterprise_id?: string;
  ai_adoption_phase?: string;
  ai_credits_used?: number;
  code_acceptance_activity_count?: number;
  code_generation_activity_count?: number;
  loc_added_sum?: number;
  loc_deleted_sum?: number;
}

export function mapUserMetricsRow(row: CopilotUserMetricsRow): RawUsageEvent | null {
  const day = str(row.day) ?? str(row.date);
  if (!day) return null;
  const login = str(row.user_login) ?? str(row.login) ?? str(row.user?.login);
  const userId = str(row.user_id !== undefined ? String(row.user_id) : undefined);
  const credits = row.ai_credits_used;
  const billedUsd = typeof credits === 'number' ? credits * USD_PER_AI_CREDIT : null;
  const ts = /^\d{4}-\d{2}-\d{2}$/.test(day) ? `${day}T00:00:00.000Z` : day;
  return {
    ts,
    source: 'github-copilot',
    provider: 'github',
    // Not broken down by model per GitHub's own field description; kept 'unknown' rather than guessed.
    model: 'unknown',
    surface: 'ide',
    billing: 'subscription',
    granularity: 'day',
    actor: compact({ userId: login ?? userId }),
    context: {},
    usage: emptyUsage(),
    // `estimated`, not `billed`: this is a $/credit conversion of a consumption metric, not a
    // reconciled bill — the billing-usage stream below (`mapBillingUsageItem`) is the billed figure.
    cost: billedUsd !== null ? { billedUsd, currency: 'USD', confidence: 'estimated' } : undefined,
    meta: compact({
      aiCreditsUsed: credits,
      enterpriseId: row.enterprise_id,
      aiAdoptionPhase: row.ai_adoption_phase,
      codeAcceptanceActivityCount: row.code_acceptance_activity_count,
      codeGenerationActivityCount: row.code_generation_activity_count,
      locAdded: row.loc_added_sum,
      locDeleted: row.loc_deleted_sum,
    }),
    naturalKey: ['metrics', day, login ?? userId ?? ''],
  };
}

async function* pullUserMetrics(ctx: ConnectorContext, headers: Record<string, string>, scopeBase: string, days: string[]): AsyncGenerator<RawUsageEvent> {
  for (const day of days) {
    let res;
    try {
      res = await requestJson<CopilotMetricsReportLinks>(ctx, `${scopeBase}/copilot/metrics/reports/users-1-day`, { headers, query: { day }, retries: 2 });
    } catch (err) {
      ctx.log.warn(`github-copilot: failed to fetch metrics report links for ${day}: ${(err as Error).message}`);
      continue;
    }
    for (const link of res.body.download_links ?? []) {
      let text: string;
      try {
        // Signed download URLs are pre-authenticated (off api.github.com) — no GitHub auth headers.
        text = await requestText(ctx, link, { retries: 2 });
      } catch (err) {
        ctx.log.warn(`github-copilot: failed to download metrics report for ${day}: ${(err as Error).message}`);
        continue;
      }
      for (const row of parseNdjson<CopilotUserMetricsRow>(text)) {
        const ev = mapUserMetricsRow(row);
        if (ev) yield ev;
      }
    }
  }
}

// ---- GET /organizations/{org}/settings/billing/usage — billed $ per product/SKU/day ------------

interface CopilotBillingUsageItem {
  date?: string;
  product?: string;
  sku?: string;
  quantity?: number;
  unitType?: string;
  pricePerUnit?: number;
  grossAmount?: number;
  discountAmount?: number;
  netAmount?: number;
  organizationName?: string;
  repositoryName?: string;
}

interface CopilotBillingUsageResponse {
  usageItems?: CopilotBillingUsageItem[];
}

/** UNVERIFIED exact enum casing for `product` (research/other-sources.md §3 says only "filter product/sku
 * for Copilot rows", no literal string given); matched case-insensitively/by substring rather than an
 * exact `=== 'copilot'`. */
function isCopilotProduct(p: string | undefined): boolean {
  return !!p && p.toLowerCase().includes('copilot');
}

export function mapBillingUsageItem(item: CopilotBillingUsageItem, indexInPage: number): RawUsageEvent | null {
  const date = str(item.date);
  if (!date) return null;
  const ts = /^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date}T00:00:00.000Z` : date;
  const sku = str(item.sku);
  const netAmount = item.netAmount;
  return {
    ts,
    source: 'github-copilot',
    provider: 'github',
    model: sku ?? 'unknown',
    surface: 'ide',
    billing: 'api',
    granularity: 'day',
    actor: {},
    context: { tags: compactTags({ sku, unitType: str(item.unitType) }) },
    // `quantity` -> requests, per the task's field mapping (a count of billed units, e.g. premium requests).
    usage: { ...emptyUsage(), requests: num(item.quantity) },
    cost: typeof netAmount === 'number' ? { billedUsd: netAmount, currency: 'USD', confidence: 'billed' } : undefined,
    meta: compact({ product: item.product, pricePerUnit: item.pricePerUnit, grossAmount: item.grossAmount, discountAmount: item.discountAmount, organizationName: item.organizationName, repositoryName: item.repositoryName }),
    naturalKey: ['billing', date, sku ?? '', String(indexInPage)],
  };
}

/** [{year, month}] covering [sinceIso, untilIso] — the billing usage endpoint takes year/month/day filters, not a range. */
function monthsInRange(sinceIso: string, untilIso: string): { year: number; month: number }[] {
  const out: { year: number; month: number }[] = [];
  const start = new Date(sinceIso);
  const end = new Date(untilIso);
  let y = start.getUTCFullYear();
  let m = start.getUTCMonth();
  const endKey = end.getUTCFullYear() * 12 + end.getUTCMonth();
  let guard = 0;
  while (y * 12 + m <= endKey && guard++ < 60) {
    out.push({ year: y, month: m + 1 });
    m++;
    if (m > 11) {
      m = 0;
      y++;
    }
  }
  return out;
}

async function* pullBillingUsage(ctx: ConnectorContext, headers: Record<string, string>, url: string, since: string, until: string): AsyncGenerator<RawUsageEvent> {
  for (const { year, month } of monthsInRange(since, until)) {
    let res;
    try {
      res = await requestJson<CopilotBillingUsageResponse>(ctx, url, { headers, query: { year, month }, retries: 2 });
    } catch (err) {
      ctx.log.warn(`github-copilot: failed to fetch billing usage for ${year}-${String(month).padStart(2, '0')}: ${(err as Error).message}`);
      continue;
    }
    const items = (res.body.usageItems ?? []).filter((i) => isCopilotProduct(i.product));
    let i = 0;
    for (const item of items) {
      const ev = mapBillingUsageItem(item, i);
      i++;
      if (!ev) continue;
      if (ev.ts < since || ev.ts >= until) continue;
      yield ev;
    }
  }
}

export const githubCopilotConnector: ApiConnector = {
  kind: 'api',
  id: 'github-copilot',
  displayName: 'GitHub Copilot',
  credentials: [
    {
      key: 'token',
      label: 'GitHub token',
      secret: true,
      envVar: 'GITHUB_TOKEN',
      help: 'A fine-grained PAT / GitHub App token with the "GitHub Copilot Business" organization read permission (classic PAT: manage_billing:copilot + read:org).',
    },
    { key: 'org', label: 'Organization', secret: false, help: 'The GitHub organization login with GitHub Copilot Business/Enterprise, e.g. "my-company".' },
    {
      key: 'enterprise',
      label: 'Enterprise (optional)',
      secret: false,
      optional: true,
      help: 'GitHub Enterprise slug — only needed if Copilot metrics/billing are centralized at the enterprise rather than per-organization.',
    },
  ],

  async verify(ctx, creds) {
    const token = str(creds['token']);
    const org = str(creds['org']);
    if (!token) return { ok: false, message: 'Provide a GitHub token (env GITHUB_TOKEN) with Copilot Business admin read access.' };
    if (!org) return { ok: false, message: 'Provide the GitHub organization login that has GitHub Copilot Business/Enterprise.' };
    try {
      const res = await requestJson<CopilotSeatsPage>(ctx, `${BASE}/orgs/${encodeURIComponent(org)}/copilot/billing/seats`, { headers: githubHeaders(token), query: { per_page: 1 }, retries: 1 });
      const total = res.body.total_seats;
      return { ok: true, message: `Connected to the GitHub Copilot Admin API${typeof total === 'number' ? ` (${total} seat${total === 1 ? '' : 's'})` : ''}.` };
    } catch (err) {
      return {
        ok: false,
        message: describeAuthError(err, {
          unauthorized: 'GitHub token rejected — use a PAT/App token with the "GitHub Copilot Business" organization permission (classic scopes: manage_billing:copilot, read:org)',
          forbidden: `GitHub token lacks Copilot admin access for org "${org}" — Copilot Business/Enterprise must be enabled and the token must belong to an org owner or a user with the Copilot admin role`,
        }),
      };
    }
  },

  async *pull(ctx, creds, opts) {
    const token = str(creds['token']);
    const org = str(creds['org']);
    const enterprise = str(creds['enterprise']);
    if (!token || !org) {
      ctx.log.warn('github-copilot: no token/org credential set, skipping pull');
      return;
    }
    const headers = githubHeaders(token);
    const reportsBase = enterprise ? `${BASE}/enterprises/${encodeURIComponent(enterprise)}` : `${BASE}/orgs/${encodeURIComponent(org)}`;
    // UNVERIFIED (research/other-sources.md §3 only confirms `GET /organizations/{org}/settings/billing/usage`,
    // not an enterprise-scoped path): an enterprise-scoped variant of the billing-usage endpoint is
    // assumed to follow the same {scope}/{id}/settings/billing/usage shape confirmed for the org scope.
    const billingUrl = enterprise ? `${BASE}/enterprises/${encodeURIComponent(enterprise)}/settings/billing/usage` : `${BASE}/organizations/${encodeURIComponent(org)}/settings/billing/usage`;

    // Seats: current snapshot, re-fetched every pull (no window).
    for await (const ev of pullSeats(ctx, headers, org)) yield ev;

    const metricsWindow = resolveWindow(ctx, opts, 'github-copilot:metrics:last_pull', 90);
    const days = isoDayRange(metricsWindow.since, metricsWindow.until);
    ctx.log.debug(`github-copilot: pulling metrics reports for ${days.length} day(s)`);
    for await (const ev of pullUserMetrics(ctx, headers, reportsBase, days)) yield ev;
    markPulled(ctx, 'github-copilot:metrics:last_pull', metricsWindow.until);

    const billingWindow = resolveWindow(ctx, opts, 'github-copilot:billing:last_pull', 90);
    ctx.log.debug(`github-copilot: pulling billing usage ${billingWindow.since}..${billingWindow.until}`);
    for await (const ev of pullBillingUsage(ctx, headers, billingUrl, billingWindow.since, billingWindow.until)) yield ev;
    markPulled(ctx, 'github-copilot:billing:last_pull', billingWindow.until);
  },
};
