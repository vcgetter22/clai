import { CATALOG, emptyUsage, finalizeEvent, type RawUsageEvent } from '@claii/core';
import type { EventStore } from '../interface.js';

/**
 * The test primitives injected by the caller, structurally compatible with vitest's
 * `describe`/`it`/`expect` (and any runner with the same shape) without this package
 * depending on vitest at runtime or in its published types.
 */
export interface Expectation {
  toBe(v: unknown): void;
  toEqual(v: unknown): void;
  toBeNull(): void;
  toBeUndefined(): void;
  toBeTruthy(): void;
  toBeGreaterThan(n: number): void;
  toBeGreaterThanOrEqual(n: number): void;
  toBeCloseTo(n: number, digits?: number): void;
  toHaveLength(n: number): void;
  toContain(v: unknown): void;
  toMatchObject(v: Record<string, unknown>): void;
  readonly not: Expectation;
}

export interface ConformanceRunner {
  describe: (name: string, fn: () => void) => void;
  it: (name: string, fn: () => void | Promise<void>) => void;
  expect: (actual: unknown) => Expectation;
  /** Returns a fresh, empty, ready-to-use store (e.g. `:memory:` SQLite, or a PGlite database after migrations). */
  makeStore: () => Promise<EventStore>;
}

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

/**
 * Runs the store contract against whatever `makeStore` returns. Every clai backend (the local
 * SQLite store, and the hosted service's Postgres adapter) must pass this identically — it is
 * the one place "does this backend behave like an `EventStore`" is answered.
 */
