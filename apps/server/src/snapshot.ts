import { dirname, sep } from 'node:path';
import { addDays, dayKey, providerLabel, sourceProvider, type Insight, type PricingCatalog, type TokenUsage } from '@claii/core';
import { apiConnectors, importConnectors, localConnectors } from '@claii/connectors';
import type { EventStore } from '@claii/store';
import type { RunResult } from './runner.js';
import { computeInsights, computeSummary, type Breakdown } from './summary.js';

/**
 * One JSON document with everything a glanceable surface shows: the Mac menu bar app reads it
 * from `clai snapshot`, and a widget or statusline could too. Bump `schema` on any breaking
 * change; adding fields is not breaking. The Swift decoder test reads the fixture written by
 * snapshot.test.ts, so both sides see the same shape.
 */
export const SNAPSHOT_SCHEMA = 1;

/** How the month's figure was arrived at (docs/design-principles.md rule 4). */
export type SnapshotBasis = 'api-equivalent' | 'billed' | 'mixed';

export interface SnapshotPeriod {
  usd: number;
  events: number;
}

export interface SnapshotSlice {
  key: string;
  label: string;
  /** The provider whose colour the row takes, when there is exactly one. */
  provider: string | null;
  usd: number;
  share: number;
  events: number;
  tokens: number;
}

export interface SnapshotSource {
  id: string;
  label: string;
  found: boolean;
  summary: string;
  inserted: number;
  error: string | null;
}

export interface SnapshotPlan {
  id: string;
  provider: string;
  plan: string;
  label: string;
  priceMonthly: number;
  mtdUsd: number;
  projectedUsd: number;
  lastMonthUsd: number;
  multiple: number;
}

export interface SnapshotBudget {
  id: string;
  name: string;
  amountUsd: number;
  mtdUsd: number;
  projectedUsd: number;
  usedPct: number;
  projectedPct: number;
}

export interface SnapshotInsight {
  id: string;
  kind: string;
  severity: Insight['severity'];
  title: string;
  detail: string;
  action: string | null;
  impactUsdPerMonth: number | null;
}

export interface SnapshotPlanOption {
  provider: string;
  plan: string;
  label: string;
  priceMonthly: number;
}

export interface Snapshot {
  schema: typeof SNAPSHOT_SCHEMA;
  generatedAt: string;
  engineVersion: string;
  timeZone: string;
  pricingVersion: string;
  events: { total: number; first: string | null; last: string | null };
  /** Present when the snapshot ran a local scan first (`clai snapshot --scan`). */
  scan: { durationMs: number; inserted: number; sources: SnapshotSource[]; watchPaths: string[] } | null;
  today: SnapshotPeriod & { day: string };
  yesterday: SnapshotPeriod & { day: string };
  last7Days: SnapshotPeriod;
  month: SnapshotPeriod & { key: string; daysElapsed: number; daysInMonth: number; tokens: number; billedUsd: number | null; basis: SnapshotBasis };
  lastMonth: SnapshotPeriod & { key: string };
  forecast: { projectedUsd: number; avgDailyUsd: number; deltaVsLastMonth: number | null; method: string; confidence: string };
  /** The last 30 days, today included, ascending, zero days filled. */
  daily: { day: string; usd: number; events: number; byProvider: Record<string, number> }[];
  /** Month to date. */
  providers: SnapshotSlice[];
  tools: SnapshotSlice[];
  models: SnapshotSlice[];
  projects: SnapshotSlice[];
  plans: SnapshotPlan[];
  budgets: SnapshotBudget[];
  /** Ranked, most pressing first; forecast, plan value and budgets have their own fields. */
  insights: SnapshotInsight[];
  /** Individual paid plans from the catalog, for a plan picker. */
  planOptions: SnapshotPlanOption[];
}

export interface SnapshotOptions {
  engineVersion: string;
  now?: Date;
  /** Results of a local scan that ran just before, to report detection and new events. */
  scan?: { results: RunResult[]; durationMs: number } | null;
  /** Rows per ranked list (models, projects). */
  limit?: number;
}

