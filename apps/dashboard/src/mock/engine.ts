/**
 * The mock "server": turns the generated event log (`generate.ts`) into exactly the
 * response shapes `docs/dashboard-api.md` promises, using the same math the real
 * server uses (`apps/server/src/summary.ts`, `packages/core/src/insights/engine.ts`) —
 * simplified, but not different in kind, so a screenshot of mock mode is honest about
 * what the real product computes.
 *
 * Day keys use UTC throughout (the generator lays out days on UTC boundaries), so the
 * mock reports `timeZone: 'UTC'` and every date computation here is plain UTC math —
 * no Intl timezone juggling needed, and the 60-day series lines up the same regardless
 * of the browser's local timezone.
 */
import type {
  ActorsResponse, Breakdown, Budget, CommonFilters, DeclaredSubscription, EventsResponse, Forecast,
  HealthResponse, Insight, InsightSeverity, InsightsResponse, ModelCatalogEntry, ModelsResponse,
  ScanResponse, Seat, Session, SessionsResponse, SettingsResponse, SummaryResponse, TokenUsage, UsageEvent, WhoamiResponse,
} from '../types';
import { formatPct, formatTokens, formatUsd } from '../format';
import { ACTIVE_MODEL_KEYS, MODEL_CATALOG, PLAN_CATALOG, ACTOR_POOL, findModel } from './catalog';
import { getDataset, type MockDataset } from './generate';
import { isMockEmpty, isMockHosted, isMockTeam } from './flags';

// ------------------------------------------------------------------ dataset

const EMPTY_DATASET: MockDataset = { events: [], subscriptions: [], budgets: [], seats: [], sources: [], lastRuns: [] };

function dataset(): MockDataset {
  return isMockEmpty() ? EMPTY_DATASET : getDataset(isMockTeam());
}

// -------------------------------------------------------------------- time

function todayKeyUtc(now: Date): string {
  return now.toISOString().slice(0, 10);
}
function addDaysKey(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + n)).toISOString().slice(0, 10);
}
function daysInMonthOf(ym: string): number {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y!, m!, 0)).getUTCDate();
}
function weekdayOf(day: string): number {
  return new Date(`${day}T12:00:00Z`).getUTCDay();
}
function prevMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 2, 1)).toISOString().slice(0, 7);
}

function parseSinceExpr(expr: string | undefined, now: Date): string | null {
  const e = (expr ?? '30d').trim().toLowerCase();
  if (e === 'all') return null;
  const today = todayKeyUtc(now);
  if (e === 'today') return `${today}T00:00:00.000Z`;
  if (e === 'month' || e === 'mtd') return `${today.slice(0, 7)}-01T00:00:00.000Z`;
  if (e === 'week' || e === 'wtd') {
    const wd = weekdayOf(today);
    return `${addDaysKey(today, -((wd + 6) % 7))}T00:00:00.000Z`;
  }
  const m = /^(\d+)\s*([hdwmy])$/.exec(e);
  if (m) {
    const n = Number(m[1]);
    const unit = m[2];
    const ms = unit === 'h' ? n * 3600e3 : unit === 'd' ? n * 86400e3 : unit === 'w' ? n * 7 * 86400e3 : unit === 'm' ? n * 30 * 86400e3 : n * 365 * 86400e3;
    return new Date(now.getTime() - ms).toISOString();
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(e)) return `${e}T00:00:00.000Z`;
  const d = new Date(expr ?? '');
  if (!Number.isNaN(d.getTime())) return d.toISOString();
  return `${addDaysKey(today, -30)}T00:00:00.000Z`;
}

function untilExpr(until: string | undefined): string | null {
  if (!until) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(until) ? `${addDaysKey(until, 1)}T00:00:00.000Z` : new Date(until).toISOString();
}

// ------------------------------------------------------------------ usage

function emptyUsage(): TokenUsage {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, reasoning: 0, requests: 0, webSearches: 0, webFetches: 0 };
}
function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite5m: a.cacheWrite5m + b.cacheWrite5m,
    cacheWrite1h: a.cacheWrite1h + b.cacheWrite1h,
    reasoning: (a.reasoning ?? 0) + (b.reasoning ?? 0),
    requests: a.requests + b.requests,
    webSearches: (a.webSearches ?? 0) + (b.webSearches ?? 0),
    webFetches: (a.webFetches ?? 0) + (b.webFetches ?? 0),
  };
}
function contextTokens(u: TokenUsage): number {
  return u.input + u.cacheRead + u.cacheWrite5m + u.cacheWrite1h;
}
function eventUsd(e: UsageEvent): number {
  return e.cost.billedUsd ?? e.cost.computedUsd ?? 0;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
function roundMap(o: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(o)) out[k] = round2(v);
  return out;
}
function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function actorKeyOf(e: UsageEvent): string {
  if (e.actor['userId'] === 'local-user') return 'me';
  return e.actor['email'] ?? e.actor['userId'] ?? 'unknown';
}
function projectOf(e: UsageEvent): string | null {
  const p = e.context['project'];
  return typeof p === 'string' ? p : null;
}

// --------------------------------------------------------------- filtering

