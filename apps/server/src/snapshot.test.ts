import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CATALOG, emptyUsage, finalizeEvent, type RawUsageEvent } from '@claii/core';
import { SqliteEventStore } from '@claii/store/sqlite';
import type { RunResult } from './runner.js';
import { basisOf, computeSnapshot, rankInsights, SNAPSHOT_SCHEMA, watchRoots, type Snapshot } from './snapshot.js';

const NOW = new Date('2026-10-19T15:00:00Z');

/**
 * The Swift side (apps/mac, ClaiKitTests) decodes this file, so the engine and the app agree on
 * the shape. Regenerate after a deliberate change: UPDATE_SNAPSHOT_FIXTURE=1 npx vitest run snapshot
 */
const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), '../../mac/Tests/ClaiKitTests/Fixtures/snapshot.json');

function ev(ts: string, source: RawUsageEvent['source'], provider: RawUsageEvent['provider'], model: string, project: string, tokens: { input: number; output: number; cacheRead?: number; cacheWrite1h?: number }): RawUsageEvent {
  return {
    ts,
    source,
    provider,
    model,
    surface: 'cli-agent',
    billing: 'subscription',
    granularity: 'request',
    actor: {},
    context: { sessionId: `${source}-${project}-${ts.slice(0, 10)}`, project },
    usage: { ...emptyUsage(), input: tokens.input, output: tokens.output, cacheRead: tokens.cacheRead ?? 0, cacheWrite1h: tokens.cacheWrite1h ?? 0, requests: 1 },
  };
}

/**
 * Eleven weeks of a heavy Claude Code user (sample data, also the Mac app's demo mode): mostly
 * Opus, some Sonnet, Codex and Gemini, quieter weekends and one heavy day.
 */
function demoEvents(scale = 8): RawUsageEvent[] {
  const out: RawUsageEvent[] = [];
  for (let t = Date.UTC(2026, 7, 1); t <= Date.UTC(2026, 9, 19); t += 86400e3) {
    const d = new Date(t);
    const day = d.toISOString().slice(0, 10);
    const weekday = d.getUTCDay();
    const load = weekday === 0 || weekday === 6 ? 0.35 : 1;
    const heavy = day === '2026-10-14' ? 4 : 1;
    const wave = 1 + 0.25 * Math.sin(t / (5 * 86400e3));
    const k = scale * load * heavy * wave;
    out.push(ev(`${day}T09:30:00Z`, 'claude-code', 'anthropic', 'claude-opus-5', 'clai', { input: Math.round(40_000 * k), output: Math.round(55_000 * k), cacheRead: Math.round(2_600_000 * k), cacheWrite1h: Math.round(140_000 * k) }));
    out.push(ev(`${day}T14:10:00Z`, 'claude-code', 'anthropic', 'claude-opus-5', 'site', { input: Math.round(15_000 * k), output: Math.round(21_000 * k), cacheRead: Math.round(900_000 * k), cacheWrite1h: Math.round(60_000 * k) }));
    if (d.getUTCDate() % 2 === 0) out.push(ev(`${day}T11:00:00Z`, 'claude-code', 'anthropic', 'claude-sonnet-5', 'notes', { input: Math.round(20_000 * k), output: Math.round(30_000 * k), cacheRead: Math.round(700_000 * k) }));
    if (weekday >= 1 && weekday <= 4) out.push(ev(`${day}T16:45:00Z`, 'codex-cli', 'openai', 'gpt-5.5', 'clai', { input: Math.round(60_000 * k), output: Math.round(18_000 * k), cacheRead: Math.round(400_000 * k) }));
    if (d.getUTCDate() % 5 === 0) out.push(ev(`${day}T18:20:00Z`, 'gemini-cli', 'google', 'gemini-2.5-pro', 'site', { input: Math.round(90_000 * k), output: Math.round(12_000 * k) }));
  }
  return out;
}

async function demoStore(): Promise<SqliteEventStore> {
  const store = new SqliteEventStore(':memory:', { timeZone: 'UTC' });
  await store.upsertEvents(demoEvents().map((r) => finalizeEvent(r, CATALOG).event), 'test');
  await store.putSubscription({ id: 'anthropic-max_5x', provider: 'anthropic', plan: 'max_5x', priceMonthly: 100 });
  await store.putBudget({ id: 'ai-tools', name: 'AI tools', amountUsd: 1500, period: 'month' });
  return store;
}

