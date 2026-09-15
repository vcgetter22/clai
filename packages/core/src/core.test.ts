import { describe, expect, it } from 'vitest';
import { aggregateEvents } from './aggregate.js';
import { effectiveCost, finalizeEvent, repriceEvent } from './events.js';
import { CATALOG } from './pricing/catalog.js';
import { addDays, dayKey, daysInMonth, formatTokens, formatUsd, localDayStartIso, parseSince } from './time.js';
import { emptyUsage, type RawUsageEvent } from './types.js';

describe('finalizeEvent', () => {
  const base: RawUsageEvent = {
    ts: '2026-09-01T10:00:00.000Z',
    source: 'claude-code',
    provider: 'anthropic',
    model: 'claude-opus-5',
    surface: 'cli-agent',
    billing: 'subscription',
    granularity: 'request',
    actor: {},
    context: { sessionId: 'abc' },
    usage: { ...emptyUsage(), input: 100, output: 50, cacheRead: 10_000, requests: 1 },
    naturalKey: ['msg_1', 'req_1'],
  };
  it('derives a stable id from the natural key', () => {
    const a = finalizeEvent(base, CATALOG).event;
    const b = finalizeEvent({ ...base, ts: '2026-09-02T00:00:00Z' }, CATALOG).event;
    expect(a.id).toBe(b.id);
    expect(a.id).toHaveLength(24);
  });
  it('computes cost and confidence', () => {
    const { event, unpriced } = finalizeEvent(base, CATALOG);
    expect(unpriced).toBe(false);
    expect(event.modelKey).toBe('claude-opus-5');
    expect(event.cost.confidence).toBe('computed');
    // 100*5 + 50*25 + 10000*0.5 = 500+1250+5000 = 6750 / 1e6
    expect(event.cost.computedUsd).toBeCloseTo(0.00675, 8);
    expect(effectiveCost(event)).toBeCloseTo(0.00675, 8);
  });
  it('prefers billed cost when present', () => {
    const { event } = finalizeEvent({ ...base, cost: { billedUsd: 1.23 } }, CATALOG);
    expect(event.cost.confidence).toBe('billed');
    expect(effectiveCost(event)).toBe(1.23);
  });
  it('marks synthetic models as zero cost and unknown models as unpriced', () => {
    expect(finalizeEvent({ ...base, model: '<synthetic>' }, CATALOG).event.cost.computedUsd).toBe(0);
    const u = finalizeEvent({ ...base, model: 'nope-1' }, CATALOG);
    expect(u.unpriced).toBe(true);
    expect(u.event.cost.confidence).toBe('none');
  });
  it('infers provider for gateway events', () => {
    const { event } = finalizeEvent({ ...base, provider: 'openrouter', source: 'openrouter', model: 'openai/gpt-5-mini' }, CATALOG);
    expect(event.provider).toBe('openai');
    expect(event.modelKey).toBe('gpt-5-mini');
  });
  it('reprices with the same id', () => {
    const { event } = finalizeEvent(base, CATALOG);
    const re = repriceEvent(event, CATALOG);
    expect(re.id).toBe(event.id);
    expect(re.cost.computedUsd).toBe(event.cost.computedUsd);
  });
});

describe('aggregateEvents', () => {
  it('groups by day/model/session and tracks context size', () => {
    const raws: RawUsageEvent[] = [
      { ts: '2026-09-01T10:00:00Z', source: 'claude-code', provider: 'anthropic', model: 'claude-opus-5', surface: 'cli-agent', billing: 'subscription', granularity: 'request', actor: {}, context: { sessionId: 's', project: 'p' }, usage: { ...emptyUsage(), input: 10, cacheRead: 250_000, requests: 1 } },
      { ts: '2026-09-01T11:00:00Z', source: 'claude-code', provider: 'anthropic', model: 'claude-opus-5', surface: 'cli-agent', billing: 'subscription', granularity: 'request', actor: {}, context: { sessionId: 's', project: 'p' }, usage: { ...emptyUsage(), input: 10, cacheRead: 100_000, requests: 1 } },
    ];
    const rows = aggregateEvents(raws.map((r) => finalizeEvent(r, CATALOG).event), 'UTC');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.events).toBe(2);
    expect(rows[0]!.maxContext).toBe(250_010);
    expect(rows[0]!.longContextEvents).toBe(1);
    expect(rows[0]!.usage.cacheRead).toBe(350_000);
  });
});

describe('time', () => {
  it('computes day keys in a timezone', () => {
    expect(dayKey('2026-09-01T23:30:00Z', 'UTC')).toBe('2026-09-01');
    expect(dayKey('2026-09-01T23:30:00Z', 'Europe/Berlin')).toBe('2026-09-02');
    expect(dayKey('2026-09-01T02:30:00Z', 'America/Los_Angeles')).toBe('2026-08-31');
  });
  it('parses since expressions', () => {
    const now = new Date('2026-09-15T12:00:00Z');
    expect(parseSince('7d', now)).toBe('2026-09-08T12:00:00.000Z');
    expect(parseSince('all', now)).toBeNull();
    expect(parseSince('month', now, 'UTC')).toBe('2026-09-01T00:00:00.000Z');
    expect(parseSince('2026-08-01', now, 'UTC')).toBe('2026-08-01T00:00:00.000Z');
    expect(parseSince('2026-08-01', now, 'Europe/Berlin')).toBe('2026-07-31T22:00:00.000Z');
    expect(() => parseSince('bogus', now)).toThrow();
  });
  it('local day start handles DST zones', () => {
    expect(localDayStartIso('2026-01-15', 'Europe/Berlin')).toBe('2026-01-14T23:00:00.000Z');
    expect(localDayStartIso('2026-07-15', 'Europe/Berlin')).toBe('2026-07-14T22:00:00.000Z');
  });
  it('formats', () => {
    expect(formatUsd(0)).toBe('$0');
    expect(formatUsd(0.00123)).toBe('$0.0012');
    expect(formatUsd(12.345)).toBe('$12.35');
    expect(formatUsd(1234)).toBe('$1,234');
    expect(formatUsd(999.4)).toBe('$999');
    expect(formatUsd(-2957)).toBe('$-2,957');
    expect(formatUsd(1234, { compact: true })).toBe('$1.2k');
    expect(formatTokens(1234)).toBe('1.2k');
    expect(formatTokens(12_345_678)).toBe('12.3M');
    expect(daysInMonth('2026-02')).toBe(28);
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
  });
});
