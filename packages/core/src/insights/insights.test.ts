import { describe, expect, it } from 'vitest';
import { aggregateEvents } from '../aggregate.js';
import { finalizeEvent } from '../events.js';
import { CATALOG } from '../pricing/catalog.js';
import { emptyUsage, type RawUsageEvent } from '../types.js';
import { anomalyInsights, budgetInsights, forecast, generateInsights, idleSeatInsights, modelMixInsights, subscriptionValueInsights } from './engine.js';
import type { InsightContext } from './types.js';

const NOW = new Date('2026-09-15T12:00:00Z');
const TZ = 'UTC';

function ev(partial: Partial<RawUsageEvent> & { ts: string; model: string; input?: number; output?: number; cacheRead?: number }): RawUsageEvent {
  return {
    ts: partial.ts,
    source: partial.source ?? 'claude-code',
    provider: partial.provider ?? 'anthropic',
    model: partial.model,
    surface: partial.surface ?? 'cli-agent',
    billing: partial.billing ?? 'subscription',
    plan: partial.plan,
    granularity: partial.granularity ?? 'request',
    actor: partial.actor ?? {},
    context: partial.context ?? { sessionId: 's1', project: 'proj' },
    usage: { ...emptyUsage(), input: partial.input ?? 0, output: partial.output ?? 0, cacheRead: partial.cacheRead ?? 0, requests: 1 },
  };
}

function ctx(over: Partial<InsightContext> = {}): InsightContext {
  return { now: NOW, timeZone: TZ, catalog: CATALOG, subscriptions: [], budgets: [], seats: [], ...over };
}

/** 30 days of steady Opus usage: 1M input + 100k output per day => $7.50/day. */
function steadyMonth(): RawUsageEvent[] {
  const out: RawUsageEvent[] = [];
  for (let d = 1; d <= 46; d++) {
    const day = new Date(Date.UTC(2026, 7, d, 10)); // Aug 1 .. Sep 15
    if (day > NOW) break;
    out.push(ev({ ts: day.toISOString(), model: 'claude-opus-5', input: 1_000_000, output: 100_000, context: { sessionId: `s${d}`, project: 'proj' } }));
  }
  return out;
}

function rowsOf(raws: RawUsageEvent[]) {
  return aggregateEvents(raws.map((r) => finalizeEvent(r, CATALOG).event), TZ);
}

describe('forecast', () => {
  it('projects month-end from steady usage', () => {
    const f = forecast(rowsOf(steadyMonth()), ctx());
    expect(f.month).toBe('2026-09');
    expect(f.daysElapsed).toBe(15);
    expect(f.mtdUsd).toBeCloseTo(7.5 * 15, 1);
    expect(f.projectedUsd).toBeCloseTo(7.5 * 30, 0);
    expect(f.lastMonthUsd).toBeCloseTo(7.5 * 31, 1);
    expect(f.confidence).toBe('high');
  });
  it('reports insufficient data on a single day', () => {
    const f = forecast(rowsOf([ev({ ts: '2026-09-15T10:00:00Z', model: 'claude-opus-5', input: 1_000_000 })]), ctx());
    expect(f.method).toBe('insufficient-data');
    expect(f.projectedUsd).toBeGreaterThan(f.mtdUsd);
  });
});

describe('subscriptionValueInsights', () => {
  it('flags a plan that returns less than half its price', () => {
    const rows = rowsOf([ev({ ts: '2026-09-10T10:00:00Z', model: 'claude-sonnet-5', input: 100_000, output: 10_000 })]); // ~$0.30
    const [i] = subscriptionValueInsights(rows, ctx({ subscriptions: [{ id: 'max', provider: 'anthropic', plan: 'max_20x', priceMonthly: 200 }] }));
    expect(i?.severity).toBe('opportunity');
    expect(i?.impactUsdPerMonth).toBeGreaterThan(150);
  });
  it('celebrates a plan that returns 3x+', () => {
    const rows = rowsOf(steadyMonth()); // $232/mo last month on a $20 plan
    const [i] = subscriptionValueInsights(rows, ctx({ subscriptions: [{ id: 'pro', provider: 'anthropic', plan: 'pro', priceMonthly: 20 }] }));
    expect(i?.severity).toBe('info');
    expect(i?.title).toMatch(/delivers/);
    expect((i?.evidence['multiple'] as number) > 3).toBe(true);
  });
  it('ignores API-billed usage by default', () => {
    const rows = rowsOf([ev({ ts: '2026-09-10T10:00:00Z', model: 'claude-opus-5', input: 10_000_000, billing: 'api', source: 'anthropic-admin', surface: 'api' })]);
    const [i] = subscriptionValueInsights(rows, ctx({ subscriptions: [{ id: 'max', provider: 'anthropic', plan: 'max_20x', priceMonthly: 200 }] }));
    expect(i?.title).toMatch(/no usage/);
  });
});

