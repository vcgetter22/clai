import { describe, expect, it } from 'vitest';
import { CATALOG, emptyUsage, finalizeEvent, type RawUsageEvent } from '@claii/core';
import { EventStore } from './store.js';

function raw(i: number, over: Partial<RawUsageEvent> = {}): RawUsageEvent {
  return {
    ts: `2026-09-0${(i % 9) + 1}T10:00:00.000Z`,
    source: 'claude-code',
    provider: 'anthropic',
    model: 'claude-opus-5',
    surface: 'cli-agent',
    billing: 'subscription',
    granularity: 'request',
    actor: {},
    context: { sessionId: `s${i % 3}`, project: i % 2 ? 'alpha' : 'beta', cwd: '/x' },
    usage: { ...emptyUsage(), input: 1000 * i, output: 100 * i, cacheRead: 50_000, requests: 1 },
    naturalKey: [`msg_${i}`, `req_${i}`],
    ...over,
  };
}

describe('EventStore', () => {
  it('upserts idempotently and aggregates', () => {
    const store = new EventStore(':memory:', { timeZone: 'UTC' });
    const events = [1, 2, 3, 4, 5].map((i) => finalizeEvent(raw(i), CATALOG).event);
    const first = store.upsertEvents(events);
    expect(first).toEqual({ inserted: 5, updated: 0, unchanged: 0 });
    const second = store.upsertEvents(events);
    expect(second).toEqual({ inserted: 0, updated: 0, unchanged: 5 });
    // Changed tokens => update
    const changed = finalizeEvent({ ...raw(1), usage: { ...emptyUsage(), input: 999, requests: 1 } }, CATALOG).event;
    expect(store.upsertEvents([changed]).updated).toBe(1);
    expect(store.countEvents()).toBe(5);

    const total = store.total();
    expect(total.events).toBe(5);
    expect(total.usd).toBeGreaterThan(0);

    const byProject = store.totalsBy('project');
    expect(byProject.map((p) => p.key).sort()).toEqual(['alpha', 'beta']);

    const rows = store.rows();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.provider === 'anthropic')).toBe(true);

    const sessions = store.sessions();
    expect(sessions).toHaveLength(3);
    expect(sessions[0]!.usd).toBeGreaterThanOrEqual(sessions[1]!.usd);
    store.close();
  });

  it('filters by day range, project and source', () => {
    const store = new EventStore(':memory:', { timeZone: 'UTC' });
    store.upsertEvents([1, 2, 3, 4, 5, 6].map((i) => finalizeEvent(raw(i), CATALOG).event));
    expect(store.countEvents({ fromDay: '2026-09-03', toDay: '2026-09-04' })).toBe(2);
    expect(store.countEvents({ project: 'alpha' })).toBe(3);
    expect(store.countEvents({ source: 'codex-cli' })).toBe(0);
    expect(store.countEvents({ since: '2026-09-05T00:00:00Z' })).toBe(3);
    store.close();
  });

  it('prefers billed cost only for fully billed cells', () => {
    const store = new EventStore(':memory:', { timeZone: 'UTC' });
    const a = finalizeEvent(raw(1, { source: 'anthropic-admin', billing: 'api', surface: 'api', granularity: 'day', cost: { billedUsd: 5 }, context: { project: 'p' }, naturalKey: ['a'] }), CATALOG).event;
    const b = finalizeEvent(raw(2, { source: 'anthropic-admin', billing: 'api', surface: 'api', granularity: 'day', context: { project: 'p' }, naturalKey: ['b'] }), CATALOG).event;
    store.upsertEvents([a, b]);
    const t = store.total();
    expect(t.billedUsd).toBeNull(); // mixed cell
    expect(t.usd).toBeCloseTo(t.computedUsd, 6);
    const onlyA = store.total({ fromDay: '2026-09-02', toDay: '2026-09-02' });
    expect(onlyA.billedUsd).toBe(5);
    expect(onlyA.usd).toBe(5);
    store.close();
  });

  it('stores settings, state, subscriptions, budgets, seats', () => {
    const store = new EventStore(':memory:', { timeZone: 'UTC' });
    store.setSetting('a', '1');
    expect(store.getSetting('a')).toBe('1');
    store.setState('claude-code', 'file:/x', '{"size":1}');
    expect(store.getState('claude-code', 'file:/x')).toBe('{"size":1}');
    store.putSubscription({ id: 'max', provider: 'anthropic', plan: 'max_20x', priceMonthly: 200 });
    expect(store.listSubscriptions()).toHaveLength(1);
    store.putBudget({ id: 'b', name: 'AI', amountUsd: 100, period: 'month' });
    expect(store.listBudgets()[0]!.amountUsd).toBe(100);
    store.putSeat({ actorKey: 'x@y.z', provider: 'anthropic', plan: 'team_premium', priceMonthly: 150 });
    expect(store.listSeats()).toHaveLength(1);
    expect(store.deleteSeat('x@y.z')).toBe(true);
    store.close();
  });

  it('recomputes day keys on timezone change and reprices', () => {
    const store = new EventStore(':memory:', { timeZone: 'UTC' });
    const e = finalizeEvent(raw(1, { ts: '2026-09-01T23:30:00.000Z' }), CATALOG).event;
    store.upsertEvents([e]);
    expect(store.totalsBy('day')[0]!.key).toBe('2026-09-01');
    store.recomputeDays('Europe/Berlin');
    expect(store.totalsBy('day')[0]!.key).toBe('2026-09-02');
    expect(store.repriceAll(CATALOG)).toBe(0);
    store.close();
  });

  it('round-trips events', () => {
    const store = new EventStore(':memory:', { timeZone: 'UTC' });
    const e = finalizeEvent(raw(7, { meta: { x: 1 } }), CATALOG).event;
    store.upsertEvents([e]);
    const [back] = store.listEvents();
    expect(back).toEqual(e);
    store.close();
  });
});
