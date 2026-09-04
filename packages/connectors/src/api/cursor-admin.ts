import type { RawUsageEvent } from '@claii/core';
import { emptyUsage } from '@claii/core';
import type { ApiConnector, ConnectorContext } from '../types.js';
import { num, str } from '../util/files.js';
import { basicAuthHeader, compact, compactTags, describeAuthError, markPulled, requestJson, resolveWindow } from './http.js';

/**
 * Cursor Admin API (`https://api.cursor.com`) — team usage events, daily per-user usage, and the
 * team roster, for Cursor Business/Enterprise teams. Auth is HTTP Basic: the Admin API key as the
 * username, empty password (NOT a Bearer token).
 *
 * Source: research/other-sources.md §2 ("Cursor" / "Admin API (Business/Enterprise)"), fetched from
 * cursor.com/docs/account/teams/admin-api. Endpoint methods, request body fields, and response
 * envelope names below are taken from that section. Every read still goes through `num()`/`str()`
 * (defaults gracefully) with a couple of alternate envelope keys tried, so a renamed/missing field
 * degrades to 0/undefined instead of throwing — the research doc itself doesn't mark this section
 * UNVERIFIED (it's sourced from Cursor's own docs), but the defensive parsing is kept anyway as
 * cheap insurance against future API changes.
 */

const BASE = 'https://api.cursor.com';

function cursorHeaders(apiKey: string): Record<string, string> {
  return { Authorization: basicAuthHeader(apiKey, ''), 'Content-Type': 'application/json' };
}

/** Cursor timestamps (event `timestamp`, daily `date`) are epoch milliseconds, as a number or a numeric string. */
function parseCursorTimestamp(v: string | number | undefined): string | null {
  if (v === undefined || v === null) return null;
  const ms = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// ---- GET /teams/members — team roster, used only to attach a display name to actor.email -------

interface CursorMember {
  id?: string;
  email?: string;
  name?: string;
  role?: string;
  isRemoved?: boolean;
}

/** Envelope key confirmed as `teamMembers` (research/other-sources.md §2); `members`/`data` kept as defensive fallbacks. */
interface CursorMembersResponse {
  teamMembers?: CursorMember[];
  members?: CursorMember[];
  data?: CursorMember[];
}

async function loadMembers(ctx: ConnectorContext, headers: Record<string, string>): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    // GET, not POST — `/teams/members` is documented as a plain GET roster lookup.
    const res = await requestJson<CursorMembersResponse>(ctx, `${BASE}/teams/members`, { method: 'GET', headers, retries: 2 });
    const rows = res.body.teamMembers ?? res.body.members ?? res.body.data ?? [];
    for (const m of rows) {
      const email = str(m.email);
      const name = str(m.name);
      if (email && name) map.set(email, name);
    }
  } catch (err) {
    ctx.log.warn(`cursor-admin: failed to load team members: ${(err as Error).message}`);
  }
  return map;
}

// ---- POST /teams/filtered-usage-events — one row per model call ------------------------------

interface CursorTokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheWriteTokens?: number;
  cacheReadTokens?: number;
  /** $ cost of this token usage, nested inside `tokenUsage` per research/other-sources.md §2. */
  totalCents?: number;
  discountPercentOff?: number;
}

interface CursorUsageEvent {
  timestamp?: string | number;
  userEmail?: string;
  model?: string;
  /** e.g. `"Included in Business"` / `"Usage-based"` — free text, not an enum we can rely on beyond a substring match. */
  kind?: string;
  maxMode?: boolean;
  requestsCosts?: number;
  isTokenBasedCall?: boolean;
  isChargeable?: boolean;
  isHeadless?: boolean;
  tokenUsage?: CursorTokenUsage;
  /** Top-level, sibling of `tokenUsage` — the amount actually charged (may differ from `tokenUsage.totalCents`
   * when a call isn't chargeable, e.g. covered by an included allotment). Preferred over `totalCents` below. */
  chargedCents?: number;
  cursorTokenFee?: number;
}

/** Envelope confirmed as `usageEvents` (research/other-sources.md §2); `events`/`data` kept as defensive fallbacks. `totalUsageEventsCount` (also confirmed) lets pagination stop precisely instead of relying on a short final page. */
interface CursorUsageEventsResponse {
  usageEvents?: CursorUsageEvent[];
  events?: CursorUsageEvent[];
  data?: CursorUsageEvent[];
  totalUsageEventsCount?: number;
}

function isUsageBasedEvent(row: CursorUsageEvent): boolean {
  return row.isTokenBasedCall === true || /usage.?based/i.test(row.kind ?? '');
}

