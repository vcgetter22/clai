import { describe, expect, it } from 'vitest';
import { CATALOG } from '@claii/core';
import { noopLogger, type ConnectorContext } from '../types.js';
import { anthropicAdminConnector, anthropicClaudeCodeConnector, mapClaudeCodeDay, mapCostResult, mapUsageResult } from './anthropic-admin.js';

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

const idNamePage = (items: Array<{ id: string; name: string }>) => ({ status: 200, body: { data: items, has_more: false, last_id: null } });

describe('mapUsageResult / mapCostResult (pure mapping)', () => {
  it('maps a usage_report/messages row: uncached input, cache breakdown, service tier -> surface', () => {
    const ev = mapUsageResult(
      '2026-08-01T00:00:00Z',
      '2026-08-02T00:00:00Z',
      {
        uncached_input_tokens: 100,
        cache_creation: { ephemeral_5m_input_tokens: 10, ephemeral_1h_input_tokens: 0 },
        cache_read_input_tokens: 5,
        output_tokens: 200,
        model: 'claude-opus-5',
        service_tier: 'standard',
        context_window: '0-200k',
        api_key_id: 'apikey_1',
        workspace_id: 'ws_1',
        requests: 3,
      },
      { granularity: 'day', apiKeyNames: new Map([['apikey_1', 'prod-key']]), workspaceNames: new Map([['ws_1', 'Production']]) },
    );
    expect(ev.usage).toEqual({ input: 100, output: 200, cacheRead: 5, cacheWrite5m: 10, cacheWrite1h: 0, requests: 3, webSearches: 0 });
    expect(ev.surface).toBe('api');
    expect(ev.actor).toEqual({ apiKeyId: 'apikey_1', apiKeyName: 'prod-key', workspaceId: 'ws_1', workspaceName: 'Production' });
    expect(ev.naturalKey).toEqual(['usage', '2026-08-01T00:00:00Z', 'claude-opus-5', 'standard', 'apikey_1', 'ws_1', '0-200k']);
  });

  it('marks batch service tier as surface batch', () => {
    const ev = mapUsageResult('2026-08-01T00:00:00Z', '2026-08-02T00:00:00Z', { model: 'claude-haiku-5', service_tier: 'batch' }, { granularity: 'day' });
    expect(ev.surface).toBe('batch');
  });

  it('converts cost_report amount (cents, string) to billedUsd dollars', () => {
    const ev = mapCostResult('2026-08-01T00:00:00Z', '2026-08-02T00:00:00Z', {
      amount: '1234',
      currency: 'USD',
      cost_type: 'tokens',
      model: 'claude-opus-5',
      context_window: '0-200k',
      service_tier: 'standard',
      token_type: 'output',
      workspace_id: 'ws_1',
      description: 'Claude Opus 5 output tokens',
    });
    expect(ev.cost).toEqual({ billedUsd: 12.34, currency: 'USD', confidence: 'billed' });
    expect(ev.naturalKey).toEqual(['cost', '2026-08-01T00:00:00Z', 'ws_1', 'Claude Opus 5 output tokens', 'output', 'tokens']);
  });
});