export function runStoreConformance({ describe, it, expect, makeStore }: ConformanceRunner): void {
  describe('EventStore conformance', () => {
    it('upserts idempotently and aggregates', async () => {
      const store = await makeStore();
      const events = [1, 2, 3, 4, 5].map((i) => finalizeEvent(raw(i), CATALOG).event);
      const first = await store.upsertEvents(events);
      expect(first).toEqual({ inserted: 5, updated: 0, unchanged: 0, dropped: 0 });
      const second = await store.upsertEvents(events);
      expect(second).toEqual({ inserted: 0, updated: 0, unchanged: 5, dropped: 0 });
      // Changed tokens => update
      const changed = finalizeEvent({ ...raw(1), usage: { ...emptyUsage(), input: 999, requests: 1 } }, CATALOG).event;
      expect((await store.upsertEvents([changed])).updated).toBe(1);
      expect(await store.countEvents()).toBe(5);

      const total = await store.total();
      expect(total.events).toBe(5);
      expect(total.usd).toBeGreaterThan(0);

      const byProject = await store.totalsBy('project');
      expect(byProject.map((p) => p.key).sort()).toEqual(['alpha', 'beta']);

      const rows = await store.rows();
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.provider === 'anthropic')).toBeTruthy();

      const sessions = await store.sessions();
      expect(sessions).toHaveLength(3);
      expect(sessions[0]!.usd).toBeGreaterThanOrEqual(sessions[1]!.usd);
      await store.close();
    });

    it('filters by day range, project and source', async () => {
      const store = await makeStore();
      await store.upsertEvents([1, 2, 3, 4, 5, 6].map((i) => finalizeEvent(raw(i), CATALOG).event));
      expect(await store.countEvents({ fromDay: '2026-09-03', toDay: '2026-09-04' })).toBe(2);
      expect(await store.countEvents({ project: 'alpha' })).toBe(3);
      expect(await store.countEvents({ source: 'codex-cli' })).toBe(0);
      expect(await store.countEvents({ since: '2026-09-05T00:00:00Z' })).toBe(3);
      await store.close();
    });

    it('prefers billed cost only for fully billed cells', async () => {
      const store = await makeStore();
      const a = finalizeEvent(raw(1, { source: 'anthropic-admin', billing: 'api', surface: 'api', granularity: 'day', cost: { billedUsd: 5 }, context: { project: 'p' }, naturalKey: ['a'] }), CATALOG).event;
      const b = finalizeEvent(raw(2, { source: 'anthropic-admin', billing: 'api', surface: 'api', granularity: 'day', context: { project: 'p' }, naturalKey: ['b'] }), CATALOG).event;
      await store.upsertEvents([a, b]);
      const t = await store.total();
      expect(t.billedUsd).toBeNull(); // mixed cell
      expect(t.usd).toBeCloseTo(t.computedUsd, 6);
      const onlyA = await store.total({ fromDay: '2026-09-02', toDay: '2026-09-02' });
      expect(onlyA.billedUsd).toBe(5);
      expect(onlyA.usd).toBe(5);
      await store.close();
    });

    it('lists raw events and iterates them in ts order', async () => {
      const store = await makeStore();
      const e = finalizeEvent(raw(7, { meta: { x: 1 } }), CATALOG).event;
      await store.upsertEvents([e]);
      const [back] = await store.listEvents();
      expect(back).toEqual(e);
      const iterated: unknown[] = [];
      for await (const ev of store.iterateEvents()) iterated.push(ev);
      expect(iterated).toEqual([e]);
      await store.close();
    });

    it('stores settings, state, subscriptions, budgets, seats', async () => {
      const store = await makeStore();
      await store.setSetting('a', '1');
      expect(await store.getSetting('a')).toBe('1');
      await store.setJsonSetting('b', { x: 1 });
      expect(await store.getJsonSetting('b')).toEqual({ x: 1 });

      await store.setState('claude-code', 'file:/x', '{"size":1}');
      expect(await store.getState('claude-code', 'file:/x')).toBe('{"size":1}');
      const snapshot = await store.loadState('claude-code');
      expect(snapshot.get('file:/x')).toBe('{"size":1}');
      await store.saveState('claude-code', { 'file:/y': '{"size":2}' });
      expect(await store.getState('claude-code', 'file:/y')).toBe('{"size":2}');
      await store.clearState('claude-code');
      expect(await store.getState('claude-code', 'file:/x')).toBeUndefined();

      await store.putSubscription({ id: 'max', provider: 'anthropic', plan: 'max_20x', priceMonthly: 200 });
      expect(await store.listSubscriptions()).toHaveLength(1);
      expect(await store.deleteSubscription('max')).toBeTruthy();

      await store.putBudget({ id: 'b', name: 'AI', amountUsd: 100, period: 'month' });
      expect((await store.listBudgets())[0]!.amountUsd).toBe(100);
      expect(await store.deleteBudget('b')).toBeTruthy();

      await store.putSeat({ actorKey: 'x@y.z', provider: 'anthropic', plan: 'team_premium', priceMonthly: 150 });
      expect(await store.listSeats()).toHaveLength(1);
      expect(await store.deleteSeat('x@y.z')).toBeTruthy();
      await store.close();
    });

    it('recomputes day keys on timezone change and reprices', async () => {
      const store = await makeStore();
      const e = finalizeEvent(raw(1, { ts: '2026-09-01T23:30:00.000Z' }), CATALOG).event;
      await store.upsertEvents([e]);
      expect((await store.totalsBy('day'))[0]!.key).toBe('2026-09-01');
      await store.recomputeDays('Europe/Berlin');
      expect((await store.totalsBy('day'))[0]!.key).toBe('2026-09-02');
      expect(await store.repriceAll(CATALOG)).toBe(0);
      await store.close();
    });

    it('tracks ingest runs, sources and actors', async () => {
      const store = await makeStore();
      const runId = await store.startRun('claude-code');
      await store.finishRun(runId, { seen: 2, inserted: 2, updated: 0, unpriced: 0 });
      const runs = await store.lastRuns(5);
      expect(runs).toHaveLength(1);

      await store.upsertEvents([1, 2].map((i) => finalizeEvent(raw(i), CATALOG).event));
      expect(await store.sources()).toHaveLength(1);
      const actors = await store.actors();
      expect(actors.length).toBeGreaterThan(0);
      expect(await store.deleteSource('claude-code')).toBeGreaterThan(0);
      expect(await store.countEvents()).toBe(0);
      await store.close();
    });

    it('manages team tokens and members', async () => {
      const store = await makeStore();
      expect(await store.countActiveTokens()).toBe(0);
      await store.insertToken({ tokenHash: 'h1', actorKey: 'admin@x.com', role: 'admin', label: 'bootstrap' });
      await store.upsertMember({ actorKey: 'admin@x.com', displayName: 'Admin', role: 'admin' });
      expect(await store.countActiveTokens()).toBe(1);

      const found = await store.lookupToken('h1');
      expect(found).toMatchObject({ actorKey: 'admin@x.com', role: 'admin' });
      expect(await store.lookupToken('nope')).toBeNull();

      await store.touchToken('h1');
      const afterTouch = await store.lookupToken('h1');
      expect(afterTouch?.lastUsedAt).toBeTruthy();
      const touchedAt = afterTouch?.lastUsedAt;
      await store.touchToken('h1'); // throttled: within 5 minutes, must not move
      expect((await store.lookupToken('h1'))?.lastUsedAt).toBe(touchedAt);

      await store.insertToken({ tokenHash: 'h2', actorKey: 'member@x.com', role: 'member', expiresAt: '2000-01-01T00:00:00.000Z' });
      expect(await store.lookupToken('h2')).toBeNull(); // expired tokens do not resolve

      const tokens = await store.listTokens();
      expect(tokens.length).toBeGreaterThanOrEqual(2);
      await store.revokeToken('h1');
      expect(await store.lookupToken('h1')).toBeNull();

      const members = await store.listMembers();
      expect(members.some((m) => m.actorKey === 'admin@x.com' && m.role === 'admin')).toBeTruthy();
      await store.close();
    });
  });
}
