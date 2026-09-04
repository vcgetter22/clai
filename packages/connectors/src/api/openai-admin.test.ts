import { describe, expect, it } from 'vitest';
import { CATALOG } from '@claii/core';
import { noopLogger, type ConnectorContext } from '../types.js';
import { mapCompletionsResult, mapCostsResult, openaiAdminConnector, parseLineItemModel } from './openai-admin.js';

function memState() {
  const m = new Map<string, string>();
  return { get: (k: string) => m.get(k), set: (k: string, v: string) => void m.set(k, v), map: m };
}

interface Call {
  url: URL;
  init?: RequestInit;
}

type Route = (url: URL, init: RequestInit | undefined) => { status: number; body: unknown } | undefined;

function ctxFor(route: Route, calls: Call[], now = '2026-09-03T12:00:00.000Z'): ConnectorContext & { stateMap: Map<string, string> } {
  const st = memState();
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    const r = route(url, init);
    if (!r) throw new Error(`unhandled fetch in test: ${url.toString()}`);
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { catalog: CATALOG, state: st, stateMap: st.map, log: noopLogger, now: () => new Date(now), home: '/home/x', env: {}, planFor: () => undefined, fetch: fetchImpl };
}

describe('mapCompletionsResult — cached-token subtraction', () => {
  it('subtracts input_cached_tokens from input_tokens to get billable uncached input', () => {
    const ev = mapCompletionsResult(
      '2026-08-01T00:00:00.000Z',
      '2026-08-02T00:00:00.000Z',
      { input_tokens: 100, input_cached_tokens: 30, output_tokens: 50, num_model_requests: 2, project_id: 'proj_1', user_id: 'user_1', api_key_id: 'key_1', model: 'gpt-5', batch: false, service_tier: 'default' },
      { projectNames: new Map([['proj_1', 'Prod Project']]), userNames: new Map([['user_1', { name: 'Dev One', email: 'dev@example.com' }]]), apiKeyNames: new Map([['key_1', 'ci-key']]) },
    );
    expect(ev.usage.input).toBe(70);
    expect(ev.usage.cacheRead).toBe(30);
    expect(ev.usage.output).toBe(50);
    expect(ev.usage.requests).toBe(2);
    expect(ev.actor).toEqual({ projectId: 'proj_1', projectName: 'Prod Project', userId: 'user_1', name: 'Dev One', email: 'dev@example.com', apiKeyId: 'key_1', apiKeyName: 'ci-key' });
    expect(ev.surface).toBe('api');
  });

  it('never goes negative if input_cached_tokens somehow exceeds input_tokens', () => {
    const ev = mapCompletionsResult('2026-08-01T00:00:00.000Z', '2026-08-02T00:00:00.000Z', { input_tokens: 5, input_cached_tokens: 9 });
    expect(ev.usage.input).toBe(0);
    expect(ev.usage.cacheRead).toBe(9);
  });

  it('marks batch rows with surface batch', () => {
    const ev = mapCompletionsResult('2026-08-01T00:00:00.000Z', '2026-08-02T00:00:00.000Z', { batch: true });
    expect(ev.surface).toBe('batch');
  });
});

describe('parseLineItemModel / mapCostsResult', () => {
  it('splits "model, kind" line items and maps amount.value straight to billedUsd (already USD, not cents)', () => {
    expect(parseLineItemModel('gpt-4o-2024-08-06, input')).toEqual({ model: 'gpt-4o-2024-08-06', kind: 'input' });
    expect(parseLineItemModel(null)).toEqual({ model: 'unknown' });
    const ev = mapCostsResult('2026-08-01T00:00:00.000Z', '2026-08-02T00:00:00.000Z', { amount: { value: 1.23, currency: 'usd' }, line_item: 'gpt-5, input', project_id: 'proj_1' }, { projectNames: new Map([['proj_1', 'Prod Project']]) });
    expect(ev.model).toBe('gpt-5');
    expect(ev.cost).toEqual({ billedUsd: 1.23, currency: 'USD', confidence: 'billed' });
    expect(ev.meta).toEqual({ lineItem: 'gpt-5, input', kind: 'input' });
    expect(ev.actor).toEqual({ projectId: 'proj_1', projectName: 'Prod Project' });
  });
});

describe('verbatim research examples (openai-sources.md §1.2 / §1.9)', () => {
  it('maps the §1.2 organization.usage.completions.result example verbatim', () => {
    const bucketStart = new Date(1_735_689_600 * 1000).toISOString();
    const bucketEnd = new Date(1_735_776_000 * 1000).toISOString();
    const ev = mapCompletionsResult(bucketStart, bucketEnd, {
      object: 'organization.usage.completions.result',
      input_tokens: 1200,
      input_cached_tokens: 300,
      output_tokens: 450,
      input_audio_tokens: 0,
      output_audio_tokens: 0,
      num_model_requests: 12,
      project_id: 'proj_abc',
      user_id: 'user_abc',
      api_key_id: 'key_abc',
      model: 'gpt-4o-2024-08-06',
      batch: false,
      service_tier: 'default',
    });
    // input_tokens (1200) includes input_cached_tokens (300) -> billable uncached input is the remainder.
    expect(ev.usage).toEqual({ input: 900, output: 450, cacheRead: 300, cacheWrite5m: 0, cacheWrite1h: 0, requests: 12 });
    expect(ev.model).toBe('gpt-4o-2024-08-06');
    expect(ev.surface).toBe('api');
    expect(ev.context).toEqual({ serviceTier: 'default' });
    expect(ev.actor).toEqual({ projectId: 'proj_abc', userId: 'user_abc', apiKeyId: 'key_abc' });
    expect(ev.naturalKey).toEqual(['usage', bucketStart, 'gpt-4o-2024-08-06', 'proj_abc', 'user_abc', 'key_abc', 'sync', 'default']);
  });

  it('maps the §1.9 organization.costs.result example verbatim (amount.value already USD, not cents)', () => {
    const bucketStart = '2026-08-01T00:00:00.000Z';
    const ev = mapCostsResult(bucketStart, bucketStart, {
      object: 'organization.costs.result',
      amount: { value: 0.06, currency: 'usd' },
      line_item: 'gpt-4o-2024-08-06, input',
      project_id: 'proj_abc',
      api_key_id: null,
    });
    expect(ev.cost).toEqual({ billedUsd: 0.06, currency: 'USD', confidence: 'billed' });
    expect(ev.model).toBe('gpt-4o-2024-08-06');
    expect(ev.meta).toEqual({ lineItem: 'gpt-4o-2024-08-06, input', kind: 'input' });
    expect(ev.actor).toEqual({ projectId: 'proj_abc' });
  });
});

