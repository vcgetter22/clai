import { describe, expect, it } from 'vitest';
import { CATALOG } from '@claii/core';
import { noopLogger, type ConnectorContext } from '../types.js';
import { githubCopilotConnector, mapBillingUsageItem, mapSeat, mapUserMetricsRow } from './github-copilot.js';

function memState() {
  const m = new Map<string, string>();
  return { get: (k: string) => m.get(k), set: (k: string, v: string) => void m.set(k, v), map: m };
}

interface Call {
  url: URL;
  init?: RequestInit;
}

interface RouteResult {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
  /** Return `body` as raw response text (for the NDJSON download links) instead of JSON.stringify-ing it. */
  raw?: boolean;
}

type Route = (url: URL) => RouteResult | undefined;

function ctxFor(route: Route, calls: Call[], now = '2026-09-03T12:00:00.000Z'): ConnectorContext & { stateMap: Map<string, string> } {
  const st = memState();
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    const r = route(url);
    if (!r) throw new Error(`unhandled fetch in test: ${url.toString()}`);
    const text = r.raw ? (r.body as string) : JSON.stringify(r.body);
    return new Response(text, { status: r.status, headers: { 'content-type': r.raw ? 'text/plain' : 'application/json', ...r.headers } });
  }) as typeof fetch;
  return { catalog: CATALOG, state: st, stateMap: st.map, log: noopLogger, now: () => new Date(now), home: '/home/x', env: {}, planFor: () => undefined, fetch: fetchImpl };
}

describe('mapSeat', () => {
  it('maps assignee.login to actor.userId and seat fields to meta', () => {
    const now = new Date('2026-09-03T12:00:00.000Z');
    const ev = mapSeat({ assignee: { login: 'alice' }, last_activity_at: '2026-08-30T00:00:00Z', last_activity_editor: 'vscode/1.90.0', plan_type: 'business', pending_cancellation_date: null }, now);
    expect(ev).not.toBeNull();
    expect(ev!.actor).toEqual({ userId: 'alice' });
    expect(ev!.usage).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, requests: 0 });
    expect(ev!.meta).toEqual({ lastActivityAt: '2026-08-30T00:00:00Z', lastActivityEditor: 'vscode/1.90.0', planType: 'business' });
    expect(ev!.naturalKey).toEqual(['seat', '2026-09-03', 'alice']);
    expect(ev!.surface).toBe('ide');
  });

  it('returns null for a seat with no assignee login', () => {
    expect(mapSeat({}, new Date())).toBeNull();
  });
});

describe('mapUserMetricsRow', () => {
  it('converts ai_credits_used to billedUsd at $0.01/credit, confidence estimated', () => {
    const ev = mapUserMetricsRow({ date: '2026-08-30', login: 'alice', ai_credits_used: 12.5 });
    expect(ev).not.toBeNull();
    expect(ev!.ts).toBe('2026-08-30T00:00:00.000Z');
    expect(ev!.cost).toEqual({ billedUsd: 0.125, currency: 'USD', confidence: 'estimated' });
    expect(ev!.meta).toEqual({ aiCreditsUsed: 12.5 });
    expect(ev!.actor).toEqual({ userId: 'alice' });
    expect(ev!.naturalKey).toEqual(['metrics', '2026-08-30', 'alice']);
  });

  it('returns null without a date', () => {
    expect(mapUserMetricsRow({ login: 'alice', ai_credits_used: 1 })).toBeNull();
  });

  // Confirmed per-user NDJSON field names from research/other-sources.md §3 (no single ready-made
  // example object is given there, so this uses every confirmed field name at once, `day`/`user_login`
  // preferred over the defensive `date`/`login` fallback spellings).
  it('reads every confirmed per-user metrics field into meta', () => {
    const ev = mapUserMetricsRow({
      day: '2026-08-30',
      user_id: 'U_123',
      user_login: 'alice',
      enterprise_id: 'E_1',
      ai_adoption_phase: 'adopted',
      ai_credits_used: 12.5,
      code_acceptance_activity_count: 7,
      code_generation_activity_count: 20,
      loc_added_sum: 150,
      loc_deleted_sum: 40,
    });
    expect(ev).not.toBeNull();
    expect(ev!.actor).toEqual({ userId: 'alice' });
    expect(ev!.cost).toEqual({ billedUsd: 0.125, currency: 'USD', confidence: 'estimated' });
    expect(ev!.meta).toEqual({
      aiCreditsUsed: 12.5,
      enterpriseId: 'E_1',
      aiAdoptionPhase: 'adopted',
      codeAcceptanceActivityCount: 7,
      codeGenerationActivityCount: 20,
      locAdded: 150,
      locDeleted: 40,
    });
  });
});