function applyFilters(events: UsageEvent[], f: CommonFilters, now: Date): UsageEvent[] {
  const since = parseSinceExpr(f.since, now);
  const until = untilExpr(f.until);
  const providers = f.provider ? f.provider.split(',') : null;
  const sources = f.source ? f.source.split(',') : null;
  return events.filter((e) => {
    if (since && e.ts < since) return false;
    if (until && e.ts >= until) return false;
    if (providers && !providers.includes(e.provider)) return false;
    if (sources && !sources.includes(e.source)) return false;
    if (f.project && projectOf(e) !== f.project) return false;
    if (f.actor && actorKeyOf(e) !== f.actor) return false;
    if (f.billing && e.billing !== f.billing) return false;
    if (f.model && e.model !== f.model) return false;
    return true;
  });
}

// -------------------------------------------------------------- breakdown

interface Row {
  key: string;
  usd: number;
  computedUsd: number;
  billedUsd: number | null;
  events: number;
  usage: TokenUsage;
}

function dimKeyFn(dim: string): (e: UsageEvent) => string | null {
  switch (dim) {
    case 'model':
      return (e) => e.model;
    case 'source':
      return (e) => e.source;
    case 'project':
      return (e) => projectOf(e);
    case 'actor':
      return (e) => actorKeyOf(e);
    case 'surface':
      return (e) => e.surface;
    case 'billing':
      return (e) => e.billing;
    case 'plan':
      return (e) => e.plan ?? null;
    case 'day':
      return (e) => e.ts.slice(0, 10);
    case 'month':
      return (e) => e.ts.slice(0, 7);
    case 'provider':
    default:
      return (e) => e.provider;
  }
}

function groupBy(events: UsageEvent[], keyFn: (e: UsageEvent) => string | null): Row[] {
  const map = new Map<string, Row>();
  for (const e of events) {
    const key = keyFn(e) ?? '(none)';
    const row = map.get(key) ?? { key, usd: 0, computedUsd: 0, billedUsd: null, events: 0, usage: emptyUsage() };
    row.usd += eventUsd(e);
    row.computedUsd += e.cost.computedUsd ?? 0;
    if (e.cost.billedUsd !== null) row.billedUsd = (row.billedUsd ?? 0) + e.cost.billedUsd;
    row.events += 1;
    row.usage = addUsage(row.usage, e.usage);
    map.set(key, row);
  }
  return [...map.values()];
}

function withShare(rows: Row[]): Breakdown[] {
  const total = rows.reduce((a, r) => a + r.usd, 0);
  return rows
    .map((r) => ({ key: r.key, usd: round4(r.usd), computedUsd: round4(r.computedUsd), billedUsd: r.billedUsd === null ? null : round4(r.billedUsd), events: r.events, usage: r.usage, share: total > 0 ? r.usd / total : 0 }))
    .sort((a, b) => b.usd - a.usd);
}

function totalsOf(rows: UsageEvent[]) {
  let usd = 0;
  let computedUsd = 0;
  let billedUsd: number | null = null;
  let usage = emptyUsage();
  for (const e of rows) {
    usd += eventUsd(e);
    computedUsd += e.cost.computedUsd ?? 0;
    if (e.cost.billedUsd !== null) billedUsd = (billedUsd ?? 0) + e.cost.billedUsd;
    usage = addUsage(usage, e.usage);
  }
  return { usd: round4(usd), computedUsd: round4(computedUsd), billedUsd: billedUsd === null ? null : round4(billedUsd), events: rows.length, usage };
}

// -------------------------------------------------------------- forecast

function computeForecast(scoped: UsageEvent[], now: Date): Forecast {
  const today = todayKeyUtc(now);
  const month = today.slice(0, 7);
  const dim = daysInMonthOf(month);
  const dayOfMonth = Number(today.slice(8, 10));
  const mtdUsd = totalsOf(scoped.filter((e) => e.ts.slice(0, 7) === month)).usd;
  const lastMonthRows = scoped.filter((e) => e.ts.slice(0, 7) === prevMonth(month));
  const lastMonthUsd = lastMonthRows.length ? totalsOf(lastMonthRows).usd : null;

  const start = addDaysKey(today, -28);
  const dayUsd = new Map<string, number>();
  for (const e of scoped) {
    const day = e.ts.slice(0, 10);
    if (day >= start && day < today) dayUsd.set(day, (dayUsd.get(day) ?? 0) + eventUsd(e));
  }
  const histDays: string[] = [];
  for (let d = start; d < today; d = addDaysKey(d, 1)) histDays.push(d);
  const daysWithData = histDays.filter((d) => (dayUsd.get(d) ?? 0) > 0).length;
  const overallAvg = histDays.length ? histDays.reduce((a, d) => a + (dayUsd.get(d) ?? 0), 0) / histDays.length : 0;

  const byWeekday = new Map<number, number[]>();
  for (const d of histDays) {
    const wd = weekdayOf(d);
    const arr = byWeekday.get(wd) ?? [];
    arr.push(dayUsd.get(d) ?? 0);
    byWeekday.set(wd, arr);
  }
  const rate = (wd: number): number => {
    const arr = byWeekday.get(wd);
    if (!arr || arr.length < 2) return overallAvg;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  };

  let projected = mtdUsd;
  let method: Forecast['method'] = 'weekday-weighted';
  if (daysWithData < 3) {
    method = 'insufficient-data';
    const elapsed = Math.max(dayOfMonth, 1);
    projected = elapsed > 0 ? (mtdUsd / elapsed) * dim : mtdUsd;
  } else {
    for (let d = dayOfMonth + 1; d <= dim; d++) {
      const key = `${month}-${String(d).padStart(2, '0')}`;
      projected += rate(weekdayOf(key));
    }
    if (daysWithData < 10) method = 'run-rate';
  }
  const confidence: Forecast['confidence'] = daysWithData >= 14 ? 'high' : daysWithData >= 5 ? 'medium' : 'low';
  return {
    month,
    daysElapsed: dayOfMonth,
    daysInMonth: dim,
    mtdUsd: round2(mtdUsd),
    projectedUsd: round2(projected),
    avgDailyUsd: round2(overallAvg),
    lastMonthUsd: lastMonthUsd === null ? null : round2(lastMonthUsd),
    deltaVsLastMonth: lastMonthUsd && lastMonthUsd > 0 ? round2((projected - lastMonthUsd) / lastMonthUsd) : null,
    method,
    confidence,
  };
}

