import { describe, expect, it } from 'vitest';
import { CATALOG } from '@claii/core';
import { noopLogger, type ConnectorContext } from '../types.js';
import { pullAnalyticsCost, pullAnalyticsUsage, verifyAnalyticsKey } from './anthropic-analytics.js';

/**
 * Claude Enterprise Analytics API (`/v1/organizations/analytics/*`) — research/anthropic-sources.md
 * §5.3. Fixtures below use the section's full quoted example responses verbatim where available.
 */

function memState() {
  const m = new Map<string, string>();
  return { get: (k: string) => m.get(k), set: (k: string, v: string) => void m.set(k, v), map: m };
}

interface Call {
  url: URL;
  init?: RequestInit;
}

type Route = (url: URL) => { status: number; body: unknown } | undefined;

function ctxFor(route: Route, calls: Call[], now = '2026-09-03T12:00:00.000Z'): ConnectorContext & { stateMap: Map<string, string> } {
  const st = memState();
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    const r = route(url);
    if (!r) throw new Error(`unhandled fetch in test: ${url.toString()}`);
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { catalog: CATALOG, state: st, stateMap: st.map, log: noopLogger, now: () => new Date(now), home: '/home/x', env: {}, planFor: () => undefined, fetch: fetchImpl };
}

describe('pullAnalyticsUsage — verbatim §5.3 /usage_report example', () => {
  it('maps the full quoted example response (product/rbac_group_id/slack_channel_id -> meta, rbac_group_id -> actor.workspaceId)', async () => {
    const calls: Call[] = [];
    const ctx = ctxFor(
      (url) =>
        url.pathname === '/v1/organizations/analytics/usage_report'
          ? {
              status: 200,
              body: {
                data: [
                  {
                    ending_at: '2019-12-27T18:11:19.117Z',
                    results: [
                      {
                        cache_creation: { ephemeral_1h_input_tokens: 1000, ephemeral_5m_input_tokens: 500 },
                        cache_read_input_tokens: 0,
                        context_window: '0-200k',
                        inference_geo: 'global',
                        model: 'claude-opus-5',
                        output_tokens: 0,
                        product: 'chat',
                        rbac_group_id: 'rbac_group_012rppKaSVsmTo6NqRDXQXNF',
                        requests: 0,
                        server_tool_use: { web_search_requests: 10 },
                        slack_channel_id: 'C0123ABCDEF',
                        speed: 'fast',
                        uncached_input_tokens: 0,
                      },
                    ],
                    starting_at: '2019-12-27T18:11:19.117Z',
                  },
                ],
                data_refreshed_at: '2019-12-27T18:11:19.117Z',
                // has_more/next_page set to close the loop in one page (the research example's literal
                // `true`/`"next_page"` values are illustrative pagination placeholders, not row data).
                has_more: false,
                next_page: null,
                organization_id: 'org_013FP9SaFPBg7Kw7fetjn6cF',
              },
            }
          : undefined,
      calls,
    );
    const events = [];
    for await (const ev of pullAnalyticsUsage(ctx, 'ana_1', '2026-08-01T00:00:00.000Z', '2026-08-20T00:00:00.000Z')) events.push(ev);
    expect(events).toHaveLength(1);
    const ev = events[0]!;
    expect(ev.model).toBe('claude-opus-5');
    expect(ev.surface).toBe('api'); // no service_tier on this row -> not 'batch'
    expect(ev.usage).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite5m: 500, cacheWrite1h: 1000, requests: 0, webSearches: 10 });
    expect(ev.actor).toEqual({ workspaceId: 'rbac_group_012rppKaSVsmTo6NqRDXQXNF' });
    expect(ev.meta).toEqual({
      contextWindow: '0-200k',
      speed: 'fast',
      inferenceGeo: 'global',
      api: 'enterprise-analytics',
      product: 'chat',
      rbacGroupId: 'rbac_group_012rppKaSVsmTo6NqRDXQXNF',
      slackChannelId: 'C0123ABCDEF',
    });
    expect(ev.naturalKey?.slice(0, 2)).toEqual(['usage', 'analytics']);

    const call = calls.find((c) => c.url.pathname === '/v1/organizations/analytics/usage_report')!;
    expect(call.url.searchParams.get('starting_at')).toBe('2026-08-01T00:00:00.000Z');
    expect(call.url.searchParams.getAll('group_by[]')).toEqual(['model', 'service_tier', 'context_window']);
  });
});

describe('pullAnalyticsCost — §5.3 cost convention (decimal-string cents)', () => {
  it('converts amount to billedUsd dollars, matching the "41280.000000" = $412.80 example', async () => {
    const calls: Call[] = [];
    const ctx = ctxFor(
      (url) =>
        url.pathname === '/v1/organizations/analytics/cost_report'
          ? {
              status: 200,
              body: {
                data: [
                  {
                    starting_at: '2026-08-01T00:00:00Z',
                    ending_at: '2026-08-02T00:00:00Z',
                    results: [{ amount: '41280.000000', currency: 'USD', cost_type: 'tokens', model: 'claude-opus-5', token_type: 'output_tokens', description: 'Claude Opus 5 output tokens' }],
                  },
                ],
                has_more: false,
                next_page: null,
              },
            }
          : undefined,
      calls,
    );
    const events = [];
    for await (const ev of pullAnalyticsCost(ctx, 'ana_1', '2026-08-01T00:00:00.000Z', '2026-08-02T00:00:00.000Z')) events.push(ev);
    expect(events).toHaveLength(1);
    expect(events[0]!.cost).toEqual({ billedUsd: 412.8, currency: 'USD', confidence: 'billed' });
    expect(events[0]!.meta?.['api']).toBe('enterprise-analytics');
    expect(events[0]!.naturalKey?.slice(0, 2)).toEqual(['cost', 'analytics']);
  });
});

describe('verifyAnalyticsKey', () => {
  it('is ok when /analytics/usage_report succeeds', async () => {
    const ctx = ctxFor((url) => (url.pathname === '/v1/organizations/analytics/usage_report' ? { status: 200, body: { data: [], has_more: false, next_page: null } } : undefined), []);
    const res = await verifyAnalyticsKey(ctx, 'ana_1');
    expect(res.ok).toBe(true);
    expect(res.message).toMatch(/Analytics API key/);
  });

  it('gives a helpful message on 401', async () => {
    const ctx = ctxFor(() => ({ status: 401, body: { error: { message: 'invalid x-api-key' } } }), []);
    const res = await verifyAnalyticsKey(ctx, 'bad');
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/Analytics API key rejected/);
  });

  it('fails clearly with no key', async () => {
    const res = await verifyAnalyticsKey(ctxFor(() => undefined, []), '');
    expect(res.ok).toBe(false);
  });
});
