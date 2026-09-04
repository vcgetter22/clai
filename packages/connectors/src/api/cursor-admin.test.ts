import { describe, expect, it } from 'vitest';
import { CATALOG } from '@claii/core';
import { noopLogger, type ConnectorContext } from '../types.js';
import { cursorAdminConnector, mapDailyRow, mapUsageEvent } from './cursor-admin.js';

function memState() {
  const m = new Map<string, string>();
  return { get: (k: string) => m.get(k), set: (k: string, v: string) => void m.set(k, v), map: m };
}

interface Call {
  url: URL;
  init?: RequestInit;
  body: unknown;
}

type Route = (url: URL, body: unknown) => { status: number; body: unknown } | undefined;

function ctxFor(route: Route, calls: Call[], now = '2026-09-03T12:00:00.000Z'): ConnectorContext & { stateMap: Map<string, string> } {
  const st = memState();
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, init, body });
    const r = route(url, body);
    if (!r) throw new Error(`unhandled fetch in test: ${url.toString()} ${JSON.stringify(body)}`);
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { catalog: CATALOG, state: st, stateMap: st.map, log: noopLogger, now: () => new Date(now), home: '/home/x', env: {}, planFor: () => undefined, fetch: fetchImpl };
}

const memberNames = new Map([['dev@example.com', 'Dev One']]);

describe('mapUsageEvent', () => {
  it('maps tokenUsage, converts totalCents to billedUsd, and marks usage-based calls billing=api', () => {
    const ts = new Date(1755302400000).toISOString();
    const ev = mapUsageEvent(
      { timestamp: 1755302400000, userEmail: 'dev@example.com', model: 'gpt-5', kind: 'Usage-based', maxMode: true, isTokenBasedCall: true, tokenUsage: { inputTokens: 100, outputTokens: 50, cacheWriteTokens: 10, cacheReadTokens: 5, totalCents: 250 } },
      0,
      memberNames,
    );
    expect(ev).not.toBeNull();
    expect(ev!.ts).toBe(ts);
    expect(ev!.usage).toEqual({ input: 100, output: 50, cacheRead: 5, cacheWrite5m: 10, cacheWrite1h: 0, requests: 1 });
    expect(ev!.cost).toEqual({ billedUsd: 2.5, currency: 'USD', confidence: 'billed' });
    expect(ev!.billing).toBe('api');
    expect(ev!.surface).toBe('ide');
    expect(ev!.actor).toEqual({ email: 'dev@example.com', name: 'Dev One' });
    expect(ev!.context.tags).toEqual({ kind: 'Usage-based', maxMode: 'true' });
    expect(ev!.naturalKey).toEqual([ts, 'dev@example.com', 'gpt-5', 'Usage-based', '0']);
  });

  // Verbatim `POST /teams/filtered-usage-events` response row from research/other-sources.md §2.
  it('maps the research-verbatim usageEvents row, preferring top-level chargedCents over tokenUsage.totalCents', () => {
    const ev = mapUsageEvent(
      {
        timestamp: '1727712000000',
        userEmail: 'dev@company.com',
        model: 'claude-4-sonnet-thinking',
        kind: 'composer',
        maxMode: false,
        requestsCosts: 1,
        isTokenBasedCall: true,
        isChargeable: true,
        isHeadless: false,
        tokenUsage: { inputTokens: 12000, outputTokens: 800, cacheWriteTokens: 3000, cacheReadTokens: 9000, totalCents: 14, discountPercentOff: 0 },
        chargedCents: 14,
        cursorTokenFee: 0,
      },
      0,
      memberNames,
    );
    expect(ev).not.toBeNull();
    expect(ev!.usage).toEqual({ input: 12000, output: 800, cacheRead: 9000, cacheWrite5m: 3000, cacheWrite1h: 0, requests: 1 });
    expect(ev!.cost).toEqual({ billedUsd: 0.14, currency: 'USD', confidence: 'billed' });
    expect(ev!.meta).toEqual({ requestsCosts: 1, isChargeable: true, isHeadless: false, cursorTokenFee: 0, discountPercentOff: 0 });
  });

  it('prefers chargedCents over tokenUsage.totalCents when they diverge, and zeros billedUsd when isChargeable is false', () => {
    const notCharged = mapUsageEvent({ timestamp: 1755302400000, userEmail: 'x@example.com', model: 'gpt-5', isChargeable: false, chargedCents: 0, tokenUsage: { totalCents: 500 } }, 0, memberNames);
    expect(notCharged!.cost).toEqual({ billedUsd: 0, currency: 'USD', confidence: 'billed' });

    const divergent = mapUsageEvent({ timestamp: 1755302400000, userEmail: 'x@example.com', model: 'gpt-5', chargedCents: 7, tokenUsage: { totalCents: 500 } }, 0, memberNames);
    expect(divergent!.cost).toEqual({ billedUsd: 0.07, currency: 'USD', confidence: 'billed' });
  });

  it('treats a non-usage-based, non-token call as subscription billing with no cost', () => {
    const ev = mapUsageEvent({ timestamp: 1755302400000, userEmail: 'x@example.com', model: 'claude-opus-5', kind: 'Included in Business', maxMode: false, isTokenBasedCall: false, tokenUsage: { inputTokens: 1, outputTokens: 1 } }, 3, memberNames);
    expect(ev!.billing).toBe('subscription');
    expect(ev!.cost).toBeUndefined();
    expect(ev!.context.tags).toEqual({ kind: 'Included in Business', maxMode: 'false' });
    expect(ev!.naturalKey?.[4]).toBe('3');
    expect(ev!.actor).toEqual({ email: 'x@example.com' }); // no member match -> no name
  });

  it('returns null without a usable timestamp', () => {
    expect(mapUsageEvent({ userEmail: 'x@example.com' }, 0, memberNames)).toBeNull();
  });
});

