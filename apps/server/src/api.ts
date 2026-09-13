import { randomBytes } from 'node:crypto';
import { Hono, type Context } from 'hono';
import { resolveModel, sha256, type Budget, type DeclaredSubscription, type PricingCatalog, type Seat, type UsageEvent } from '@claii/core';
import type { EventStore, Role } from '@claii/store';
import { breakdown, computeInsights, computeSummary, toFilter, type QueryOptions } from './summary.js';
import type { RunResult } from './runner.js';

export interface Principal {
  actorKey: string;
  role: 'admin' | 'member';
  label?: string;
  tokenHash?: string;
  /** When true, `/v1/ingest` stamps `actor.email = actorKey` even for an admin principal. */
  forceActor?: boolean;
}

export interface ApiOptions {
  store: EventStore;
  catalog: PricingCatalog;
  mode: 'local' | 'team';
  version: string;
  /** Local mode: run local connectors on demand. */
  scan?: () => Promise<RunResult[]>;
  /** Paths that skip the bearer-token gate in team mode. Default: `['/health']`. */
  publicPaths?: string[];
  /** Resolve the caller's principal for a request. Default: bearer-token lookup via the store. */
  resolvePrincipal?: (c: Context) => Promise<Principal | undefined>;
  /** Select the store for a request. Default: the single store this API was created with. */
  storeFor?: (principal: Principal | undefined) => Promise<EventStore>;
}

type Env = { Variables: { principal: Principal } };

function q(c: Context): QueryOptions {
  const g = (k: string) => c.req.query(k) || undefined;
  return { since: g('since'), until: g('until'), provider: g('provider'), source: g('source'), project: g('project'), actor: g('actor'), billing: g('billing'), model: g('model') };
}

function constrain(qo: QueryOptions, p: Principal | undefined): QueryOptions {
  if (p && p.role !== 'admin') return { ...qo, actor: p.actorKey };
  return qo;
}

function newId(prefix: string): string {
  return `${prefix}_${randomBytes(6).toString('hex')}`;
}

function looksLikeEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

/**
 * `:param`-aware match of a Hono route pattern (from `Hono#routes`, e.g. `/admin/tokens/:hash`)
 * against a request path, anchored at the END: `c.req.path` inside a sub-app mounted with
 * `app.route('/api', api)` is the *full* incoming path (`/api/admin/tokens/xyz`), not one trimmed
 * to what `api` registered its routes under, so matching must tolerate an arbitrary mount prefix
 * the same way `isPublic`'s `endsWith` check already does for the (param-free) public paths.
 */
function pathMatchesPattern(pattern: string, path: string): boolean {
  const pat = pattern.split('/').filter(Boolean);
  const seg = path.split('/').filter(Boolean);
  const wildcard = pat[pat.length - 1] === '*';
  const fixed = wildcard ? pat.slice(0, -1) : pat;
  if (seg.length < fixed.length) return false;
  const tail = seg.slice(seg.length - fixed.length);
  return fixed.every((p, i) => p.startsWith(':') || p === tail[i]);
}

/** Hash used to store API tokens: never store the token itself. */
export function tokenHash(token: string): string {
  return sha256(`clai-token:${token}`);
}

/** String generation and hashing only, no store access; the caller inserts the token and upserts the member. */
export function mintToken(role: Role): { token: string; tokenHash: string } {
  const token = `clai_${role === 'admin' ? 'adm' : 'mem'}_${randomBytes(24).toString('base64url')}`;
  return { token, tokenHash: tokenHash(token) };
}

/** Resolve a bearer token into a `Principal`, touching `lastUsedAt` (throttled in the store). */
export async function lookupToken(store: EventStore, token: string): Promise<Principal | null> {
  const h = tokenHash(token);
  const row = await store.lookupToken(h);
  if (!row) return null;
  await store.touchToken(h);
  return { actorKey: row.actorKey, role: row.role, label: row.label ?? undefined, tokenHash: h };
}