// --------------------------------------------------------- subscriptions

function subscriptionMatches(e: UsageEvent, sub: DeclaredSubscription): boolean {
  if (e.provider !== sub.provider) return false;
  if (sub.appliesTo?.sources && !sub.appliesTo.sources.includes(e.source)) return false;
  if (sub.appliesTo?.actorKeys && !sub.appliesTo.actorKeys.includes(actorKeyOf(e))) return false;
  if (!sub.appliesTo?.sources && e.billing === 'api') return false;
  return true;
}

function computeSubscriptionValue(sub: DeclaredSubscription, scoped: UsageEvent[], now: Date) {
  const today = todayKeyUtc(now);
  const month = today.slice(0, 7);
  const dayOfMonth = Number(today.slice(8, 10));
  const dim = daysInMonthOf(month);
  const mine = scoped.filter((e) => subscriptionMatches(e, sub));
  const mtd = totalsOf(mine.filter((e) => e.ts.slice(0, 7) === month));
  const last = totalsOf(mine.filter((e) => e.ts.slice(0, 7) === prevMonth(month)));
  const projected = dayOfMonth > 0 ? (mtd.computedUsd / dayOfMonth) * dim : mtd.computedUsd;
  const basis = last.computedUsd > 0 ? last.computedUsd : projected;
  const price = sub.priceMonthly * (sub.seats ?? 1);
  const multiple = price > 0 ? basis / price : 0;
  return { subscription: sub, mtdUsd: round2(mtd.computedUsd), projectedUsd: round2(projected), lastMonthUsd: round2(last.computedUsd), multiple: round2(multiple) };
}

function budgetMatches(e: UsageEvent, b: Budget): boolean {
  const s = b.scope;
  if (!s) return true;
  if (s.provider && e.provider !== s.provider) return false;
  if (s.source && e.source !== s.source) return false;
  if (s.project && projectOf(e) !== s.project) return false;
  if (s.actorKey && actorKeyOf(e) !== s.actorKey) return false;
  return true;
}

function computeBudgetValue(b: Budget, scoped: UsageEvent[], now: Date) {
  const fc = computeForecast(scoped.filter((e) => budgetMatches(e, b)), now);
  const usedPct = b.amountUsd > 0 ? fc.mtdUsd / b.amountUsd : 0;
  const projectedPct = b.amountUsd > 0 ? fc.projectedUsd / b.amountUsd : 0;
  return { budget: b, mtdUsd: fc.mtdUsd, projectedUsd: fc.projectedUsd, usedPct: round2(usedPct), projectedPct: round2(projectedPct) };
}

// ----------------------------------------------------------------- days

function enumerateDays(filtered: UsageEvent[], f: CommonFilters, now: Date): string[] {
  const today = todayKeyUtc(now);
  const sinceIso = parseSinceExpr(f.since, now);
  const first = sinceIso ? sinceIso.slice(0, 10) : (filtered[0]?.ts.slice(0, 10) ?? today);
  const last = f.until ? (/^\d{4}-\d{2}-\d{2}$/.test(f.until) ? f.until : f.until.slice(0, 10)) : today;
  const out: string[] = [];
  let cur = first;
  let guard = 0;
  while (cur <= last && guard++ < 400) {
    out.push(cur);
    cur = addDaysKey(cur, 1);
  }
  return out;
}

// -------------------------------------------------------------- endpoints

export function health(): HealthResponse {
  const ds = dataset();
  const first = ds.events[0]?.ts ?? null;
  const last = ds.events[ds.events.length - 1]?.ts ?? null;
  // Hosted is team-shaped (bearer/JWT auth, no unauthenticated db stats) even without `&team=1`;
  // `?mock=1&team=1` and `?mock=1&empty=1` (neither hosted) are untouched by this.
  const teamLike = isMockTeam() || isMockHosted();
  return {
    ok: true,
    version: '0.2.0-mock',
    mode: teamLike ? 'team' : 'local',
    timeZone: 'UTC',
    db: { events: ds.events.length, first, last },
    pricingVersion: '2026-09-03',
    authRequired: teamLike,
    ...(isMockHosted() ? { auth: { kind: 'supabase' as const } } : {}),
  };
}

function selectedMockOrgId(): string | null {
  try {
    return localStorage.getItem('clai_org');
  } catch {
    return null;
  }
}