function result(source: string, found: boolean, paths: string[], inserted = 0): RunResult {
  return { source, seen: inserted, inserted, updated: 0, unchanged: 0, unpriced: 0, unpricedModels: [], error: null, durationMs: 3, detail: found ? `${source} data` : `No ${source} data`, found, paths };
}

const SCAN: RunResult[] = [
  result('claude-code', true, ['/Users/me/.claude'], 12),
  result('codex-cli', true, ['/Users/me/.codex/sessions'], 2),
  result('gemini-cli', true, ['/Users/me/.gemini']),
  result('opencode', false, []),
  result('cline', false, []),
  result('aider', false, []),
];

/** Keys and JSON types, recursively (arrays by their first element): what a decoder depends on. */
function shapeOf(v: unknown): unknown {
  if (Array.isArray(v)) return v.length ? [shapeOf(v[0])] : [];
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    // byProvider and similar maps are keyed by data, not by schema.
    if (Object.keys(o).every((k) => typeof o[k] === 'number') && Object.keys(o).length && !('usd' in o)) return '{string: number}';
    return Object.fromEntries(Object.keys(o).sort().map((k) => [k, shapeOf(o[k])]));
  }
  return v === null ? 'null' : typeof v;
}

describe('computeSnapshot', () => {
  it('summarises today, the month with its basis, 30 whole days and where the money went', async () => {
    const store = await demoStore();
    const s = await computeSnapshot(store, CATALOG, { engineVersion: '0.4.0', now: NOW, scan: { results: SCAN, durationMs: 412 } });

    expect(s.schema).toBe(SNAPSHOT_SCHEMA);
    expect(s.generatedAt).toBe(NOW.toISOString());
    expect(s.timeZone).toBe('UTC');
    expect(s.events.total).toBeGreaterThan(200);

    expect(s.daily).toHaveLength(30);
    expect(s.daily[0]!.day).toBe('2026-09-20');
    expect(s.daily.at(-1)!.day).toBe('2026-10-19');
    expect(s.today).toMatchObject({ day: '2026-10-19' });
    expect(s.today.usd).toBeCloseTo(s.daily.at(-1)!.usd, 1);
    expect(s.yesterday.day).toBe('2026-10-18');
    expect(s.last7Days.usd).toBeCloseTo(s.daily.slice(-7).reduce((a, d) => a + d.usd, 0), 2);

    expect(s.month).toMatchObject({ key: '2026-10', daysElapsed: 19, daysInMonth: 31, basis: 'api-equivalent', billedUsd: null });
    expect(s.month.usd).toBeGreaterThan(s.today.usd);
    expect(s.month.tokens).toBeGreaterThan(0);
    expect(s.lastMonth.key).toBe('2026-09');
    expect(s.forecast.projectedUsd).toBeGreaterThan(s.month.usd);

    expect(s.providers.map((p) => p.label)).toEqual(['Anthropic', 'OpenAI', 'Google']);
    expect(s.tools[0]).toMatchObject({ key: 'claude-code', label: 'Claude Code', provider: 'anthropic' });
    expect(s.tools.map((t) => t.key)).toEqual(['claude-code', 'codex-cli', 'gemini-cli']);
    expect(s.models[0]).toMatchObject({ key: 'claude-opus-5', label: 'Claude Opus 5', provider: 'anthropic' });
    expect(s.projects[0]!.key).toBe('clai');
    expect(s.providers.reduce((a, p) => a + p.share, 0)).toBeCloseTo(1, 3);

    expect(s.plans).toHaveLength(1);
    expect(s.plans[0]).toMatchObject({ id: 'anthropic-max_5x', label: 'Claude Max 5x', priceMonthly: 100 });
    expect(s.plans[0]!.multiple).toBeGreaterThan(1);
    expect(s.budgets[0]).toMatchObject({ id: 'ai-tools', name: 'AI tools', amountUsd: 1500 });

    expect(s.insights.length).toBeGreaterThan(0);
    expect(s.insights.some((i) => ['forecast', 'subscription_value', 'budget'].includes(i.kind))).toBe(false);
    expect(s.planOptions.some((p) => p.provider === 'anthropic' && p.plan === 'max_5x' && p.priceMonthly === 100)).toBe(true);
    expect(s.planOptions.every((p) => p.priceMonthly > 0)).toBe(true);

    expect(s.scan).toMatchObject({ durationMs: 412, inserted: 14, watchPaths: ['/Users/me/.claude', '/Users/me/.codex/sessions', '/Users/me/.gemini'] });
    expect(s.scan!.sources.map((x) => [x.id, x.label, x.found])).toEqual([
      ['claude-code', 'Claude Code', true],
      ['codex-cli', 'Codex CLI', true],
      ['gemini-cli', 'Gemini CLI', true],
      ['opencode', 'OpenCode', false],
      ['cline', 'Cline / Roo Code', false],
      ['aider', 'Aider', false],
    ]);
    await store.close();
  });

  it('works on an empty store, with no scan', async () => {
    const store = new SqliteEventStore(':memory:', { timeZone: 'UTC' });
    const s = await computeSnapshot(store, CATALOG, { engineVersion: '0.4.0', now: NOW });
    expect(s.scan).toBeNull();
    expect(s.events).toEqual({ total: 0, first: null, last: null });
    expect(s.daily).toHaveLength(30);
    expect(s.daily.every((d) => d.usd === 0)).toBe(true);
    expect(s.month.usd).toBe(0);
    expect(s.providers).toEqual([]);
    expect(s.plans).toEqual([]);
    await store.close();
  });

  it('matches the shape of the fixture the Swift app decodes', async () => {
    const store = await demoStore();
    const s = await computeSnapshot(store, CATALOG, { engineVersion: '0.4.0', now: NOW, scan: { results: SCAN, durationMs: 412 } });
    await store.close();
    if (process.env['UPDATE_SNAPSHOT_FIXTURE'] === '1' || !existsSync(FIXTURE)) {
      mkdirSync(dirname(FIXTURE), { recursive: true });
      writeFileSync(FIXTURE, JSON.stringify(s, null, 2) + '\n');
    }
    const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Snapshot;
    expect(shapeOf(s)).toEqual(shapeOf(fixture));
    expect(fixture.schema).toBe(SNAPSHOT_SCHEMA);
  });
});