describe('budgetInsights', () => {
  it('warns when projected to overrun', () => {
    const rows = rowsOf(steadyMonth());
    const [i] = budgetInsights(rows, ctx({ budgets: [{ id: 'b', name: 'AI', amountUsd: 150, period: 'month' }] }));
    expect(i?.severity).toBe('warning');
    expect(i?.impactUsdPerMonth).toBeGreaterThan(50);
  });
  it('is critical when exceeded', () => {
    const rows = rowsOf(steadyMonth());
    const [i] = budgetInsights(rows, ctx({ budgets: [{ id: 'b', name: 'AI', amountUsd: 50, period: 'month' }] }));
    expect(i?.severity).toBe('critical');
  });
});

describe('anomalyInsights', () => {
  it('detects a spike day', () => {
    const raws = steadyMonth();
    raws.push(ev({ ts: '2026-09-12T10:00:00Z', model: 'claude-opus-5', input: 20_000_000, output: 2_000_000, context: { sessionId: 'spike', project: 'big-refactor' } }));
    const out = anomalyInsights(rowsOf(raws), ctx());
    expect(out.length).toBe(1);
    expect(out[0]!.evidence['day']).toBe('2026-09-12');
    expect(out[0]!.evidence['topProject']).toBe('big-refactor');
  });
  it('is quiet on steady usage', () => {
    expect(anomalyInsights(rowsOf(steadyMonth()), ctx())).toHaveLength(0);
  });
});

describe('modelMixInsights', () => {
  it('quantifies frontier-to-mid savings', () => {
    const [i] = modelMixInsights(rowsOf(steadyMonth()), ctx());
    expect(i).toBeDefined();
    expect(i!.evidence['altModel']).toBe('claude-sonnet-5');
    // Opus: $7.5/day; Sonnet: 1M*2 + 100k*10 = $3/day. 30% shift of (7.5-3)*45 days ≈ $60.75
    expect(i!.impactUsdPerMonth).toBeGreaterThan(50);
  });
});

describe('idleSeatInsights', () => {
  it('lists seats without recent activity', () => {
    const rows = rowsOf([ev({ ts: '2026-09-10T10:00:00Z', model: 'claude-sonnet-5', input: 1000, actor: { email: 'a@x.io' } })]);
    const [i] = idleSeatInsights(
      rows,
      ctx({
        seats: [
          { actorKey: 'a@x.io', provider: 'anthropic', plan: 'team_premium', priceMonthly: 150 },
          { actorKey: 'b@x.io', provider: 'anthropic', plan: 'team_premium', priceMonthly: 150 },
        ],
      }),
    );
    expect(i?.impactUsdPerMonth).toBe(150);
    expect(i?.title).toMatch(/1 of 2/);
  });
});

describe('generateInsights', () => {
  it('orders by severity then impact and prices unknown models as warnings', () => {
    const raws = steadyMonth();
    raws.push(ev({ ts: '2026-09-13T10:00:00Z', model: 'mystery-model-x', input: 1000 }));
    const out = generateInsights(rowsOf(raws), ctx({ budgets: [{ id: 'b', name: 'AI', amountUsd: 50, period: 'month' }] }));
    expect(out[0]!.kind).toBe('budget');
    expect(out.some((i) => i.kind === 'unpriced_model')).toBe(true);
  });
});