const MOCK_ORGS = [
  { id: 'org_mock', name: "Aria's org" },
  { id: 'org_mock_2', name: 'Acme Inc' },
];

export function whoami(): WhoamiResponse {
  if (isMockHosted()) {
    return {
      actorKey: 'aria@clai.dev',
      role: 'admin',
      label: 'Aria Chen',
      email: 'aria@clai.dev',
      orgId: selectedMockOrgId() ?? MOCK_ORGS[0]!.id,
      orgs: MOCK_ORGS,
      plan: 'free',
      billingStatus: null,
      upgradeUrl: 'https://buy.stripe.com/mock-plus-monthly',
      portalUrl: null,
      tosAccepted: true,
    };
  }
  if (isMockTeam()) return { actorKey: 'aria@clai.dev', role: 'admin', label: 'Aria Chen' };
  return { actorKey: 'me', role: 'admin', label: 'local' };
}

// ------------------------------------------------------------- hosted auth

export function authLink(email: string, tosAccepted: boolean): { sent: boolean } {
  return { sent: Boolean(email.trim()) && tosAccepted };
}

/** Mock accepts any hash/type, per the "Hosted extensions" appendix. */
export function authVerify(_tokenHash: string, _type: string): { token: string; refreshToken: string } {
  return { token: 'clai_mock_hosted_token', refreshToken: 'clai_mock_hosted_refresh' };
}

export function deviceApprove(_userCode: string, _orgId: string): { approved: boolean } {
  return { approved: true };
}

export function mintMachineToken(label: string): { token: string; actorKey: string; role: 'admin' | 'member' } {
  return { token: `clai_mem_mock_${label.replace(/\s+/g, '-').toLowerCase()}_${Math.random().toString(36).slice(2, 8)}`, actorKey: 'aria@clai.dev', role: 'member' };
}

export function summary(f: CommonFilters, now: Date = new Date()): SummaryResponse {
  const all = dataset().events;
  const filtered = applyFilters(all, f, now);
  const scope: CommonFilters = { ...f, since: undefined, until: undefined };
  const scoped = applyFilters(all, scope, now);

  const today = todayKeyUtc(now);
  const month = today.slice(0, 7);
  const last = prevMonth(month);
  const todayT = totalsOf(scoped.filter((e) => e.ts.slice(0, 10) === today));
  const monthT = totalsOf(scoped.filter((e) => e.ts.slice(0, 7) === month));
  const lastT = totalsOf(scoped.filter((e) => e.ts.slice(0, 7) === last));

  const dayKeys = enumerateDays(filtered, f, now);
  const byDay = new Map<string, { usd: number; events: number; byProvider: Record<string, number> }>();
  for (const e of filtered) {
    const day = e.ts.slice(0, 10);
    const usd = eventUsd(e);
    const d = byDay.get(day) ?? { usd: 0, events: 0, byProvider: {} };
    d.usd += usd;
    d.events += 1;
    d.byProvider[e.provider] = (d.byProvider[e.provider] ?? 0) + usd;
    byDay.set(day, d);
  }
  const daily = dayKeys.map((day) => {
    const d = byDay.get(day);
    return { day, usd: round2(d?.usd ?? 0), events: d?.events ?? 0, byProvider: roundMap(d?.byProvider ?? {}) };
  });

  return {
    range: { since: parseSinceExpr(f.since, now), until: f.until ?? null, timeZone: 'UTC' },
    totals: totalsOf(filtered),
    today: { usd: todayT.usd, events: todayT.events },
    thisMonth: { usd: monthT.usd, events: monthT.events },
    lastMonth: { usd: lastT.usd, events: lastT.events },
    forecast: computeForecast(scoped, now),
    byProvider: withShare(groupBy(filtered, dimKeyFn('provider'))),
    byModel: withShare(groupBy(filtered, dimKeyFn('model'))),
    bySource: withShare(groupBy(filtered, dimKeyFn('source'))),
    byProject: withShare(groupBy(filtered, dimKeyFn('project'))),
    bySurface: withShare(groupBy(filtered, dimKeyFn('surface'))),
    byBilling: withShare(groupBy(filtered, dimKeyFn('billing'))),
    daily,
    subscriptions: subsRef().map((s) => computeSubscriptionValue(s, scoped, now)),
    budgets: budgetsRef().map((b) => computeBudgetValue(b, scoped, now)),
  };
}

export function breakdown(dim: string, f: CommonFilters, limit: number, now: Date = new Date()): { dim: string; rows: Breakdown[] } {
  const filtered = applyFilters(dataset().events, f, now);
  return { dim, rows: withShare(groupBy(filtered, dimKeyFn(dim))).slice(0, limit) };
}