const HIDDEN_INSIGHT_KINDS = new Set(['forecast', 'subscription_value', 'budget']);
const SEVERITY_RANK: Record<Insight['severity'], number> = { critical: 3, warning: 2, opportunity: 1, info: 0 };

export async function computeSnapshot(store: EventStore, catalog: PricingCatalog, opts: SnapshotOptions): Promise<Snapshot> {
  const now = opts.now ?? new Date();
  const tz = store.timeZone;
  const limit = opts.limit ?? 6;
  const today = dayKey(now.toISOString(), tz);
  const month = await computeSummary(store, catalog, { since: 'month', now });
  // Day-aligned: 29 days back plus today, so the chart always has 30 whole days.
  const recent = await computeSummary(store, catalog, { since: addDays(today, -29), now });
  const daily = recent.daily.slice(-30);
  const insights = await computeInsights(store, catalog, { now });
  const total = await store.countEvents();
  const span = await store.span();

  const yesterdayKey = addDays(today, -1);
  const yesterday = daily.find((d) => d.day === yesterdayKey);
  const last7 = daily.slice(-7);
  const fc = month.forecast;
  const lastMonthKey = previousMonth(today.slice(0, 7));

  return {
    schema: SNAPSHOT_SCHEMA,
    generatedAt: now.toISOString(),
    engineVersion: opts.engineVersion,
    timeZone: tz,
    pricingVersion: catalog.version,
    events: { total, first: span.first, last: span.last },
    scan: opts.scan ? scanSection(opts.scan.results, opts.scan.durationMs) : null,
    today: { day: today, usd: month.today.usd, events: month.today.events },
    yesterday: { day: yesterdayKey, usd: yesterday?.usd ?? 0, events: yesterday?.events ?? 0 },
    last7Days: { usd: round4(last7.reduce((a, d) => a + d.usd, 0)), events: last7.reduce((a, d) => a + d.events, 0) },
    month: {
      key: today.slice(0, 7),
      usd: month.thisMonth.usd,
      events: month.thisMonth.events,
      daysElapsed: fc.daysElapsed,
      daysInMonth: fc.daysInMonth,
      tokens: totalTokens(month.totals.usage),
      billedUsd: month.totals.billedUsd,
      basis: basisOf(month.totals.usd, month.totals.billedUsd),
    },
    lastMonth: { key: lastMonthKey, usd: month.lastMonth.usd, events: month.lastMonth.events },
    forecast: { projectedUsd: round4(fc.projectedUsd), avgDailyUsd: round4(fc.avgDailyUsd), deltaVsLastMonth: fc.deltaVsLastMonth === null ? null : round4(fc.deltaVsLastMonth), method: fc.method, confidence: fc.confidence },
    daily,
    providers: month.byProvider.map((b) => slice(b, providerLabel(b.key), b.key)),
    tools: month.bySource.map((b) => slice(b, sourceLabel(b.key), sourceProvider(b.key))),
    models: month.byModel.slice(0, limit).map((b) => {
      const model = catalog.models.find((m) => m.id === b.key);
      return slice(b, model?.displayName ?? b.key, model?.provider ?? null);
    }),
    projects: month.byProject.slice(0, limit).map((b) => slice(b, b.key === '(none)' ? 'No project' : b.key, null)),
    plans: month.subscriptions.map((p) => ({
      id: p.subscription.id,
      provider: p.subscription.provider,
      plan: p.subscription.plan,
      label: p.subscription.label ?? planLabel(catalog, p.subscription.provider, p.subscription.plan),
      priceMonthly: p.subscription.priceMonthly,
      mtdUsd: round4(p.mtdUsd),
      projectedUsd: round4(p.projectedUsd),
      lastMonthUsd: round4(p.lastMonthUsd),
      multiple: round2(p.multiple),
    })),
    budgets: month.budgets.map((b) => ({
      id: b.budget.id,
      name: b.budget.name,
      amountUsd: b.budget.amountUsd,
      mtdUsd: round4(b.mtdUsd),
      projectedUsd: round4(b.projectedUsd),
      usedPct: round4(b.usedPct),
      projectedPct: round4(b.projectedPct),
    })),
    insights: rankInsights(insights).slice(0, 5),
    planOptions: catalog.subscriptions
      .filter((s) => !s.seatBased && typeof s.priceMonthly === 'number' && s.priceMonthly > 0)
      .map((s) => ({ provider: s.provider, plan: s.plan, label: s.display, priceMonthly: s.priceMonthly as number })),
  };
}