describe('openaiAdminConnector.verify', () => {
  it('reports ok with a project count on success', async () => {
    const calls: Call[] = [];
    const ctx = ctxFor((url) => (url.pathname === '/v1/organization/projects' ? { status: 200, body: { data: [{ id: 'proj_1' }] } } : undefined), calls);
    const res = await openaiAdminConnector.verify(ctx, { adminKey: 'sk-admin-xyz' });
    expect(res.ok).toBe(true);
    expect(res.message).toMatch(/1 project visible/);
    expect((calls[0]!.init?.headers as Record<string, string>)['Authorization']).toBe('Bearer sk-admin-xyz');
  });

  it('gives a helpful message on 401', async () => {
    const ctx = ctxFor(() => ({ status: 401, body: { error: { message: 'Incorrect API key provided' } } }), []);
    const res = await openaiAdminConnector.verify(ctx, { adminKey: 'bad' });
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/Admin API key rejected/);
    expect(res.message).toMatch(/Incorrect API key provided/);
  });
});

describe('openaiAdminConnector.pull', () => {
  it('paginates usage/completions, loads names lazily, maps costs, and persists cursors', async () => {
    const calls: Call[] = [];
    const usagePage1 = {
      status: 200,
      body: {
        data: [{ start_time: 1_754_000_000, end_time: 1_754_086_400, results: [{ input_tokens: 100, input_cached_tokens: 30, output_tokens: 50, num_model_requests: 2, project_id: 'proj_1', user_id: 'user_1', api_key_id: 'key_1', model: 'gpt-5' }] }],
        has_more: true,
        next_page: 'p2',
      },
    };
    const usagePage2 = {
      status: 200,
      body: { data: [{ start_time: 1_754_086_400, end_time: 1_754_172_800, results: [{ input_tokens: 10, output_tokens: 5, model: 'gpt-5-mini' }] }], has_more: false, next_page: null },
    };
    const costPage = {
      status: 200,
      body: { data: [{ start_time: 1_754_000_000, end_time: 1_754_086_400, results: [{ amount: { value: 4.5 }, line_item: 'gpt-5, output', project_id: 'proj_1' }] }], has_more: false, next_page: null },
    };
    const ctx = ctxFor((url) => {
      if (url.pathname === '/v1/organization/projects/proj_1/api_keys') return { status: 200, body: { data: [{ id: 'key_1', name: 'ci-key' }], has_more: false } };
      if (url.pathname === '/v1/organization/projects') return { status: 200, body: { data: [{ id: 'proj_1', name: 'Prod Project' }], has_more: false } };
      if (url.pathname === '/v1/organization/users') return { status: 200, body: { data: [{ id: 'user_1', name: 'Dev One', email: 'dev@example.com' }], has_more: false } };
      if (url.pathname === '/v1/organization/usage/completions') return url.searchParams.get('page') === 'p2' ? usagePage2 : usagePage1;
      if (url.pathname === '/v1/organization/costs') return costPage;
      return undefined;
    }, calls);

    const events = [];
    for await (const ev of openaiAdminConnector.pull(ctx, { adminKey: 'sk-admin-xyz' })) events.push(ev);

    expect(events).toHaveLength(3); // 2 usage rows + 1 cost row
    const first = events[0]!;
    expect(first.usage.input).toBe(70); // 100 - 30 cached
    expect(first.actor.apiKeyName).toBe('ci-key');
    expect(first.actor.projectName).toBe('Prod Project');
    expect(first.actor.email).toBe('dev@example.com');

    const costEvent = events.find((e) => e.naturalKey?.[0] === 'cost')!;
    expect(costEvent.cost).toEqual({ billedUsd: 4.5, currency: 'USD', confidence: 'billed' });

    // start_time/end_time (unix seconds) round-trip through unixSeconds() for the request window.
    const usageCalls = calls.filter((c) => c.url.pathname === '/v1/organization/usage/completions');
    expect(usageCalls).toHaveLength(2);
    expect(usageCalls[1]!.url.searchParams.get('page')).toBe('p2');
    expect(Number(usageCalls[0]!.url.searchParams.get('start_time'))).toBeGreaterThan(0);

    expect(ctx.stateMap.get('openai-admin:usage:last_pull')).toBe('2026-09-03T12:00:00.000Z');
    expect(ctx.stateMap.get('openai-admin:cost:last_pull')).toBe('2026-09-03T12:00:00.000Z');
  });
});