export function sessions(f: CommonFilters, limit: number, now: Date = new Date()): SessionsResponse {
  const filtered = applyFilters(dataset().events, f, now);
  const map = new Map<string, UsageEvent[]>();
  for (const e of filtered) {
    const sid = typeof e.context['sessionId'] === 'string' ? (e.context['sessionId'] as string) : `evt:${e.id}`;
    const arr = map.get(sid) ?? [];
    arr.push(e);
    map.set(sid, arr);
  }
  const list: Session[] = [];
  for (const [sessionId, rows] of map) {
    rows.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
    const first = rows[0]!;
    const lastRow = rows[rows.length - 1]!;
    const usage = rows.reduce((a, e) => addUsage(a, e.usage), emptyUsage());
    const usd = rows.reduce((a, e) => a + eventUsd(e), 0);
    const maxContext = rows.reduce((m, e) => Math.max(m, contextTokens(e.usage)), 0);
    list.push({
      sessionId,
      started: first.ts,
      ended: lastRow.ts,
      project: projectOf(first),
      source: first.source,
      provider: first.provider,
      models: [...new Set(rows.map((e) => e.model))],
      usd: round4(usd),
      events: rows.length,
      usage,
      maxContext,
    });
  }
  list.sort((a, b) => (a.started < b.started ? 1 : a.started > b.started ? -1 : 0));
  return { sessions: list.slice(0, limit) };
}

export function events(f: CommonFilters, limit: number, now: Date = new Date()): EventsResponse {
  const filtered = applyFilters(dataset().events, f, now);
  const sorted = [...filtered].sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
  return { events: sorted.slice(0, limit) };
}

export function models(f: CommonFilters, now: Date = new Date()): ModelsResponse {
  const filtered = applyFilters(dataset().events, f, now);
  const used = new Map(groupBy(filtered, dimKeyFn('model')).map((r) => [r.key, r]));
  const rows: ModelCatalogEntry[] = MODEL_CATALOG.map((m) => {
    const u = used.get(m.id);
    return {
      key: m.id,
      displayName: m.displayName,
      provider: m.provider,
      tier: m.tier,
      input: m.input,
      output: m.output,
      cacheRead: m.cacheRead,
      cacheWrite5m: m.cacheWrite5m,
      cacheWrite1h: m.cacheWrite1h,
      contextWindow: m.contextWindow,
      verified: m.verified,
      retired: m.retired,
      usd: round4(u?.usd ?? 0),
      events: u?.events ?? 0,
      usage: u?.usage ?? emptyUsage(),
    };
  });
  rows.sort((a, b) => b.usd - a.usd || a.key.localeCompare(b.key));
  return { models: rows };
}

function actorDisplay(key: string): Record<string, unknown> {
  if (key === 'me') return { name: 'You' };
  const found = ACTOR_POOL.find((a) => a.key === key);
  return found ? { name: found.name, email: found.email } : { email: key };
}

export function actors(f: CommonFilters, now: Date = new Date()): ActorsResponse {
  const filtered = applyFilters(dataset().events, { ...f, since: f.since ?? '90d' }, now);
  const rows = groupBy(filtered, dimKeyFn('actor'));
  const seatMap = new Map(seatsRef().map((s) => [s.actorKey, s]));
  const span = new Map<string, { first: string; last: string }>();
  for (const e of filtered) {
    const key = actorKeyOf(e);
    const day = e.ts.slice(0, 10);
    const cur = span.get(key);
    if (!cur) span.set(key, { first: day, last: day });
    else {
      if (day < cur.first) cur.first = day;
      if (day > cur.last) cur.last = day;
    }
  }
  const list = rows.map((r) => {
    const s = span.get(r.key);
    return { actorKey: r.key, actor: actorDisplay(r.key), firstDay: s?.first ?? null, lastDay: s?.last ?? null, usd: round4(r.usd), events: r.events, usage: r.usage, seat: seatMap.get(r.key) ?? null };
  });
  list.sort((a, b) => b.usd - a.usd);
  return { actors: list };
}

export function settings(): SettingsResponse {
  const ds = dataset();
  return {
    mode: isMockTeam() ? 'team' : 'local',
    timeZone: 'UTC',
    pricingVersion: '2026-09-03',
    subscriptions: subsRef(),
    budgets: budgetsRef(),
    seats: seatsRef(),
    sources: ds.sources,
    lastRuns: ds.lastRuns,
    plans: PLAN_CATALOG,
  };
}

export function scan(): ScanResponse {
  return { results: dataset().sources.map((s) => ({ source: s.source, seen: s.events, inserted: 0, updated: 0, unpriced: 0, error: null })) };
}

// ------------------------------------------------------------- insights

function insightScope(f: CommonFilters, now: Date): UsageEvent[] {
  return applyFilters(dataset().events, { provider: f.provider, source: f.source, project: f.project, actor: f.actor, billing: f.billing, model: f.model, since: '90d' }, now);
}

function budgetInsightsList(scoped: UsageEvent[], now: Date): Insight[] {
  return budgetsRef().map((b) => {
    const v = computeBudgetValue(b, scoped, now);
    let severity: InsightSeverity = 'info';
    let title = `Budget "${b.name}": ${formatPct(v.usedPct)} used`;
    let action: string | undefined;
    let impact: number | undefined;
    if (v.usedPct >= 1) {
      severity = 'critical';
      title = `Budget "${b.name}" exceeded (${formatPct(v.usedPct)})`;
      action = 'Spending has already passed the budget this month.';
      impact = round2(v.projectedUsd - b.amountUsd);
    } else if (v.projectedPct > 1) {
      severity = 'warning';
      title = `Budget "${b.name}" projected to overrun by ${formatUsd(v.projectedUsd - b.amountUsd)}`;
      action = 'Reduce usage or raise the budget before month end.';
      impact = round2(v.projectedUsd - b.amountUsd);
    }
    return {
      id: `budget:${b.id}`,
      kind: 'budget',
      severity,
      title,
      detail: `${formatUsd(v.mtdUsd)} of ${formatUsd(b.amountUsd)} used; projected ${formatUsd(v.projectedUsd)} (${formatPct(v.projectedPct)}).`,
      action,
      impactUsdPerMonth: impact,
      evidence: { budget: b, mtdUsd: v.mtdUsd, projectedUsd: v.projectedUsd, usedPct: v.usedPct, projectedPct: v.projectedPct },
    };
  });
}