export function mapUsageEvent(row: CursorUsageEvent, indexInPage: number, memberNames: Map<string, string>): RawUsageEvent | null {
  const ts = parseCursorTimestamp(row.timestamp);
  if (!ts) return null;
  const model = str(row.model) ?? 'unknown';
  const email = str(row.userEmail);
  const kind = str(row.kind);
  const tu = row.tokenUsage ?? {};
  // `chargedCents` (top-level) is the amount actually billed; `tokenUsage.totalCents` is the $ cost
  // of the token usage itself and is used only as a fallback when `chargedCents` is absent. A call
  // explicitly marked not chargeable (e.g. covered by an included allotment / error retry) bills $0
  // regardless of either figure.
  const cents = typeof row.chargedCents === 'number' ? row.chargedCents : tu.totalCents;
  const billedUsd = row.isChargeable === false ? 0 : typeof cents === 'number' ? cents / 100 : null;
  return {
    ts,
    source: 'cursor-admin',
    provider: 'cursor',
    model,
    surface: 'ide',
    billing: isUsageBasedEvent(row) ? 'api' : 'subscription',
    granularity: 'request',
    actor: compact({ email, name: email ? memberNames.get(email) : undefined }),
    context: { tags: compactTags({ kind, maxMode: row.maxMode === undefined ? undefined : String(row.maxMode) }) },
    usage: {
      input: num(tu.inputTokens),
      output: num(tu.outputTokens),
      cacheRead: num(tu.cacheReadTokens),
      cacheWrite5m: num(tu.cacheWriteTokens),
      cacheWrite1h: 0,
      requests: 1,
    },
    cost: billedUsd !== null ? { billedUsd, currency: 'USD', confidence: 'billed' } : undefined,
    meta: compact({
      requestsCosts: row.requestsCosts,
      isChargeable: row.isChargeable,
      isHeadless: row.isHeadless,
      cursorTokenFee: row.cursorTokenFee,
      discountPercentOff: tu.discountPercentOff,
    }),
    naturalKey: [ts, email ?? '', model, kind ?? '', String(indexInPage)],
  };
}

async function* pullUsageEvents(ctx: ConnectorContext, apiKey: string, since: string, until: string, memberNames: Map<string, string>): AsyncGenerator<RawUsageEvent> {
  const headers = cursorHeaders(apiKey);
  const pageSize = 200;
  // UNVERIFIED (research/other-sources.md §2 doesn't state 0- vs 1-based page numbering): assuming
  // 1-based `page`, the common REST convention; the stop condition below only relies on the page
  // eventually coming back short/empty, so an off-by-one in the base would at worst repeat or skip
  // page 0, not loop forever.
  let page = 1;
  let guard = 0;
  for (;;) {
    const res = await requestJson<CursorUsageEventsResponse>(ctx, `${BASE}/teams/filtered-usage-events`, {
      method: 'POST',
      headers,
      body: { startDate: Date.parse(since), endDate: Date.parse(until), page, pageSize },
    });
    const rows = res.body.usageEvents ?? res.body.events ?? res.body.data ?? [];
    let i = 0;
    for (const row of rows) {
      const ev = mapUsageEvent(row, i, memberNames);
      i++;
      if (ev) yield ev;
    }
    guard++;
    const total = res.body.totalUsageEventsCount;
    const exhaustedByCount = typeof total === 'number' && page * pageSize >= total;
    if (rows.length === 0 || rows.length < pageSize || exhaustedByCount || guard > 500) break;
    page++;
  }
}

// ---- POST /teams/daily-usage-data — one row per user per day ----------------------------------

interface CursorDailyUsageRow {
  userId?: string | number;
  date?: string | number;
  email?: string;
  /** Only present when the request is paginated (`page`/`pageSize` supplied) — research/other-sources.md §2. */
  isActive?: boolean;
  totalLinesAdded?: number;
  totalLinesDeleted?: number;
  acceptedLinesAdded?: number;
  acceptedLinesDeleted?: number;
  totalTabsShown?: number;
  totalTabsAccepted?: number;
  composerRequests?: number;
  chatRequests?: number;
  agentRequests?: number;
  cmdkUsages?: number;
  subscriptionIncludedReqs?: number;
  apiKeyReqs?: number;
  usageBasedReqs?: number;
  mostUsedModel?: string;
  clientVersion?: string;
}

interface CursorDailyUsageResponse {
  data?: CursorDailyUsageRow[];
  dailyData?: CursorDailyUsageRow[];
}