describe('mapClaudeCodeDay (pure mapping)', () => {
  it('splits model_breakdown into one event per model, cents -> providerEstimateUsd', () => {
    const evs = mapClaudeCodeDay({
      date: '2026-08-15',
      actor: { type: 'user_actor', email_address: 'dev@example.com' },
      organization_id: 'org_1',
      customer_type: 'subscription',
      terminal_type: 'vscode',
      core_metrics: { num_sessions: 4, lines_of_code: { added: 120, removed: 30 }, commits_by_claude_code: 1, pull_requests_by_claude_code: 0 },
      model_breakdown: [
        { model: 'claude-opus-5', tokens: { input: 10, output: 20, cache_read: 5, cache_creation: 7 }, estimated_cost: { currency: 'USD', amount: 500 } },
        { model: 'claude-haiku-5', tokens: { input: 1, output: 2 } },
      ],
    });
    expect(evs).toHaveLength(2);
    expect(evs[0]!.usage).toEqual({ input: 10, output: 20, cacheRead: 5, cacheWrite5m: 7, cacheWrite1h: 0, requests: 0 });
    expect(evs[0]!.cost).toEqual({ billedUsd: null });
    expect(evs[0]!.meta?.['providerEstimateUsd']).toBeCloseTo(5.0, 5);
    expect(evs[0]!.billing).toBe('subscription');
    expect(evs[0]!.actor).toEqual({ email: 'dev@example.com', apiKeyId: undefined, apiKeyName: undefined });
    expect(evs[0]!.context.tags).toEqual({ terminalType: 'vscode', customerType: 'subscription' });
    expect(evs[0]!.naturalKey).toEqual(['claude-code', '2026-08-15', 'dev@example.com', 'claude-opus-5']);
    expect(evs[1]!.meta?.['providerEstimateUsd']).toBeUndefined();
  });
});

describe('mapClaudeCodeDay — verbatim research example', () => {
  // Full quoted example response from research/anthropic-sources.md §1.4 (claude-code-analytics-api),
  // including `tool_actions`, verbatim.
  it('matches the research §1.4 example response byte-for-byte', () => {
    const evs = mapClaudeCodeDay({
      date: '2025-09-08T00:00:00Z',
      actor: { type: 'user_actor', email_address: 'developer@company.com' },
      organization_id: 'dc9f6c26-b22c-4831-8d01-0446bada88f1',
      customer_type: 'api',
      terminal_type: 'vscode',
      core_metrics: {
        num_sessions: 5,
        lines_of_code: { added: 1543, removed: 892 },
        commits_by_claude_code: 12,
        pull_requests_by_claude_code: 2,
      },
      tool_actions: {
        edit_tool: { accepted: 45, rejected: 5 },
        multi_edit_tool: { accepted: 12, rejected: 2 },
        write_tool: { accepted: 8, rejected: 1 },
        notebook_edit_tool: { accepted: 3, rejected: 0 },
      },
      model_breakdown: [
        {
          model: 'claude-opus-5',
          tokens: { input: 100000, output: 35000, cache_read: 10000, cache_creation: 5000 },
          estimated_cost: { currency: 'USD', amount: 141 },
        },
      ],
    });
    expect(evs).toHaveLength(1);
    const ev = evs[0]!;
    expect(ev.ts).toBe('2025-09-08T00:00:00Z');
    expect(ev.billing).toBe('api'); // customer_type: 'api'
    expect(ev.actor).toEqual({ email: 'developer@company.com', apiKeyId: undefined, apiKeyName: undefined });
    expect(ev.usage).toEqual({ input: 100000, output: 35000, cacheRead: 10000, cacheWrite5m: 5000, cacheWrite1h: 0, requests: 0 });
    // 100000 input + 35000 output + 10000 cache_read + 5000 cache_creation on Opus 5 = $1.41 -> amount: 141 cents.
    expect(ev.meta?.['providerEstimateUsd']).toBeCloseTo(1.41, 5);
    expect(ev.meta?.['organizationId']).toBe('dc9f6c26-b22c-4831-8d01-0446bada88f1');
    expect(ev.meta?.['coreMetrics']).toEqual({ sessions: 5, linesAdded: 1543, linesRemoved: 892, commits: 12, pullRequests: 2 });
    expect(ev.meta?.['toolActions']).toEqual({
      editTool: { accepted: 45, rejected: 5 },
      multiEditTool: { accepted: 12, rejected: 2 },
      writeTool: { accepted: 8, rejected: 1 },
      notebookEditTool: { accepted: 3, rejected: 0 },
    });
  });
});