function subscriptionInsightsList(scoped: UsageEvent[], now: Date): Insight[] {
  return subsRef()
    .filter((s) => s.priceMonthly * (s.seats ?? 1) > 0)
    .map((sub) => {
      const v = computeSubscriptionValue(sub, scoped, now);
      const label = sub.label ?? `${sub.provider} ${sub.plan}`;
      const price = sub.priceMonthly * (sub.seats ?? 1);
      let severity: InsightSeverity = 'info';
      let title: string;
      let action: string | undefined;
      let impact: number | undefined;
      if (v.mtdUsd === 0 && v.lastMonthUsd === 0) {
        severity = 'warning';
        title = `${label}: no usage recorded`;
        action = 'If this plan is unused, cancel it or reassign the seat.';
        impact = price;
      } else if (v.multiple < 0.5) {
        severity = 'opportunity';
        title = `${label} returns ${v.multiple.toFixed(1)}x its price in API-equivalent usage`;
        action = `A cheaper plan or pay-as-you-go API would likely save ${formatUsd(price - (v.lastMonthUsd || v.projectedUsd))}/month.`;
        impact = round2(price - (v.lastMonthUsd || v.projectedUsd));
      } else if (v.multiple >= 3) {
        title = `${label} delivers ${v.multiple.toFixed(1)}x its price`;
        action = `The plan saves you roughly ${formatUsd((v.lastMonthUsd || v.projectedUsd) - price)}/month versus API list price.`;
      } else {
        title = `${label} delivers ${v.multiple.toFixed(1)}x its price`;
        action = 'Fair value. Keep the plan; watch the weekly limit if you hit it often.';
      }
      return {
        id: `subscription:${sub.id}`,
        kind: 'subscription_value',
        severity,
        title,
        detail: `Month to date: ${formatUsd(v.mtdUsd)} of API-equivalent usage. Projected ${formatUsd(v.projectedUsd)} for the month${v.lastMonthUsd > 0 ? `; last month ${formatUsd(v.lastMonthUsd)}` : ''}.`,
        action,
        impactUsdPerMonth: impact,
        evidence: { subscription: sub, priceMonthly: price, mtdUsd: v.mtdUsd, projectedUsd: v.projectedUsd, lastMonthUsd: v.lastMonthUsd, multiple: v.multiple },
      };
    });
}

function forecastInsightList(scoped: UsageEvent[], now: Date): Insight[] {
  const f = computeForecast(scoped, now);
  if (f.mtdUsd === 0 && f.projectedUsd === 0) return [];
  const delta = f.deltaVsLastMonth;
  const trend = delta === null ? '' : delta > 0.15 ? ` That is ${formatPct(delta)} above last month.` : delta < -0.15 ? ` That is ${formatPct(-delta)} below last month.` : ' Roughly flat versus last month.';
  return [
    {
      id: `forecast:${f.month}`,
      kind: 'forecast',
      severity: delta !== null && delta > 0.5 ? 'warning' : 'info',
      title: `On track for ${formatUsd(f.projectedUsd)} this month`,
      detail: `${formatUsd(f.mtdUsd)} so far across ${f.daysElapsed} of ${f.daysInMonth} days; ${formatUsd(f.avgDailyUsd)}/day on average over the last four weeks.${trend}`,
      evidence: { ...f },
    },
  ];
}

function anomalyInsightsList(scoped: UsageEvent[], now: Date): Insight[] {
  const today = todayKeyUtc(now);
  const start = addDaysKey(today, -30);
  const byDay = new Map<string, number>();
  for (const e of scoped) {
    const d = e.ts.slice(0, 10);
    if (d >= start && d <= today) byDay.set(d, (byDay.get(d) ?? 0) + eventUsd(e));
  }
  const days: string[] = [];
  for (let d = start; d <= today; d = addDaysKey(d, 1)) days.push(d);
  const series = days.map((day) => ({ day, usd: byDay.get(day) ?? 0 }));
  const out: Insight[] = [];
  for (let i = 7; i < series.length; i++) {
    const day = series[i]!;
    if (day.usd < 2) continue;
    const window = series.slice(Math.max(0, i - 14), i).map((d) => d.usd);
    const med = median(window);
    const mad = median(window.map((x) => Math.abs(x - med))) * 1.4826;
    const threshold = med + Math.max(3 * mad, 0.5 * med, 2);
    if (day.usd <= threshold || med === 0) continue;
    const ratio = med > 0 ? day.usd / med : Infinity;
    out.push({
      id: `anomaly:${day.day}`,
      kind: 'anomaly',
      severity: day.day === today ? 'warning' : 'info',
      title: `${day.day}: ${formatUsd(day.usd)} spent, ${ratio === Infinity ? 'far' : `${ratio.toFixed(1)}x`} above the typical ${formatUsd(med)}`,
      detail: 'Daily spend spiked well above the trailing two-week median for this slice.',
      evidence: { day: day.day, usd: round2(day.usd), medianUsd: round2(med) },
    });
  }
  return out.sort((a, b) => String(b.evidence['day']).localeCompare(String(a.evidence['day']))).slice(0, 5);
}