describe('mapDailyRow', () => {
  it('sums composer+chat+agent+cmdk requests, zeros token usage, and maps meta fields', () => {
    const ev = mapDailyRow(
      {
        userId: 'u_1',
        date: 1755302400000,
        email: 'dev@example.com',
        isActive: true,
        totalLinesAdded: 120,
        totalLinesDeleted: 15,
        acceptedLinesAdded: 80,
        acceptedLinesDeleted: 5,
        totalTabsShown: 40,
        totalTabsAccepted: 30,
        composerRequests: 3,
        chatRequests: 2,
        agentRequests: 1,
        cmdkUsages: 4,
        subscriptionIncludedReqs: 9,
        apiKeyReqs: 0,
        usageBasedReqs: 1,
        mostUsedModel: 'claude-opus-5',
        clientVersion: '1.2.3',
      },
      memberNames,
    );
    expect(ev).not.toBeNull();
    expect(ev!.granularity).toBe('day');
    expect(ev!.model).toBe('claude-opus-5');
    expect(ev!.usage).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, requests: 10 });
    expect(ev!.meta).toEqual({
      linesAdded: 120,
      linesDeleted: 15,
      acceptedLinesAdded: 80,
      acceptedLinesDeleted: 5,
      tabsShown: 40,
      tabsAccepted: 30,
      cmdkUsages: 4,
      subscriptionIncludedReqs: 9,
      apiKeyReqs: 0,
      usageBasedReqs: 1,
      mostUsedModel: 'claude-opus-5',
      clientVersion: '1.2.3',
      isActive: true,
    });
    // email wins over userId as the actor identity when both are present, but userId still rides along.
    expect(ev!.actor).toEqual({ email: 'dev@example.com', userId: 'u_1', name: 'Dev One' });
    expect(ev!.naturalKey).toEqual(['daily', new Date(1755302400000).toISOString().slice(0, 10), 'dev@example.com']);
  });

  it('falls back to userId in the natural key/actor when email is absent', () => {
    const ev = mapDailyRow({ userId: 42, date: 1755302400000, composerRequests: 1 }, memberNames);
    expect(ev!.actor).toEqual({ userId: '42' });
    expect(ev!.naturalKey).toEqual(['daily', new Date(1755302400000).toISOString().slice(0, 10), '42']);
  });
});

describe('cursorAdminConnector.verify', () => {
  it('sends HTTP Basic auth (key as username, empty password) and reports member count', async () => {
    const calls: Call[] = [];
    const ctx = ctxFor((url) => (url.pathname === '/teams/members' ? { status: 200, body: { teamMembers: [{ email: 'a@x.com', name: 'A' }, { email: 'b@x.com', name: 'B' }] } } : undefined), calls);
    const res = await cursorAdminConnector.verify(ctx, { apiKey: 'cursor_key_1' });
    expect(res.ok).toBe(true);
    expect(res.message).toMatch(/2 team members visible/);
    const auth = (calls[0]!.init?.headers as Record<string, string>)['Authorization'];
    expect(auth).toBe(`Basic ${Buffer.from('cursor_key_1:', 'utf8').toString('base64')}`);
    // /teams/members is a GET per research/other-sources.md §2, not a POST.
    expect(calls[0]!.init?.method).toBe('GET');
    expect(calls[0]!.body).toBeUndefined();
  });

  it('gives a helpful message on 401', async () => {
    const ctx = ctxFor(() => ({ status: 401, body: { error: { message: 'invalid API key' } } }), []);
    const res = await cursorAdminConnector.verify(ctx, { apiKey: 'bad' });
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/Cursor API key rejected/);
    expect(res.message).toMatch(/invalid API key/);
  });
});

