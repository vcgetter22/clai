import {
  addDays,
  budgetInsights,
  dayKey,
  daysInMonth,
  forecast,
  generateInsights,
  parseSince,
  subscriptionValueInsights,
  type Budget,
  type DeclaredSubscription,
  type Forecast,
  type Insight,
  type InsightContext,
  type PricingCatalog,
  type TokenUsage,
} from '@claii/core';
import type { EventFilter, EventStore } from '@claii/store';

export interface Breakdown {
  key: string;
  usd: number;
  computedUsd: number;
  billedUsd: number | null;
  events: number;
  usage: TokenUsage;
  share: number;
}

export interface Summary {
  range: { since: string | null; until: string | null; timeZone: string };
  totals: { usd: number; computedUsd: number; billedUsd: number | null; events: number; usage: TokenUsage };
  today: { usd: number; events: number };
  thisMonth: { usd: number; events: number };
  lastMonth: { usd: number; events: number };
  forecast: Forecast;
  byProvider: Breakdown[];
  byModel: Breakdown[];
  bySource: Breakdown[];
  byProject: Breakdown[];
  bySurface: Breakdown[];
  byBilling: Breakdown[];
  daily: { day: string; usd: number; events: number; byProvider: Record<string, number> }[];
  subscriptions: { subscription: DeclaredSubscription; mtdUsd: number; projectedUsd: number; lastMonthUsd: number; multiple: number }[];
  budgets: { budget: Budget; mtdUsd: number; projectedUsd: number; usedPct: number; projectedPct: number }[];
}

export interface QueryOptions {
  since?: string;
  until?: string;
  provider?: string;
  source?: string;
  project?: string;
  actor?: string;
  billing?: string;
  model?: string;
  now?: Date;
}

export function toFilter(q: QueryOptions, timeZone: string): EventFilter {
  const now = q.now ?? new Date();
  const f: EventFilter = {};
  const since = parseSince(q.since ?? '30d', now, timeZone);
  if (since) f.since = since;
  if (q.until) {
    const u = /^\d{4}-\d{2}-\d{2}$/.test(q.until) ? parseSince(addDays(q.until, 1), now, timeZone) : new Date(q.until).toISOString();
    if (u) f.until = u;
  }
  if (q.provider) f.provider = q.provider.split(',') as EventFilter['provider'];
  if (q.source) f.source = q.source.split(',') as EventFilter['source'];
  if (q.project) f.project = q.project;
  if (q.actor) f.actorKey = q.actor;
  if (q.billing) f.billing = q.billing as EventFilter['billing'];
  if (q.model) f.model = q.model;
  return f;
}

export function insightContext(store: EventStore, catalog: PricingCatalog, now = new Date()): InsightContext {
  return {
    now,
    timeZone: store.timeZone,
    catalog,
    subscriptions: store.listSubscriptions(),
    budgets: store.listBudgets(),
    seats: store.listSeats(),
  };
}

function withShare(rows: { key: string; usd: number; computedUsd: number; billedUsd: number | null; events: number; usage: TokenUsage }[]): Breakdown[] {
  const total = rows.reduce((a, r) => a + r.usd, 0);
  return rows.map((r) => ({ ...r, share: total > 0 ? r.usd / total : 0 }));
}