function idleSeatInsightsList(scoped: UsageEvent[], now: Date): Insight[] {
  const seats = seatsRef();
  if (seats.length === 0) return [];
  const idleDays = 30;
  const since = addDaysKey(todayKeyUtc(now), -idleDays);
  const lastSeen = new Map<string, string>();
  for (const e of scoped) {
    const key = actorKeyOf(e);
    const day = e.ts.slice(0, 10);
    const prev = lastSeen.get(key);
    if (!prev || day > prev) lastSeen.set(key, day);
  }
  // <= (not <): a seat whose last activity IS the boundary day has had no activity in the `idleDays` since — matches the People-page row highlight.
  const idle = seats.filter((s) => (lastSeen.get(s.actorKey) ?? '') <= since);
  if (idle.length === 0) return [];
  const waste = round2(idle.reduce((a, s) => a + s.priceMonthly, 0));
  return [
    {
      id: 'idle_seats',
      kind: 'idle_seat',
      severity: 'opportunity',
      title: `${idle.length} of ${seats.length} paid seats had no activity in ${idleDays} days`,
      detail: idle.map((s) => `${s.label ?? s.actorKey} (${s.provider} ${s.plan}, ${formatUsd(s.priceMonthly)}/mo${lastSeen.get(s.actorKey) ? `, last seen ${lastSeen.get(s.actorKey)}` : ', never seen'})`).join('; '),
      action: `Reassign or cancel idle seats to save ${formatUsd(waste)} per month.`,
      impactUsdPerMonth: waste,
      evidence: { idle: idle.map((s) => ({ actorKey: s.actorKey, lastSeen: lastSeen.get(s.actorKey) ?? null, priceMonthly: s.priceMonthly })), idleDays },
    },
  ];
}

function concentrationInsightsList(scoped: UsageEvent[]): Insight[] {
  const total = scoped.reduce((a, e) => a + eventUsd(e), 0);
  if (total < 5) return [];
  const rows = withShare(groupBy(scoped, dimKeyFn('project')));
  if (rows.length < 3) return [];
  const top = rows[0]!;
  if (top.share < 0.5) return [];
  return [
    {
      id: 'concentration:project',
      kind: 'concentration',
      severity: 'info',
      title: `${top.key} drives ${formatPct(top.share)} of spend`,
      detail: `${formatUsd(top.usd)} of ${formatUsd(total)} across ${rows.length} projects.`,
      evidence: { project: top.key, share: round2(top.share), usd: round2(top.usd), projects: rows.length },
    },
  ];
}

function cacheOpportunityInsightsList(scoped: UsageEvent[]): Insight[] {
  const apiRows = scoped.filter((e) => e.billing !== 'subscription');
  const out: Insight[] = [];
  for (const modelKey of ACTIVE_MODEL_KEYS) {
    const rows = apiRows.filter((e) => e.model === modelKey);
    if (rows.length === 0) continue;
    const usage = rows.reduce((a, e) => addUsage(a, e.usage), emptyUsage());
    const ctx = contextTokens(usage);
    if (ctx < 2_000_000) continue;
    const hit = ctx > 0 ? usage.cacheRead / ctx : 0;
    if (hit >= 0.3) continue;
    const price = findModel(modelKey);
    const cacheable = usage.input * 0.5;
    const savings = round2((cacheable / 1_000_000) * (price.input - price.cacheRead));
    if (savings < 2) continue;
    out.push({
      id: `cache:${modelKey}`,
      kind: 'cache_efficiency',
      severity: 'opportunity',
      title: `${price.displayName} traffic has a ${formatPct(hit)} cache hit rate`,
      detail: `${formatTokens(usage.input)} uncached input tokens vs ${formatTokens(usage.cacheRead)} cache reads. Repeated system prompts and tool definitions are prime caching candidates.`,
      action: `Enable prompt caching on the stable prefix. If half the input is cacheable, that saves about ${formatUsd(savings)} per period.`,
      impactUsdPerMonth: savings,
      evidence: { model: modelKey, hitRate: round2(hit), inputTokens: usage.input, cacheReadTokens: usage.cacheRead, estimatedSavingsUsd: savings },
    });
  }
  return out;
}

function unpricedInsightsList(scoped: UsageEvent[]): Insight[] {
  const bad = scoped.filter((e) => e.cost.confidence === 'none');
  if (bad.length === 0) return [];
  const byModel = new Map<string, number>();
  for (const e of bad) byModel.set(e.model, (byModel.get(e.model) ?? 0) + 1);
  const models_ = [...byModel.entries()].map(([key, ev]) => ({ key, events: ev }));
  return [
    {
      id: 'unpriced',
      kind: 'unpriced_model',
      severity: 'warning',
      title: `${models_.length} model${models_.length > 1 ? 's' : ''} could not be priced`,
      detail: `${models_.map((m) => `${m.key} (${m.events} events)`).join(', ')}. Their cost is shown as $0.`,
      action: 'Run `clai pricing update` to refresh the catalog, or add the model to pricing overrides.',
      evidence: { models: models_ },
    },
  ];
}

