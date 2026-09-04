import { addUsage, emptyUsage, type BillingMode, type ProviderId, type SourceId, type Surface, type TokenUsage, type UsageEvent } from './types.js';
import { dayKey } from './time.js';

/**
 * The aggregate row shape shared by the store (SQL GROUP BY) and the insights engine.
 * One row = one (day, provider, model, source, surface, billing, plan, actor, project, session) cell.
 */
export interface AggRow {
  day: string;
  provider: ProviderId;
  /** Canonical model key when priced, else the raw model id. */
  model: string;
  source: SourceId;
  surface: Surface;
  billing: BillingMode;
  plan: string | null;
  /** Stable actor key: email > userId > apiKeyId > 'me'. */
  actorKey: string;
  project: string | null;
  sessionId: string | null;
  usage: TokenUsage;
  computedUsd: number;
  billedUsd: number | null;
  events: number;
  /** Max context tokens seen in a single request within this cell (request-level sources only). */
  maxContext: number;
  /** Number of request-level events whose context exceeded 200k tokens. */
  longContextEvents: number;
  /** True if at least one event in the cell had an unpriced model. */
  unpriced: boolean;
}

export function actorKeyOf(e: Pick<UsageEvent, 'actor'>): string {
  return e.actor.email ?? e.actor.userId ?? e.actor.apiKeyId ?? 'me';
}

export function rowCost(r: Pick<AggRow, 'billedUsd' | 'computedUsd'>): number {
  return r.billedUsd ?? r.computedUsd;
}

/** In-memory aggregation used by tests, small imports and the sync path. */
export function aggregateEvents(events: Iterable<UsageEvent>, timeZone?: string): AggRow[] {
  const cells = new Map<string, AggRow>();
  for (const e of events) {
    const day = dayKey(e.ts, timeZone);
    const model = e.modelKey ?? e.model;
    const actorKey = actorKeyOf(e);
    const project = e.context.project ?? e.actor.projectName ?? e.actor.workspaceName ?? null;
    const sessionId = e.context.sessionId ?? null;
    const key = [day, e.provider, model, e.source, e.surface, e.billing, e.plan ?? '', actorKey, project ?? '', sessionId ?? ''].join('');
    let row = cells.get(key);
    if (!row) {
      row = {
        day,
        provider: e.provider,
        model,
        source: e.source,
        surface: e.surface,
        billing: e.billing,
        plan: e.plan ?? null,
        actorKey,
        project,
        sessionId,
        usage: emptyUsage(),
        computedUsd: 0,
        billedUsd: null,
        events: 0,
        maxContext: 0,
        longContextEvents: 0,
        unpriced: false,
      };
      cells.set(key, row);
    }
    row.usage = addUsage(row.usage, e.usage);
    row.computedUsd += e.cost.computedUsd ?? 0;
    if (e.cost.billedUsd !== null) row.billedUsd = (row.billedUsd ?? 0) + e.cost.billedUsd;
    row.events += 1;
    const ctx = e.usage.input + e.usage.cacheRead + e.usage.cacheWrite5m + e.usage.cacheWrite1h;
    if (e.granularity === 'request' || e.granularity === 'message') {
      row.maxContext = Math.max(row.maxContext, ctx);
      if (ctx > 200_000) row.longContextEvents += 1;
    }
    if (e.modelKey === null) row.unpriced = true;
  }
  return [...cells.values()].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}

export interface GroupTotal {
  key: string;
  usd: number;
  usage: TokenUsage;
  events: number;
  rows: number;
}

/** Group rows by an arbitrary key and total them. */
export function groupRows(rows: AggRow[], keyFn: (r: AggRow) => string | null | undefined): GroupTotal[] {
  const out = new Map<string, GroupTotal>();
  for (const r of rows) {
    const k = keyFn(r);
    if (k === null || k === undefined) continue;
    let g = out.get(k);
    if (!g) {
      g = { key: k, usd: 0, usage: emptyUsage(), events: 0, rows: 0 };
      out.set(k, g);
    }
    g.usd += rowCost(r);
    g.usage = addUsage(g.usage, r.usage);
    g.events += r.events;
    g.rows += 1;
  }
  return [...out.values()].sort((a, b) => b.usd - a.usd);
}

export function sumRows(rows: AggRow[]): { usd: number; computedUsd: number; billedUsd: number; usage: TokenUsage; events: number } {
  let usd = 0;
  let computedUsd = 0;
  let billedUsd = 0;
  let usage = emptyUsage();
  let events = 0;
  for (const r of rows) {
    usd += rowCost(r);
    computedUsd += r.computedUsd;
    billedUsd += r.billedUsd ?? 0;
    usage = addUsage(usage, r.usage);
    events += r.events;
  }
  return { usd, computedUsd, billedUsd, usage, events };
}

/** Daily totals (USD) as a sorted array of {day, usd}. Missing days are filled with 0 when from/to given. */
export function dailyTotals(rows: AggRow[], from?: string, to?: string): { day: string; usd: number }[] {
  const map = new Map<string, number>();
  for (const r of rows) map.set(r.day, (map.get(r.day) ?? 0) + rowCost(r));
  const days = [...map.keys()].sort();
  const start = from ?? days[0];
  const end = to ?? days[days.length - 1];
  if (!start || !end) return [];
  const out: { day: string; usd: number }[] = [];
  let cur = start;
  let guard = 0;
  while (cur <= end && guard++ < 5000) {
    out.push({ day: cur, usd: map.get(cur) ?? 0 });
    const [y, mo, d] = cur.split('-').map(Number);
    cur = new Date(Date.UTC(y!, mo! - 1, d! + 1)).toISOString().slice(0, 10);
  }
  return out;
}