describe('mapBillingUsageItem', () => {
  it('maps quantity to requests and netAmount to a billed cost', () => {
    const ev = mapBillingUsageItem({ date: '2026-08-30', product: 'copilot', sku: 'copilot_premium_requests', quantity: 120, netAmount: 9.99, unitType: 'requests' }, 0);
    expect(ev).not.toBeNull();
    expect(ev!.usage.requests).toBe(120);
    expect(ev!.cost).toEqual({ billedUsd: 9.99, currency: 'USD', confidence: 'billed' });
    expect(ev!.model).toBe('copilot_premium_requests');
    expect(ev!.context.tags).toEqual({ sku: 'copilot_premium_requests', unitType: 'requests' });
    expect(ev!.naturalKey).toEqual(['billing', '2026-08-30', 'copilot_premium_requests', '0']);
  });
});

describe('mapBillingUsageItem — verbatim field list (research/other-sources.md §3)', () => {
  it('reads every confirmed usageItems[] field', () => {
    const ev = mapBillingUsageItem(
      {
        date: '2026-08-30',
        product: 'copilot',
        sku: 'copilot_premium_requests',
        quantity: 120,
        unitType: 'requests',
        pricePerUnit: 0.04,
        grossAmount: 4.8,
        discountAmount: 0.5,
        netAmount: 4.3,
        organizationName: 'acme',
        repositoryName: 'acme/widgets',
      },
      2,
    );
    expect(ev).not.toBeNull();
    expect(ev!.usage.requests).toBe(120);
    expect(ev!.cost).toEqual({ billedUsd: 4.3, currency: 'USD', confidence: 'billed' });
    expect(ev!.meta).toEqual({ product: 'copilot', pricePerUnit: 0.04, grossAmount: 4.8, discountAmount: 0.5, organizationName: 'acme', repositoryName: 'acme/widgets' });
    expect(ev!.naturalKey).toEqual(['billing', '2026-08-30', 'copilot_premium_requests', '2']);
  });
});

describe('githubCopilotConnector.verify', () => {
  it('reports ok with a seat count on success', async () => {
    const calls: Call[] = [];
    const ctx = ctxFor((url) => (url.pathname === '/orgs/acme/copilot/billing/seats' ? { status: 200, body: { total_seats: 5, seats: [] } } : undefined), calls);
    const res = await githubCopilotConnector.verify(ctx, { token: 'ghp_1', org: 'acme' });
    expect(res.ok).toBe(true);
    expect(res.message).toMatch(/5 seats/);
    const headers = calls[0]!.init?.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer ghp_1');
    expect(headers['Accept']).toBe('application/vnd.github+json');
    expect(headers['X-GitHub-Api-Version']).toBeTruthy();
  });

  it('gives a helpful message on 401 (GitHub-shaped {message} error body)', async () => {
    const ctx = ctxFor(() => ({ status: 401, body: { message: 'Bad credentials', documentation_url: 'https://docs.github.com/rest' } }), []);
    const res = await githubCopilotConnector.verify(ctx, { token: 'bad', org: 'acme' });
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/GitHub token rejected/);
    expect(res.message).toMatch(/Bad credentials/);
  });
});