export function insights(f: CommonFilters, now: Date = new Date()): InsightsResponse {
  const scoped = insightScope(f, now);
  const rank: Record<InsightSeverity, number> = { critical: 0, warning: 1, opportunity: 2, info: 3 };
  const list = [
    ...budgetInsightsList(scoped, now),
    ...subscriptionInsightsList(scoped, now),
    ...forecastInsightList(scoped, now),
    ...anomalyInsightsList(scoped, now),
    ...idleSeatInsightsList(scoped, now),
    ...concentrationInsightsList(scoped),
    ...cacheOpportunityInsightsList(scoped),
    ...unpricedInsightsList(scoped),
  ].sort((a, b) => rank[a.severity] - rank[b.severity] || (b.impactUsdPerMonth ?? 0) - (a.impactUsdPerMonth ?? 0));
  return { insights: list, generatedAt: now.toISOString() };
}

// ------------------------------------------------------- mutable settings

function cacheKey(name: string): string {
  return `clai_mock_${name}_${isMockTeam() ? 'team' : 'local'}${isMockEmpty() ? '_empty' : ''}`;
}
function loadMutable<T>(name: string, seed: T): T {
  try {
    const raw = localStorage.getItem(cacheKey(name));
    if (raw) return JSON.parse(raw) as T;
  } catch {
    /* ignore */
  }
  return seed;
}
function saveMutable<T>(name: string, val: T): void {
  try {
    localStorage.setItem(cacheKey(name), JSON.stringify(val));
  } catch {
    /* ignore */
  }
}

let cachedModeKey = '';
let subs: DeclaredSubscription[] = [];
let budgets: Budget[] = [];
let seats: Seat[] = [];

function ensureLoaded(): void {
  const modeKey = `${isMockTeam()}-${isMockEmpty()}`;
  if (cachedModeKey !== modeKey) {
    cachedModeKey = modeKey;
    subs = loadMutable('subscriptions', dataset().subscriptions);
    budgets = loadMutable('budgets', dataset().budgets);
    seats = loadMutable('seats', dataset().seats);
  }
}
function subsRef(): DeclaredSubscription[] {
  ensureLoaded();
  return subs;
}
function budgetsRef(): Budget[] {
  ensureLoaded();
  return budgets;
}
function seatsRef(): Seat[] {
  ensureLoaded();
  return seats;
}

function newId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

export function addSubscription(body: Partial<DeclaredSubscription>): { subscriptions: DeclaredSubscription[] } {
  ensureLoaded();
  const plan = PLAN_CATALOG.find((p) => p.provider === body.provider && p.plan === body.plan);
  const sub: DeclaredSubscription = {
    id: body.id ?? newId('sub'),
    provider: body.provider ?? 'anthropic',
    plan: body.plan ?? 'pro',
    label: body.label ?? plan?.display,
    priceMonthly: typeof body.priceMonthly === 'number' ? body.priceMonthly : (plan?.priceMonthly ?? 0),
    seats: body.seats,
    appliesTo: body.appliesTo,
  };
  const idx = subs.findIndex((s) => s.id === sub.id);
  if (idx >= 0) subs[idx] = sub;
  else subs.push(sub);
  saveMutable('subscriptions', subs);
  return { subscriptions: [...subs] };
}
export function removeSubscription(id: string): { subscriptions: DeclaredSubscription[] } {
  ensureLoaded();
  subs = subs.filter((s) => s.id !== id);
  saveMutable('subscriptions', subs);
  return { subscriptions: [...subs] };
}
export function addBudget(body: Partial<Budget>): { budgets: Budget[] } {
  ensureLoaded();
  const b: Budget = { id: body.id ?? newId('bud'), name: body.name ?? 'Untitled budget', amountUsd: typeof body.amountUsd === 'number' ? body.amountUsd : 0, period: 'month', scope: body.scope };
  const idx = budgets.findIndex((x) => x.id === b.id);
  if (idx >= 0) budgets[idx] = b;
  else budgets.push(b);
  saveMutable('budgets', budgets);
  return { budgets: [...budgets] };
}
export function removeBudget(id: string): { budgets: Budget[] } {
  ensureLoaded();
  budgets = budgets.filter((b) => b.id !== id);
  saveMutable('budgets', budgets);
  return { budgets: [...budgets] };
}
export function addSeat(body: Partial<Seat>): { seats: Seat[] } {
  ensureLoaded();
  const plan = PLAN_CATALOG.find((p) => p.provider === body.provider && p.plan === body.plan);
  const seat: Seat = { actorKey: body.actorKey ?? newId('actor'), label: body.label, provider: body.provider ?? 'anthropic', plan: body.plan ?? 'pro', priceMonthly: typeof body.priceMonthly === 'number' ? body.priceMonthly : (plan?.priceMonthly ?? 0) };
  const idx = seats.findIndex((s) => s.actorKey === seat.actorKey);
  if (idx >= 0) seats[idx] = seat;
  else seats.push(seat);
  saveMutable('seats', seats);
  return { seats: [...seats] };
}
export function removeSeat(actorKey: string): { seats: Seat[] } {
  ensureLoaded();
  seats = seats.filter((s) => s.actorKey !== actorKey);
  saveMutable('seats', seats);
  return { seats: [...seats] };
}