describe('cursorAdminConnector.pull', () => {
  it('paginates filtered-usage-events (index resets per page), pulls daily-usage-data, and persists both cursors', async () => {
    const calls: Call[] = [];
    const fullPage = Array.from({ length: 200 }, (_, i) => ({ timestamp: 1755302400000 + i, userEmail: 'dev@example.com', model: 'gpt-5', kind: 'Usage-based', isTokenBasedCall: true, tokenUsage: { inputTokens: 1, outputTokens: 1, totalCents: 1 } }));
    const shortPage = [{ timestamp: 1755400000000, userEmail: 'dev@example.com', model: 'gpt-5', kind: 'Usage-based', isTokenBasedCall: true, tokenUsage: { inputTokens: 2, outputTokens: 2 } }];

    const ctx = ctxFor((url, body) => {
      if (url.pathname === '/teams/members') return { status: 200, body: { teamMembers: [{ email: 'dev@example.com', name: 'Dev One' }] } };
      if (url.pathname === '/teams/filtered-usage-events') {
        const b = body as { page: number; pageSize: number; startDate: number; endDate: number };
        expect(b.pageSize).toBe(200);
        return b.page === 1 ? { status: 200, body: { usageEvents: fullPage, totalUsageEventsCount: 201 } } : { status: 200, body: { usageEvents: shortPage, totalUsageEventsCount: 201 } };
      }
      if (url.pathname === '/teams/daily-usage-data') {
        return { status: 200, body: { data: [{ date: 1755302400000, email: 'dev@example.com', composerRequests: 1, chatRequests: 1, agentRequests: 0, mostUsedModel: 'gpt-5' }] } };
      }
      return undefined;
    }, calls);

    const events = [];
    for await (const ev of cursorAdminConnector.pull(ctx, { apiKey: 'cursor_key_1' }, { since: '2026-08-01T00:00:00.000Z', until: '2026-08-31T00:00:00.000Z' })) events.push(ev);

    const usageEvents = events.filter((e) => e.granularity === 'request');
    const dailyEvents = events.filter((e) => e.granularity === 'day');
    expect(usageEvents).toHaveLength(201); // 200 (full page) + 1 (short page)
    expect(dailyEvents).toHaveLength(1);
    expect(usageEvents[0]!.actor.name).toBe('Dev One'); // enriched from /teams/members

    const eventCalls = calls.filter((c) => c.url.pathname === '/teams/filtered-usage-events');
    expect(eventCalls).toHaveLength(2);
    expect((eventCalls[0]!.body as { page: number }).page).toBe(1);
    expect((eventCalls[1]!.body as { page: number }).page).toBe(2);
    // Index-within-page resets: first row of page 2 gets index 0, not 200.
    expect(usageEvents[200]!.naturalKey?.[4]).toBe('0');

    expect(calls.filter((c) => c.url.pathname === '/teams/daily-usage-data')).toHaveLength(1);
    expect(ctx.stateMap.get('cursor-admin:events:last_pull')).toBe('2026-08-31T00:00:00.000Z');
    expect(ctx.stateMap.get('cursor-admin:daily:last_pull')).toBe('2026-08-31T00:00:00.000Z');

    const membersCall = calls.find((c) => c.url.pathname === '/teams/members')!;
    expect(membersCall.init?.method).toBe('GET');
  });

  it('paginates daily-usage-data with page/pageSize until a short page comes back', async () => {
    const calls: Call[] = [];
    // The connector's daily-usage-data page size is 500 — a full first page must trigger a 2nd request.
    const pageOne = Array.from({ length: 500 }, (_, i) => ({ date: 1755302400000, email: `u${i}@example.com`, isActive: true, composerRequests: 1 }));
    const pageTwo = [{ date: 1755302400000, email: 'last@example.com', isActive: true, composerRequests: 1 }];

    const ctx = ctxFor((url, body) => {
      if (url.pathname === '/teams/members') return { status: 200, body: { teamMembers: [] } };
      if (url.pathname === '/teams/filtered-usage-events') return { status: 200, body: { usageEvents: [] } };
      if (url.pathname === '/teams/daily-usage-data') {
        const b = body as { page: number; pageSize: number };
        expect(b.pageSize).toBe(500);
        return b.page === 1 ? { status: 200, body: { data: pageOne } } : { status: 200, body: { data: pageTwo } };
      }
      return undefined;
    }, calls);

    const events = [];
    for await (const ev of cursorAdminConnector.pull(ctx, { apiKey: 'cursor_key_1' }, { since: '2026-08-01T00:00:00.000Z', until: '2026-08-31T00:00:00.000Z' })) events.push(ev);
    const dailyCalls = calls.filter((c) => c.url.pathname === '/teams/daily-usage-data');
    expect(dailyCalls).toHaveLength(2);
    expect((dailyCalls[0]!.body as { page: number }).page).toBe(1);
    expect((dailyCalls[1]!.body as { page: number }).page).toBe(2);
    expect(events.filter((e) => e.granularity === 'day')).toHaveLength(501);
  });
});
