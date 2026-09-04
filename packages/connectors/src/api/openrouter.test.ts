import { describe, expect, it } from 'vitest';
import { CATALOG } from '@claii/core';
import { noopLogger, type ConnectorContext, type Logger } from '../types.js';
import { mapActivityRow, openrouterConnector } from './openrouter.js';

function memState() {
  const m = new Map<string, string>();
  return { get: (k: string) => m.get(k), set: (k: string, v: string) => void m.set(k, v), map: m };
}

interface Call {
  url: URL;
  init?: RequestInit;
}

type Route = (url: URL, init: RequestInit | undefined) => { status: number; body: unknown } | undefined;

function ctxFor(route: Route, calls: Call[], opts: { now?: string; log?: Logger } = {}): ConnectorContext & { stateMap: Map<string, string> } {
  const st = memState();
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    const r = route(url, init);
    if (!r) throw new Error(`unhandled fetch in test: ${url.toString()}`);
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { catalog: CATALOG, state: st, stateMap: st.map, log: opts.log ?? noopLogger, now: () => new Date(opts.now ?? '2026-09-03T12:00:00.000Z'), home: '/home/x', env: {}, planFor: () => undefined, fetch: fetchImpl };
}

describe('mapActivityRow', () => {
  it('maps prompt/completion tokens and treats `usage` as an already-USD billedUsd total', () => {
    const ev = mapActivityRow({ date: '2026-08-15', model: 'anthropic/claude-sonnet-4.5', provider_name: 'anthropic', endpoint_id: 'ep_1', usage: 2.5, requests: 4, prompt_tokens: 1000, completion_tokens: 500, reasoning_tokens: 50 });
    expect(ev).not.toBeNull();
    expect(ev!.ts).toBe('2026-08-15T00:00:00.000Z');
    expect(ev!.usage).toMatchObject({ input: 1000, output: 500, reasoning: 50, requests: 4 });
    expect(ev!.cost).toEqual({ billedUsd: 2.5, currency: 'USD', confidence: 'billed' });
    expect(ev!.provider).toBe('openrouter');
    expect(ev!.naturalKey).toEqual(['activity', '2026-08-15', 'anthropic/claude-sonnet-4.5', 'ep_1', 'anthropic']);
  });

  it('returns null without a date', () => {
    expect(mapActivityRow({ model: 'x' })).toBeNull();
  });

  // Verbatim `/activity` response row from research/other-sources.md §4 (OpenRouter).
  it('maps the research-verbatim /activity row', () => {
    const ev = mapActivityRow({
      date: '2026-08-24',
      model: 'openai/gpt-4.1',
      model_permaslug: 'openai/gpt-4.1-2026-04-14',
      endpoint_id: '9f1c...-uuid',
      provider_name: 'OpenAI',
      usage: 4.21,
      byok_usage_inference: 0,
      requests: 130,
      prompt_tokens: 240000,
      completion_tokens: 18000,
      reasoning_tokens: 0,
    });
    expect(ev).not.toBeNull();
    expect(ev!.ts).toBe('2026-08-24T00:00:00.000Z');
    expect(ev!.usage).toEqual({ input: 240000, output: 18000, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, reasoning: 0, requests: 130 });
    expect(ev!.cost).toEqual({ billedUsd: 4.21, currency: 'USD', confidence: 'billed' });
    expect(ev!.meta).toEqual({ providerName: 'OpenAI', modelPermaslug: 'openai/gpt-4.1-2026-04-14', endpointId: '9f1c...-uuid', byokUsageInference: 0 });
    expect(ev!.naturalKey).toEqual(['activity', '2026-08-24', 'openai/gpt-4.1', '9f1c...-uuid', 'OpenAI']);
  });
});

describe('openrouterConnector.verify', () => {
  it('is ok with just an inference key and notes activity pulls are skipped without a management key', async () => {
    const ctx = ctxFor((url) => (url.pathname === '/api/v1/auth/key' ? { status: 200, body: { data: { label: 'my-key', usage: 12.5, limit: null } } } : undefined), []);
    const res = await openrouterConnector.verify(ctx, { apiKey: 'sk-or-1' });
    expect(res.ok).toBe(true);
    expect(res.message).toMatch(/usage to date \$12\.50 of unlimited/);
    expect(res.message).toMatch(/No management key provided/);
  });

  it('reports the management key valid when /credits succeeds', async () => {
    const ctx = ctxFor((url) => {
      if (url.pathname === '/api/v1/auth/key') return { status: 200, body: { data: { usage: 0, limit: 10 } } };
      if (url.pathname === '/api/v1/credits') return { status: 200, body: { data: {} } };
      return undefined;
    }, []);
    const res = await openrouterConnector.verify(ctx, { apiKey: 'sk-or-1', managementKey: 'sk-or-mgmt-1' });
    expect(res.ok).toBe(true);
    expect(res.message).toMatch(/Management key valid/);
  });

  it('gives a helpful message on 401', async () => {
    const ctx = ctxFor(() => ({ status: 401, body: { error: { message: 'No auth credentials found' } } }), []);
    const res = await openrouterConnector.verify(ctx, { apiKey: 'bad' });
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/OpenRouter API key rejected/);
    expect(res.message).toMatch(/No auth credentials found/);
  });
});

describe('openrouterConnector.pull', () => {
  it('does nothing (no throw) without a management key', async () => {
    const calls: Call[] = [];
    const ctx = ctxFor(() => undefined, calls);
    const events = [];
    for await (const ev of openrouterConnector.pull(ctx, { apiKey: 'sk-or-1' })) events.push(ev);
    expect(events).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  it('fetches /activity once, filters client-side to the resolved window, and persists the cursor', async () => {
    const calls: Call[] = [];
    const ctx = ctxFor(
      (url) =>
        url.pathname === '/api/v1/activity'
          ? {
              status: 200,
              body: {
                data: [
                  { date: '2026-08-10', model: 'gpt-5', usage: 1, prompt_tokens: 10, completion_tokens: 5 }, // outside window
                  { date: '2026-08-16', model: 'gpt-5', usage: 2, prompt_tokens: 20, completion_tokens: 8 }, // inside window
                ],
              },
            }
          : undefined,
      calls,
    );
    const events = [];
    for await (const ev of openrouterConnector.pull(ctx, { apiKey: 'sk-or-1', managementKey: 'sk-or-mgmt-1' }, { since: '2026-08-15T00:00:00.000Z', until: '2026-08-20T00:00:00.000Z' })) events.push(ev);
    expect(events).toHaveLength(1);
    expect(events[0]!.ts).toBe('2026-08-16T00:00:00.000Z');
    expect(calls).toHaveLength(1);
    expect((calls[0]!.init?.headers as Record<string, string>)['Authorization']).toBe('Bearer sk-or-mgmt-1');
    expect(ctx.stateMap.get('openrouter:last_pull')).toBe('2026-08-20T00:00:00.000Z');
  });

  it('swallows a 401/403 from /activity (insufficient scope) instead of throwing', async () => {
    const warnings: string[] = [];
    const ctx = ctxFor(() => ({ status: 403, body: { error: { message: 'requires a provisioning key' } } }), [], { log: { ...noopLogger, warn: (m: string) => void warnings.push(m) } });
    const events = [];
    for await (const ev of openrouterConnector.pull(ctx, { apiKey: 'sk-or-1', managementKey: 'sk-or-not-provisioning' })) events.push(ev);
    expect(events).toHaveLength(0);
    expect(warnings.some((w) => w.includes('403'))).toBe(true);
  });
});