describe('anthropicAdminConnector.verify (Console Admin key)', () => {
  it('reports ok with an api_keys count on success', async () => {
    const calls: Call[] = [];
    const ctx = ctxFor((url) => (url.pathname === '/v1/organizations/api_keys' ? idNamePage([{ id: 'apikey_1', name: 'prod-key' }]) : undefined), calls);
    const res = await anthropicAdminConnector.verify(ctx, { adminKey: 'sk-ant-admin01-xyz' });
    expect(res.ok).toBe(true);
    expect(res.message).toMatch(/API keys visible: yes/);
    expect(calls[0]!.url.pathname).toBe('/v1/organizations/api_keys');
    expect((calls[0]!.init?.headers as Record<string, string>)['x-api-key']).toBe('sk-ant-admin01-xyz');
  });

  it('gives a helpful message on 401', async () => {
    const calls: Call[] = [];
    const ctx = ctxFor(() => ({ status: 401, body: { error: { message: 'invalid x-api-key' } } }), calls);
    const res = await anthropicAdminConnector.verify(ctx, { adminKey: 'bad-key' });
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/Admin API key rejected/);
    expect(res.message).toMatch(/invalid x-api-key/);
  });

  it('fails clearly when no credential is provided', async () => {
    const ctx = ctxFor(() => undefined, []);
    const res = await anthropicAdminConnector.verify(ctx, {});
    expect(res.ok).toBe(false);
  });
});

describe('anthropicAdminConnector.pull (Console Admin key)', () => {
  it('paginates usage_report/messages, converts cost_report cents to dollars, and persists cursors', async () => {
    const calls: Call[] = [];
    const usagePage1 = {
      status: 200,
      body: {
        data: [{ starting_at: '2026-08-01T00:00:00Z', ending_at: '2026-08-02T00:00:00Z', results: [{ uncached_input_tokens: 1, output_tokens: 2, model: 'claude-opus-5', service_tier: 'standard', api_key_id: 'apikey_1', workspace_id: 'ws_1' }] }],
        has_more: true,
        next_page: 'page2',
      },
    };
    const usagePage2 = {
      status: 200,
      body: {
        data: [{ starting_at: '2026-08-02T00:00:00Z', ending_at: '2026-08-03T00:00:00Z', results: [{ uncached_input_tokens: 3, output_tokens: 4, model: 'claude-opus-5', service_tier: 'standard', api_key_id: 'apikey_1', workspace_id: 'ws_1' }] }],
        has_more: false,
        next_page: null,
      },
    };
    const costPage = {
      status: 200,
      body: {
        data: [{ starting_at: '2026-08-01T00:00:00Z', ending_at: '2026-08-02T00:00:00Z', results: [{ amount: '500', workspace_id: 'ws_1', description: 'tokens', token_type: 'output', cost_type: 'tokens' }] }],
        has_more: false,
        next_page: null,
      },
    };
    const ctx = ctxFor((url) => {
      if (url.pathname === '/v1/organizations/api_keys') return idNamePage([{ id: 'apikey_1', name: 'prod-key' }]);
      if (url.pathname === '/v1/organizations/workspaces') return idNamePage([{ id: 'ws_1', name: 'Production' }]);
      if (url.pathname === '/v1/organizations/usage_report/messages') return url.searchParams.get('page') === 'page2' ? usagePage2 : usagePage1;
      if (url.pathname === '/v1/organizations/cost_report') return costPage;
      return undefined;
    }, calls);

    const events = [];
    for await (const ev of anthropicAdminConnector.pull(ctx, { adminKey: 'sk-ant-admin01-xyz' })) events.push(ev);

    // 2 usage-report rows (across 2 pages) + 1 cost-report row.
    expect(events).toHaveLength(3);
    const usageEvents = events.filter((e) => e.naturalKey?.[0] === 'usage');
    expect(usageEvents.map((e) => e.usage.input)).toEqual([1, 3]);
    expect(usageEvents[0]!.actor.apiKeyName).toBe('prod-key');
    expect(usageEvents[0]!.actor.workspaceName).toBe('Production');
    const costEvent = events.find((e) => e.naturalKey?.[0] === 'cost')!;
    expect(costEvent.cost).toEqual({ billedUsd: 5, currency: 'USD', confidence: 'billed' });

    // Pagination: the group_by[] array param round-trips, and the 2nd usage call carries page=page2.
    const usageCalls = calls.filter((c) => c.url.pathname === '/v1/organizations/usage_report/messages');
    expect(usageCalls).toHaveLength(2);
    expect(usageCalls[1]!.url.searchParams.get('page')).toBe('page2');
    expect(usageCalls[0]!.url.searchParams.getAll('group_by[]')).toContain('api_key_id');

    // Cursors persisted for both usage and cost streams.
    expect(ctx.stateMap.get('anthropic-admin:usage:last_pull')).toBe('2026-09-03T12:00:00.000Z');
    expect(ctx.stateMap.get('anthropic-admin:cost:last_pull')).toBe('2026-09-03T12:00:00.000Z');
  });
});