export function mapDailyRow(row: CursorDailyUsageRow, memberNames: Map<string, string>): RawUsageEvent | null {
  const ts = parseCursorTimestamp(row.date);
  if (!ts) return null;
  const email = str(row.email);
  const userId = str(row.userId !== undefined ? String(row.userId) : undefined);
  const mostUsedModel = str(row.mostUsedModel);
  // `cmdkUsages` is a distinct request-type bucket alongside composer/chat/agent (research/other-sources.md §2).
  const requests = num(row.composerRequests) + num(row.chatRequests) + num(row.agentRequests) + num(row.cmdkUsages);
  return {
    ts,
    source: 'cursor-admin',
    provider: 'cursor',
    model: mostUsedModel ?? 'unknown',
    surface: 'ide',
    // This aggregate mixes subscription-included and usage-based requests with no per-row cost
    // breakdown, unlike filtered-usage-events, so billing is left unknown rather than guessed.
    billing: 'unknown',
    granularity: 'day',
    actor: compact({ email, userId, name: email ? memberNames.get(email) : undefined }),
    context: {},
    usage: { ...emptyUsage(), requests },
    meta: compact({
      linesAdded: row.totalLinesAdded,
      linesDeleted: row.totalLinesDeleted,
      acceptedLinesAdded: row.acceptedLinesAdded,
      acceptedLinesDeleted: row.acceptedLinesDeleted,
      tabsShown: row.totalTabsShown,
      tabsAccepted: row.totalTabsAccepted,
      cmdkUsages: row.cmdkUsages,
      subscriptionIncludedReqs: row.subscriptionIncludedReqs,
      apiKeyReqs: row.apiKeyReqs,
      usageBasedReqs: row.usageBasedReqs,
      mostUsedModel,
      clientVersion: str(row.clientVersion),
      isActive: row.isActive,
    }),
    naturalKey: ['daily', ts.slice(0, 10), email ?? userId ?? ''],
  };
}

async function* pullDailyUsage(ctx: ConnectorContext, apiKey: string, since: string, until: string, memberNames: Map<string, string>): AsyncGenerator<RawUsageEvent> {
  const headers = cursorHeaders(apiKey);
  // Documented as taking optional `page`/`pageSize`, with a note that ranges beyond ~90 days need
  // paginating (research/other-sources.md §2) — mirror the same page-until-short-page loop used for
  // filtered-usage-events rather than assuming a single response covers the whole window.
  const pageSize = 500;
  let page = 1;
  let guard = 0;
  for (;;) {
    const res = await requestJson<CursorDailyUsageResponse>(ctx, `${BASE}/teams/daily-usage-data`, {
      method: 'POST',
      headers,
      body: { startDate: Date.parse(since), endDate: Date.parse(until), page, pageSize },
    });
    const rows = res.body.data ?? res.body.dailyData ?? [];
    for (const row of rows) {
      const ev = mapDailyRow(row, memberNames);
      if (ev) yield ev;
    }
    guard++;
    if (rows.length === 0 || rows.length < pageSize || guard > 500) break;
    page++;
  }
}

export const cursorAdminConnector: ApiConnector = {
  kind: 'api',
  id: 'cursor-admin',
  displayName: 'Cursor Admin API',
  credentials: [
    {
      key: 'apiKey',
      label: 'Admin API key',
      secret: true,
      envVar: 'CURSOR_API_KEY',
      help: 'Cursor dashboard -> Settings -> Cursor Admin -> Admin API Keys. Sent as an HTTP Basic-auth username with an empty password (not a Bearer token).',
    },
  ],

  async verify(ctx, creds) {
    const apiKey = str(creds['apiKey']);
    if (!apiKey) return { ok: false, message: 'Provide a Cursor Admin API key (Cursor dashboard -> Settings -> Cursor Admin -> Admin API Keys).' };
    try {
      const res = await requestJson<CursorMembersResponse>(ctx, `${BASE}/teams/members`, { method: 'GET', headers: cursorHeaders(apiKey), retries: 1 });
      const rows = res.body.teamMembers ?? res.body.members ?? res.body.data ?? [];
      return { ok: true, message: `Connected to the Cursor Admin API (${rows.length} team member${rows.length === 1 ? '' : 's'} visible).` };
    } catch (err) {
      return {
        ok: false,
        message: describeAuthError(err, {
          unauthorized: 'Cursor API key rejected — create one from the Cursor dashboard (Settings -> Cursor Admin -> Admin API Keys); it is sent as the Basic-auth username with an empty password, not a Bearer token',
          forbidden: 'Cursor API key lacks access — Admin API keys are only available to team admins on a Business/Enterprise plan',
        }),
      };
    }
  },

  async *pull(ctx, creds, opts) {
    const apiKey = str(creds['apiKey']);
    if (!apiKey) {
      ctx.log.warn('cursor-admin: no apiKey credential set, skipping pull');
      return;
    }
    const headers = cursorHeaders(apiKey);
    const memberNames = await loadMembers(ctx, headers);

    const eventsWindow = resolveWindow(ctx, opts, 'cursor-admin:events:last_pull', 90);
    ctx.log.debug(`cursor-admin: pulling filtered-usage-events ${eventsWindow.since}..${eventsWindow.until}`);
    for await (const ev of pullUsageEvents(ctx, apiKey, eventsWindow.since, eventsWindow.until, memberNames)) yield ev;
    markPulled(ctx, 'cursor-admin:events:last_pull', eventsWindow.until);

    const dailyWindow = resolveWindow(ctx, opts, 'cursor-admin:daily:last_pull', 90);
    ctx.log.debug(`cursor-admin: pulling daily-usage-data ${dailyWindow.since}..${dailyWindow.until}`);
    for await (const ev of pullDailyUsage(ctx, apiKey, dailyWindow.since, dailyWindow.until, memberNames)) yield ev;
    markPulled(ctx, 'cursor-admin:daily:last_pull', dailyWindow.until);
  },
};