export function createApi(opts: ApiOptions): Hono<Env> {
  const { catalog, mode } = opts;
  const publicPaths = opts.publicPaths ?? (mode === 'team' ? ['/health'] : []);
  const resolvePrincipal =
    opts.resolvePrincipal ??
    (async (c: Context) => {
      const auth = c.req.header('authorization') ?? '';
      const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
      return token ? ((await lookupToken(opts.store, token)) ?? undefined) : undefined;
    });
  const storeFor = opts.storeFor ?? (async () => opts.store);
  const isPublic = (path: string) => publicPaths.some((p) => path === p || path.endsWith(p));

  const api = new Hono<Env>();

  api.onError((err, c) => c.json({ error: err.message }, err.message.startsWith('Unknown dimension') ? 400 : 500));

  // Registered lazily below (the middleware closure reads `api.routes` at request time, by which
  // point every `.get`/`.post`/`.delete` call in this function has already run and populated it).
  // `r.method === method` (never 'ALL') naturally excludes this very middleware's own `ALL /*` entry.
  const hasRoute = (method: string, path: string): boolean => api.routes.some((r) => r.method === method && pathMatchesPattern(r.path, path));

  if (mode === 'team') {
    api.use('*', async (c, next) => {
      if (isPublic(c.req.path)) return next();
      const p = await resolvePrincipal(c);
      if (!p) {
        // A path nothing here serves (e.g. the hosted-only /auth/*) falls through to the normal
        // 404 instead of leaking "this route exists but you're unauthorized" to an anonymous caller.
        // `clai login`'s 404-vs-401 fallback detection against a self-hosted server relies on this.
        if (!hasRoute(c.req.method, c.req.path)) return next();
        return c.json({ error: 'Unauthorized: provide a clai token as Authorization: Bearer <token>' }, 401);
      }
      c.set('principal', p);
      await next();
    });
  }

  api.get('/health', async (c) => {
    const store = await storeFor(c.get('principal'));
    const base = { ok: true, version: opts.version, mode, timeZone: store.timeZone, pricingVersion: catalog.version, authRequired: mode === 'team' };
    if (mode === 'team') return c.json({ ...base, auth: { kind: 'token' as const } }); // public in team mode: no database stats without auth
    const span = await store.span();
    return c.json({ ...base, db: { events: await store.countEvents(), first: span.first, last: span.last } });
  });

  api.get('/whoami', (c) => {
    const p = c.get('principal') ?? { actorKey: 'me', role: 'admin' as const, label: 'local' };
    return c.json({
      actorKey: p.actorKey,
      role: p.role,
      label: p.label ?? null,
      // Hosted extensions (docs/dashboard-api.md "Hosted extensions"): self-hosted values are the
      // inert defaults: no org concept, no billing, ToS already satisfied by running your own server.
      email: looksLikeEmail(p.actorKey) ? p.actorKey : null,
      orgId: null,
      orgs: [] as { id: string; name: string }[],
      plan: 'self-hosted' as const,
      billingStatus: null,
      upgradeUrl: null,
      portalUrl: null,
      tosAccepted: true,
    });
  });

  api.get('/summary', async (c) => {
    const store = await storeFor(c.get('principal'));
    return c.json(await computeSummary(store, catalog, constrain(q(c), c.get('principal'))));
  });

  api.get('/breakdown', async (c) => {
    const store = await storeFor(c.get('principal'));
    const dim = c.req.query('dim') ?? 'model';
    const limit = Number(c.req.query('limit') ?? 50);
    return c.json({ dim, rows: await breakdown(store, dim, constrain(q(c), c.get('principal')), limit) });
  });

  api.get('/sessions', async (c) => {
    const store = await storeFor(c.get('principal'));
    const limit = Number(c.req.query('limit') ?? 50);
    const filter = toFilter(constrain(q(c), c.get('principal')), store.timeZone);
    return c.json({ sessions: await store.sessions(filter, limit) });
  });

  api.get('/insights', async (c) => {
    const store = await storeFor(c.get('principal'));
    return c.json({ insights: await computeInsights(store, catalog, constrain(q(c), c.get('principal'))), generatedAt: new Date().toISOString() });
  });

  api.get('/events', async (c) => {
    const store = await storeFor(c.get('principal'));
    const limit = Math.min(1000, Number(c.req.query('limit') ?? 100));
    const filter = toFilter(constrain(q(c), c.get('principal')), store.timeZone);
    return c.json({ events: await store.listEvents(filter, limit) });
  });

  api.get('/models', async (c) => {
    const store = await storeFor(c.get('principal'));
    const rows = await breakdown(store, 'model', constrain(q(c), c.get('principal')), 500);
    const used = new Map(rows.map((r) => [r.key, r]));
    const models = catalog.models.map((m) => {
      const u = used.get(m.id);
      return {
        key: m.id,
        displayName: m.displayName,
        provider: m.provider,
        tier: m.tier,
        input: m.input,
        output: m.output,
        cacheRead: m.cacheRead,
        cacheWrite5m: m.cacheWrite5m,
        cacheWrite1h: m.cacheWrite1h,
        contextWindow: m.contextWindow,
        verified: m.verified,
        retired: m.retired ?? null,
        usd: u?.usd ?? 0,
        events: u?.events ?? 0,
        usage: u?.usage ?? { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, requests: 0 },
      };
    });
    // Models seen in data but missing from the catalog (unpriced)
    for (const r of rows) {
      if (!resolveModel(catalog, r.key).price) {
        models.push({ key: r.key, displayName: r.key, provider: 'other', tier: 'other', input: 0, output: 0, cacheRead: null, cacheWrite5m: null, cacheWrite1h: null, contextWindow: null, verified: false, retired: null, usd: r.usd, events: r.events, usage: r.usage });
      }
    }
    models.sort((a, b) => b.usd - a.usd || a.key.localeCompare(b.key));
    return c.json({ models });
  });

  api.get('/settings', async (c) => {
    const store = await storeFor(c.get('principal'));
    return c.json({
      mode,
      timeZone: store.timeZone,
      pricingVersion: catalog.version,
      subscriptions: await store.listSubscriptions(),
      budgets: await store.listBudgets(),
      seats: await store.listSeats(),
      sources: await store.sources(),
      lastRuns: await store.lastRuns(20),
      plans: catalog.subscriptions.map((p) => ({ provider: p.provider, plan: p.plan, display: p.display, priceMonthly: p.priceMonthly, seatBased: p.seatBased })),
    });
  });

  api.get('/actors', async (c) => {
    const store = await storeFor(c.get('principal'));
    const filter = toFilter(constrain({ ...q(c), since: q(c).since ?? '90d' }, c.get('principal')), store.timeZone);
    const seats = new Map((await store.listSeats()).map((s) => [s.actorKey, s]));
    const actors = (await store.actors(filter)).map((a) => ({ ...a, seat: seats.get(a.actorKey) ?? null }));
    return c.json({ actors });
  });

  const requireAdmin = (c: Context<Env>): Response | null => {
    const p = c.get('principal');
    if (mode === 'team' && p?.role !== 'admin') return c.json({ error: 'Admin role required' }, 403);
    return null;
  };

  api.post('/settings/subscriptions', async (c) => {
    const denied = requireAdmin(c);
    if (denied) return denied;
    const store = await storeFor(c.get('principal'));
    const body = (await c.req.json()) as Partial<DeclaredSubscription>;
    if (!body.provider || !body.plan) return c.json({ error: 'provider and plan are required' }, 400);
    const plan = catalog.subscriptions.find((p) => p.provider === body.provider && p.plan === body.plan);
    const sub: DeclaredSubscription = {
      id: body.id ?? newId('sub'),
      provider: body.provider,
      plan: body.plan,
      label: body.label ?? plan?.display,
      priceMonthly: typeof body.priceMonthly === 'number' ? body.priceMonthly : (plan?.priceMonthly ?? 0),
      seats: body.seats,
      appliesTo: body.appliesTo,
    };
    await store.putSubscription(sub);
    return c.json({ subscriptions: await store.listSubscriptions() });
  });
  api.delete('/settings/subscriptions/:id', async (c) => {
    const denied = requireAdmin(c);
    if (denied) return denied;
    const store = await storeFor(c.get('principal'));
    await store.deleteSubscription(c.req.param('id'));
    return c.json({ subscriptions: await store.listSubscriptions() });
  });

  api.post('/settings/budgets', async (c) => {
    const denied = requireAdmin(c);
    if (denied) return denied;
    const store = await storeFor(c.get('principal'));
    const body = (await c.req.json()) as Partial<Budget>;
    if (!body.name || typeof body.amountUsd !== 'number') return c.json({ error: 'name and amountUsd are required' }, 400);
    const b: Budget = { id: body.id ?? newId('bud'), name: body.name, amountUsd: body.amountUsd, period: 'month', scope: body.scope };
    await store.putBudget(b);
    return c.json({ budgets: await store.listBudgets() });
  });
  api.delete('/settings/budgets/:id', async (c) => {
    const denied = requireAdmin(c);
    if (denied) return denied;
    const store = await storeFor(c.get('principal'));
    await store.deleteBudget(c.req.param('id'));
    return c.json({ budgets: await store.listBudgets() });
  });

  api.post('/settings/seats', async (c) => {
    const denied = requireAdmin(c);
    if (denied) return denied;
    const store = await storeFor(c.get('principal'));
    const body = (await c.req.json()) as Partial<Seat>;
    if (!body.actorKey || !body.provider || !body.plan) return c.json({ error: 'actorKey, provider and plan are required' }, 400);
    const plan = catalog.subscriptions.find((p) => p.provider === body.provider && p.plan === body.plan);
    const s: Seat = { actorKey: body.actorKey, label: body.label, provider: body.provider, plan: body.plan, priceMonthly: typeof body.priceMonthly === 'number' ? body.priceMonthly : (plan?.priceMonthly ?? 0) };
    await store.putSeat(s);
    return c.json({ seats: await store.listSeats() });
  });
  api.delete('/settings/seats/:actorKey', async (c) => {
    const denied = requireAdmin(c);
    if (denied) return denied;
    const store = await storeFor(c.get('principal'));
    await store.deleteSeat(c.req.param('actorKey'));
    return c.json({ seats: await store.listSeats() });
  });

  api.post('/scan', async (c) => {
    if (mode !== 'local' || !opts.scan) return c.json({ error: 'Scanning local sources is only available in local mode' }, 400);
    const results = await opts.scan();
    return c.json({ results: results.map((r) => ({ source: r.source, seen: r.seen, inserted: r.inserted, updated: r.updated, unpriced: r.unpriced, error: r.error, detail: r.detail ?? null })) });
  });

  // ------------------------------------------------------------ team mode

  api.post('/v1/ingest', async (c) => {
    const p: Principal = c.get('principal') ?? { actorKey: 'me', role: 'admin' as const };
    const store = await storeFor(p);
    const body = (await c.req.json()) as { events?: unknown };
    if (!Array.isArray(body.events)) return c.json({ error: 'body.events must be an array' }, 400);
    // Members ingest only as themselves; forceActor makes an admin principal stamp its verified
    // identity too (the hosted service's device-flow / SSO tokens carry it).
    const stampActor = p.forceActor === true || p.role !== 'admin';
    const events: UsageEvent[] = [];
    for (const e of body.events as UsageEvent[]) {
      if (!e || typeof e !== 'object' || typeof e.id !== 'string' || typeof e.ts !== 'string' || !e.usage || !e.cost) continue;
      const actor = stampActor ? { ...(e.actor ?? {}), email: p.actorKey } : (e.actor ?? {});
      events.push({ ...e, actor });
    }
    const r = await store.upsertEvents(events, `ingest:${p.actorKey}`);
    return c.json({ ...r, received: events.length });
  });

  api.get('/admin/tokens', async (c) => {
    const denied = requireAdmin(c);
    if (denied) return denied;
    const store = await storeFor(c.get('principal'));
    return c.json({ tokens: await store.listTokens() });
  });
  api.post('/admin/tokens', async (c) => {
    const denied = requireAdmin(c);
    if (denied) return denied;
    const store = await storeFor(c.get('principal'));
    const body = (await c.req.json()) as { actorKey?: string; role?: string; label?: string; expiresAt?: string };
    if (!body.actorKey) return c.json({ error: 'actorKey (usually the member email) is required' }, 400);
    const role: Role = body.role === 'admin' ? 'admin' : 'member';
    const { token, tokenHash: hash } = mintToken(role);
    await store.insertToken({ tokenHash: hash, actorKey: body.actorKey, role, label: body.label, expiresAt: body.expiresAt ?? null });
    await store.upsertMember({ actorKey: body.actorKey, displayName: body.label, role });
    return c.json({ token, actorKey: body.actorKey, role });
  });
  api.delete('/admin/tokens/:hash', async (c) => {
    const denied = requireAdmin(c);
    if (denied) return denied;
    const store = await storeFor(c.get('principal'));
    await store.revokeToken(c.req.param('hash'));
    return c.json({ ok: true });
  });
  api.get('/admin/members', async (c) => {
    const denied = requireAdmin(c);
    if (denied) return denied;
    const store = await storeFor(c.get('principal'));
    return c.json({ members: await store.listMembers() });
  });
  api.post('/admin/members', async (c) => {
    const denied = requireAdmin(c);
    if (denied) return denied;
    const store = await storeFor(c.get('principal'));
    const body = (await c.req.json()) as { actorKey?: string; displayName?: string; team?: string; role?: string };
    if (!body.actorKey) return c.json({ error: 'actorKey is required' }, 400);
    await store.upsertMember({ actorKey: body.actorKey, displayName: body.displayName, team: body.team, role: body.role === 'admin' ? 'admin' : 'member' });
    return c.json({ members: await store.listMembers() });
  });

  api.notFound((c) => c.json({ error: 'Not found' }, 404));
  return api;
}