describe('snapshot helpers', () => {
  it('names the basis: API-equivalent without billed amounts, billed when they cover everything, mixed otherwise', () => {
    expect(basisOf(12.5, null)).toBe('api-equivalent');
    expect(basisOf(12.5, 0)).toBe('api-equivalent');
    expect(basisOf(12.5, 12.5)).toBe('billed');
    expect(basisOf(12.5, 4)).toBe('mixed');
  });

  it('ranks insights by severity, then money at stake, and drops the kinds the snapshot shows elsewhere', () => {
    const base = { detail: '', evidence: {} };
    const ranked = rankInsights([
      { ...base, id: 'a', kind: 'cache_efficiency', severity: 'opportunity', title: 'a', impactUsdPerMonth: 5 },
      { ...base, id: 'b', kind: 'anomaly', severity: 'warning', title: 'b' },
      { ...base, id: 'c', kind: 'model_mix', severity: 'opportunity', title: 'c', impactUsdPerMonth: 40 },
      { ...base, id: 'd', kind: 'forecast', severity: 'critical', title: 'd' },
      { ...base, id: 'e', kind: 'unpriced_model', severity: 'info', title: 'e' },
    ]);
    expect(ranked.map((i) => i.id)).toEqual(['b', 'c', 'a', 'e']);
    expect(ranked[0]).toMatchObject({ action: null, impactUsdPerMonth: null });
  });

  it('folds nested and sibling folders into a short watch list', () => {
    expect(watchRoots(['/a/b', '/a/b/c', '/x', '/x', ''])).toEqual(['/a/b', '/x']);
    const tasks = Array.from({ length: 30 }, (_, i) => `/Users/me/Library/Code/tasks/t${i}`);
    expect(watchRoots([...tasks, '/Users/me/.claude'])).toEqual(['/Users/me/.claude', '/Users/me/Library/Code/tasks']);
  });
});