describe('anthropicAdminConnector — Enterprise Analytics key dispatch', () => {
  it('verify() and pull() hit /analytics/* endpoints and tag meta.api', async () => {
    const calls: Call[] = [];
    const ctx = ctxFor((url) => {
      if (url.pathname === '/v1/organizations/analytics/usage_report') {
        return { status: 200, body: { data: [{ starting_at: '2026-08-01T00:00:00Z', ending_at: '2026-08-02T00:00:00Z', results: [{ uncached_input_tokens: 9, output_tokens: 1, model: 'claude-opus-5' }] }], has_more: false, next_page: null } };
      }
      if (url.pathname === '/v1/organizations/analytics/cost_report') {
        return { status: 200, body: { data: [], has_more: false, next_page: null } };
      }
      return undefined;
    }, calls);

    const verifyRes = await anthropicAdminConnector.verify(ctx, { analyticsKey: 'ana_1' });
    expect(verifyRes.ok).toBe(true);

    const events = [];
    for await (const ev of anthropicAdminConnector.pull(ctx, { analyticsKey: 'ana_1' })) events.push(ev);
    expect(events).toHaveLength(1);
    expect(events[0]!.meta?.['api']).toBe('enterprise-analytics');
    expect(events[0]!.naturalKey?.slice(0, 2)).toEqual(['usage', 'analytics']);
    expect(calls.some((c) => c.url.pathname === '/v1/organizations/analytics/usage_report')).toBe(true);
  });
});

describe('anthropicClaudeCodeConnector', () => {
  it('verify() ok, and pull() walks each day in the window and persists the cursor', async () => {
    const calls: Call[] = [];
    const ctx = ctxFor((url) => {
      if (url.pathname === '/v1/organizations/usage_report/claude_code') {
        return {
          status: 200,
          body: { data: [{ date: url.searchParams.get('starting_at'), actor: { type: 'user_actor', email_address: 'dev@example.com' }, model_breakdown: [{ model: 'claude-opus-5', tokens: { input: 1, output: 1 } }] }], has_more: false, next_page: null },
        };
      }
      return undefined;
    }, calls);

    const verifyRes = await anthropicClaudeCodeConnector.verify(ctx, { adminKey: 'sk-ant-admin01-xyz' });
    expect(verifyRes.ok).toBe(true);

    const events = [];
    for await (const ev of anthropicClaudeCodeConnector.pull(ctx, { adminKey: 'sk-ant-admin01-xyz' }, { since: '2026-08-30T00:00:00.000Z', until: '2026-09-02T00:00:00.000Z' })) events.push(ev);
    // One event per day in [Aug 30 .. Sep 2] inclusive = 4 days.
    expect(events).toHaveLength(4);
    expect(ctx.stateMap.get('anthropic-claude-code:last_pull')).toBe('2026-09-02T00:00:00.000Z');
  });
});