/** Everything the overview needs, computed with the same filters the CLI uses. */
export function computeSummary(store: EventStore, catalog: PricingCatalog, q: QueryOptions = {}): Summary {
  const now = q.now ?? new Date();
  const tz = store.timeZone;
  const filter = toFilter(q, tz);
  const today = dayKey(now.toISOString(), tz);
  const month = today.slice(0, 7);
  const lastMonthKey = (() => {
    const [y, m] = month.split('-').map(Number);
    return new Date(Date.UTC(y!, m! - 2, 1)).toISOString().slice(0, 7);
  })();
  const scope = { ...filter, since: undefined, until: undefined } as EventFilter;
  delete scope.since;
  delete scope.until;

  const totals = store.total(filter);
  const todayT = store.total({ ...scope, fromDay: today, toDay: today });
  const monthT = store.total({ ...scope, fromDay: `${month}-01`, toDay: `${month}-${String(daysInMonth(month)).padStart(2, '0')}` });
  const lastT = store.total({ ...scope, fromDay: `${lastMonthKey}-01`, toDay: `${lastMonthKey}-${String(daysInMonth(lastMonthKey)).padStart(2, '0')}` });

  // Forecast and plan/budget math need ~90 days of history regardless of the display range.
  const histRows = store.rows({ ...scope, fromDay: addDays(today, -95) }, { bySession: false });
  const ctx = insightContext(store, catalog, now);
  const fc = forecast(histRows, ctx);

  const subs = subscriptionValueInsights(histRows, ctx).map((i) => ({
    subscription: i.evidence['subscription'] as DeclaredSubscription,
    mtdUsd: Number(i.evidence['mtdUsd'] ?? 0),
    projectedUsd: Number(i.evidence['projectedUsd'] ?? 0),
    lastMonthUsd: Number(i.evidence['lastMonthUsd'] ?? 0),
    multiple: Number(i.evidence['multiple'] ?? 0),
  }));
  const budgets = budgetInsights(histRows, ctx).map((i) => ({
    budget: i.evidence['budget'] as Budget,
    mtdUsd: Number(i.evidence['mtdUsd'] ?? 0),
    projectedUsd: Number(i.evidence['projectedUsd'] ?? 0),
    usedPct: Number(i.evidence['usedPct'] ?? 0),
    projectedPct: Number(i.evidence['projectedPct'] ?? 0),
  }));

  // Daily series filled for the whole range.
  const rangeRows = store.rows(filter, { bySession: false });
  const byDay = new Map<string, { usd: number; events: number; byProvider: Record<string, number> }>();
  for (const r of rangeRows) {
    const d = byDay.get(r.day) ?? { usd: 0, events: 0, byProvider: {} };
    const usd = r.billedUsd ?? r.computedUsd;
    d.usd += usd;
    d.events += r.events;
    d.byProvider[r.provider] = (d.byProvider[r.provider] ?? 0) + usd;
    byDay.set(r.day, d);
  }
  const firstDay = filter.since ? dayKey(filter.since, tz) : (rangeRows[0]?.day ?? today);
  const lastDay = filter.until ? dayKey(new Date(Date.parse(filter.until) - 1).toISOString(), tz) : today;
  const daily: Summary['daily'] = [];
  let cur = firstDay;
  let guard = 0;
  while (cur <= lastDay && guard++ < 5000) {
    const d = byDay.get(cur);
    daily.push({ day: cur, usd: round2(d?.usd ?? 0), events: d?.events ?? 0, byProvider: mapRound(d?.byProvider ?? {}) });
    cur = addDays(cur, 1);
  }

  return {
    range: { since: filter.since ?? null, until: filter.until ?? null, timeZone: tz },
    totals: { usd: round4(totals.usd), computedUsd: round4(totals.computedUsd), billedUsd: totals.billedUsd === null ? null : round4(totals.billedUsd), events: totals.events, usage: totals.usage },
    today: { usd: round4(todayT.usd), events: todayT.events },
    thisMonth: { usd: round4(monthT.usd), events: monthT.events },
    lastMonth: { usd: round4(lastT.usd), events: lastT.events },
    forecast: fc,
    byProvider: withShare(store.totalsBy('provider', filter)),
    byModel: withShare(store.totalsBy('model', filter, 100)),
    bySource: withShare(store.totalsBy('source', filter)),
    byProject: withShare(store.totalsBy('project', filter, 100)),
    bySurface: withShare(store.totalsBy('surface', filter)),
    byBilling: withShare(store.totalsBy('billing', filter)),
    daily,
    subscriptions: subs,
    budgets,
  };
}

export function computeInsights(store: EventStore, catalog: PricingCatalog, q: QueryOptions = {}): Insight[] {
  const now = q.now ?? new Date();
  const filter = toFilter({ ...q, since: q.since ?? '90d' }, store.timeZone);
  const rows = store.rows(filter);
  return generateInsights(rows, insightContext(store, catalog, now));
}

export function breakdown(store: EventStore, dim: string, q: QueryOptions, limit = 50): Breakdown[] {
  const filter = toFilter(q, store.timeZone);
  const col = dim === 'actor' ? 'actor_key' : dim;
  const allowed = ['day', 'month', 'provider', 'model', 'source', 'project', 'actor_key', 'surface', 'billing', 'plan', 'session_id'];
  if (!allowed.includes(col)) throw new Error(`Unknown dimension "${dim}". Use one of: ${allowed.map((a) => (a === 'actor_key' ? 'actor' : a)).join(', ')}`);
  return withShare(store.totalsBy(col as Parameters<EventStore['totalsBy']>[0], filter, limit));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
function mapRound(o: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(o)) out[k] = round2(v);
  return out;
}