/** Most pressing first: severity, then money at stake. Kinds with their own snapshot field are left out. */
export function rankInsights(insights: Insight[]): SnapshotInsight[] {
  return insights
    .filter((i) => !HIDDEN_INSIGHT_KINDS.has(i.kind))
    .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || (b.impactUsdPerMonth ?? 0) - (a.impactUsdPerMonth ?? 0))
    .map((i) => ({
      id: i.id,
      kind: i.kind,
      severity: i.severity,
      title: i.title,
      detail: i.detail,
      action: i.action ?? null,
      impactUsdPerMonth: i.impactUsdPerMonth === undefined ? null : round2(i.impactUsdPerMonth),
    }));
}

export function basisOf(usd: number, billedUsd: number | null): SnapshotBasis {
  if (billedUsd === null || billedUsd === 0) return 'api-equivalent';
  return Math.abs(usd - billedUsd) < 0.005 ? 'billed' : 'mixed';
}

/**
 * Folders worth watching for new usage: unique, nested paths folded into their parent, and many
 * siblings (one Cline task folder each) folded into their common parent.
 */
export function watchRoots(paths: string[], max = 8): string[] {
  const unique = [...new Set(paths.filter(Boolean))].sort();
  const roots = unique.filter((p) => !unique.some((q) => q !== p && p.startsWith(q.endsWith(sep) ? q : q + sep)));
  if (roots.length <= max) return roots;
  const byParent = new Map<string, string[]>();
  for (const p of roots) byParent.set(dirname(p), [...(byParent.get(dirname(p)) ?? []), p]);
  const folded = [...byParent.entries()].flatMap(([parent, kids]) => (kids.length > 1 ? [parent] : kids));
  return folded.length < roots.length ? watchRoots(folded, max) : folded.slice(0, max);
}

function scanSection(results: RunResult[], durationMs: number): NonNullable<Snapshot['scan']> {
  const local = results.filter((r) => r.found !== undefined);
  return {
    durationMs,
    inserted: results.reduce((a, r) => a + r.inserted, 0),
    sources: local.map((r) => ({ id: r.source, label: sourceLabel(r.source), found: !!r.found, summary: r.detail ?? '', inserted: r.inserted, error: r.error })),
    watchPaths: watchRoots(local.filter((r) => r.found).flatMap((r) => r.paths ?? [])),
  };
}

const CONNECTOR_NAMES = new Map<string, string>([...localConnectors, ...apiConnectors, ...importConnectors].map((c) => [c.id, c.displayName]));

function sourceLabel(id: string): string {
  return CONNECTOR_NAMES.get(id) ?? id;
}

function planLabel(catalog: PricingCatalog, provider: string, plan: string): string {
  return catalog.subscriptions.find((s) => s.provider === provider && s.plan === plan)?.display ?? `${providerLabel(provider)} ${plan}`;
}

function slice(b: Breakdown, label: string, provider: string | null): SnapshotSlice {
  return { key: b.key, label, provider, usd: round4(b.usd), share: round4(b.share), events: b.events, tokens: totalTokens(b.usage) };
}

function totalTokens(u: TokenUsage): number {
  return u.input + u.output + u.cacheRead + u.cacheWrite5m + u.cacheWrite1h;
}

function previousMonth(yyyyMm: string): string {
  const [y, m] = yyyyMm.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 2, 1)).toISOString().slice(0, 7);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
