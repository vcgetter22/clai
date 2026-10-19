import { describe, expect, it } from 'vitest';
import { CATALOG, emptyUsage, finalizeEvent, type PricingCatalog, type RawUsageEvent } from '@claii/core';
import { SqliteEventStore } from '@claii/store/sqlite';
import { PRICED_WITH_KEY, repriceIfCatalogChanged } from './runner.js';

const opus55: RawUsageEvent = {
  ts: '2026-10-19T09:00:00Z',
  source: 'claude-code',
  provider: 'anthropic',
  model: 'claude-opus-5-5',
  surface: 'cli-agent',
  billing: 'subscription',
  granularity: 'request',
  actor: {},
  context: { sessionId: 's1', project: 'clai' },
  usage: { ...emptyUsage(), input: 1_000_000, output: 100_000, requests: 1 },
};

describe('repriceIfCatalogChanged', () => {
  it('reprices stored events once when the catalog version changes', async () => {
    // A catalog from before Opus 5.5: its events fell back to Opus 5 prices ($5 in, $25 out).
    const before: PricingCatalog = { ...CATALOG, version: '2026-09-03', models: CATALOG.models.filter((m) => m.id !== 'claude-opus-5-5') };
    const store = new SqliteEventStore(':memory:', { timeZone: 'UTC' });
    await store.upsertEvents([finalizeEvent(opus55, before).event], 'test');
    expect((await store.listEvents())[0]!.cost.computedUsd).toBeCloseTo(7.5, 6);

    expect(await repriceIfCatalogChanged(store, CATALOG)).toBe(1);
    const [event] = await store.listEvents();
    expect(event!.cost.computedUsd).toBeCloseTo(6, 6); // Opus 5.5: $4 in, $20 out
    expect(event!.modelKey).toBe('claude-opus-5-5');
    expect(await store.getSetting(PRICED_WITH_KEY)).toBe(CATALOG.version);

    // Same catalog: nothing to do.
    expect(await repriceIfCatalogChanged(store, CATALOG)).toBe(0);
  });
});