describe('githubCopilotConnector.pull', () => {
  it('pulls seats (Link-header paginated), per-day NDJSON metrics reports, and Copilot-filtered billing usage', async () => {
    const calls: Call[] = [];
    const ndjson = ['{"date":"2026-08-30","login":"alice","ai_credits_used":12.5}', '{"date":"2026-08-30","login":"bob","ai_credits_used":0}'].join('\n');

    const ctx = ctxFor((url) => {
      if (url.pathname === '/orgs/acme/copilot/billing/seats') {
        if (url.searchParams.get('page') === '2') return { status: 200, body: { total_seats: 2, seats: [{ assignee: { login: 'bob' } }] } };
        return { status: 200, body: { total_seats: 2, seats: [{ assignee: { login: 'alice' } }] }, headers: { Link: '<https://api.github.com/orgs/acme/copilot/billing/seats?per_page=100&page=2>; rel="next"' } };
      }
      if (url.pathname === '/orgs/acme/copilot/metrics/reports/users-1-day') {
        expect(url.searchParams.get('day')).toBe('2026-08-30');
        return { status: 200, body: { download_links: ['https://signed.blob.example.com/reports/2026-08-30.ndjson'], report_day: '2026-08-30' } };
      }
      if (url.hostname === 'signed.blob.example.com') return { status: 200, body: ndjson, raw: true };
      if (url.pathname === '/organizations/acme/settings/billing/usage') {
        expect(url.searchParams.get('year')).toBe('2026');
        expect(url.searchParams.get('month')).toBe('8');
        return {
          status: 200,
          body: {
            usageItems: [
              { date: '2026-08-30', product: 'copilot', sku: 'copilot_premium_requests', quantity: 120, netAmount: 9.99 },
              { date: '2026-08-30', product: 'actions', sku: 'actions_minutes', quantity: 500, netAmount: 5 }, // not Copilot -> filtered out
            ],
          },
        };
      }
      return undefined;
    }, calls);

    const events = [];
    for await (const ev of githubCopilotConnector.pull(ctx, { token: 'ghp_1', org: 'acme' }, { since: '2026-08-30T00:00:00.000Z', until: '2026-08-30T12:00:00.000Z' })) events.push(ev);

    const seatEvents = events.filter((e) => e.naturalKey?.[0] === 'seat');
    const metricsEvents = events.filter((e) => e.naturalKey?.[0] === 'metrics');
    const billingEvents = events.filter((e) => e.naturalKey?.[0] === 'billing');

    expect(seatEvents.map((e) => e.actor.userId).sort()).toEqual(['alice', 'bob']);
    expect(metricsEvents).toHaveLength(2);
    expect(metricsEvents.find((e) => e.actor.userId === 'alice')!.cost?.billedUsd).toBeCloseTo(0.125, 5);
    expect(billingEvents).toHaveLength(1); // the 'actions' row was filtered out
    expect(billingEvents[0]!.cost).toEqual({ billedUsd: 9.99, currency: 'USD', confidence: 'billed' });

    // The signed NDJSON download link is fetched with no GitHub auth headers.
    const downloadCall = calls.find((c) => c.url.hostname === 'signed.blob.example.com')!;
    expect(downloadCall.init?.headers ?? {}).not.toHaveProperty('Authorization');

    expect(calls.filter((c) => c.url.pathname === '/orgs/acme/copilot/billing/seats')).toHaveLength(2);
    expect(ctx.stateMap.get('github-copilot:metrics:last_pull')).toBe('2026-08-30T12:00:00.000Z');
    expect(ctx.stateMap.get('github-copilot:billing:last_pull')).toBe('2026-08-30T12:00:00.000Z');
  });

  it('does nothing without a token/org', async () => {
    const events = [];
    for await (const ev of githubCopilotConnector.pull(ctxFor(() => undefined, []), {})) events.push(ev);
    expect(events).toHaveLength(0);
  });
});
