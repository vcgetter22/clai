import { randomBytes } from 'node:crypto';
import { Hono, type Context } from 'hono';
import { resolveModel, sha256, type Budget, type DeclaredSubscription, type PricingCatalog, type Seat, type UsageEvent } from '@claii/core';
import type { EventStore } from '@claii/store';
import { breakdown, computeInsights, computeSummary, toFilter, type QueryOptions } from './summary.js';
import type { RunResult } from './runner.js';

export interface Principal {
  actorKey: string;
  role: 'admin' | 'member';
  label?: string;
  tokenHash?: string;
}

export interface ApiOptions {
  store: EventStore;
  catalog: PricingCatalog;
  mode: 'local' | 'team';
  version: string;
  /** Local mode: run local connectors on demand. */
  scan?: () => Promise<RunResult[]>;
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

/** Hash used to store API tokens: never store the token itself. */
export function tokenHash(token: string): string {
  return sha256(`clai-token:${token}`);
}

export function lookupToken(store: EventStore, token: string): Principal | null {
  const h = tokenHash(token);
  const row = store.db.prepare('SELECT actor_key, role, label FROM api_tokens WHERE token_hash = :h AND revoked_at IS NULL').get({ h }) as
    | { actor_key: string; role: string; label: string | null }
    | undefined;
  if (!row) return null;
  store.db.prepare('UPDATE api_tokens SET last_used_at = :now WHERE token_hash = :h').run({ h, now: new Date().toISOString() });
  return { actorKey: row.actor_key, role: row.role === 'admin' ? 'admin' : 'member', label: row.label ?? undefined, tokenHash: h };
}

export function createToken(store: EventStore, actorKey: string, role: 'admin' | 'member', label?: string): string {
  const token = `clai_${role === 'admin' ? 'adm' : 'mem'}_${randomBytes(24).toString('base64url')}`;
  store.db
    .prepare('INSERT INTO api_tokens(token_hash, actor_key, label, role, created_at) VALUES (:h, :a, :l, :r, :now)')
    .run({ h: tokenHash(token), a: actorKey, l: label ?? null, r: role, now: new Date().toISOString() });
  store.db
    .prepare('INSERT INTO members(actor_key, display_name, role, created_at, updated_at) VALUES (:a, :l, :r, :now, :now) ON CONFLICT(actor_key) DO UPDATE SET role = CASE WHEN excluded.role = \'admin\' THEN \'admin\' ELSE members.role END, updated_at = excluded.updated_at')
    .run({ a: actorKey, l: label ?? null, r: role, now: new Date().toISOString() });
  return token;
}

export function createApi(opts: ApiOptions): Hono<Env> {
  const { store, catalog, mode } = opts;
  const api = new Hono<Env>();

  api.onError((err, c) => c.json({ error: err.message }, err.message.startsWith('Unknown dimension') ? 400 : 500));

  if (mode === 'team') {
    api.use('*', async (c, next) => {
      const auth = c.req.header('authorization') ?? '';
      const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
      const p = token ? lookupToken(store, token) : null;
      if (!p) return c.json({ error: 'Unauthorized: provide a clai token as Authorization: Bearer <token>' }, 401);
      c.set('principal', p);
      await next();
    });
  }

  api.get('/health', (c) => {
    const span = store.span();
    return c.json({
      ok: true,
      version: opts.version,
      mode,
      timeZone: store.timeZone,
      db: { events: store.countEvents(), first: span.first, last: span.last },
      pricingVersion: catalog.version,
      authRequired: mode === 'team',
    });
  });

  api.get('/whoami', (c) => {
    const p = c.get('principal') ?? { actorKey: 'me', role: 'admin' as const, label: 'local' };
    return c.json({ actorKey: p.actorKey, role: p.role, label: p.label ?? null });
  });

  api.get('/summary', (c) => c.json(computeSummary(store, catalog, constrain(q(c), c.get('principal')))));

  api.get('/breakdown', (c) => {
    const dim = c.req.query('dim') ?? 'model';
    const limit = Number(c.req.query('limit') ?? 50);
    return c.json({ dim, rows: breakdown(store, dim, constrain(q(c), c.get('principal')), limit) });
  });

  api.get('/sessions', (c) => {
    const limit = Number(c.req.query('limit') ?? 50);
    const filter = toFilter(constrain(q(c), c.get('principal')), store.timeZone);
    return c.json({ sessions: store.sessions(filter, limit) });
  });

  api.get('/insights', (c) => c.json({ insights: computeInsights(store, catalog, constrain(q(c), c.get('principal'))), generatedAt: new Date().toISOString() }));

  api.get('/events', (c) => {
    const limit = Math.min(1000, Number(c.req.query('limit') ?? 100));
    const filter = toFilter(constrain(q(c), c.get('principal')), store.timeZone);
    return c.json({ events: store.listEvents(filter, limit) });
  });

  api.get('/models', (c) => {
    const rows = breakdown(store, 'model', constrain(q(c), c.get('principal')), 500);
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

  api.get('/settings', (c) => {
    return c.json({
      mode,
      timeZone: store.timeZone,
      pricingVersion: catalog.version,
      subscriptions: store.listSubscriptions(),
      budgets: store.listBudgets(),
      seats: store.listSeats(),
      sources: store.sources(),
      lastRuns: store.lastRuns(20),
      plans: catalog.subscriptions.map((p) => ({ provider: p.provider, plan: p.plan, display: p.display, priceMonthly: p.priceMonthly, seatBased: p.seatBased })),
    });
  });

  api.get('/actors', (c) => {
    const filter = toFilter(constrain({ ...q(c), since: q(c).since ?? '90d' }, c.get('principal')), store.timeZone);
    const seats = new Map(store.listSeats().map((s) => [s.actorKey, s]));
    const actors = store.actors(filter).map((a) => ({ ...a, seat: seats.get(a.actorKey) ?? null }));
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
    store.putSubscription(sub);
    return c.json({ subscriptions: store.listSubscriptions() });
  });
  api.delete('/settings/subscriptions/:id', (c) => {
    const denied = requireAdmin(c);
    if (denied) return denied;
    store.deleteSubscription(c.req.param('id'));
    return c.json({ subscriptions: store.listSubscriptions() });
  });

  api.post('/settings/budgets', async (c) => {
    const denied = requireAdmin(c);
    if (denied) return denied;
    const body = (await c.req.json()) as Partial<Budget>;
    if (!body.name || typeof body.amountUsd !== 'number') return c.json({ error: 'name and amountUsd are required' }, 400);
    const b: Budget = { id: body.id ?? newId('bud'), name: body.name, amountUsd: body.amountUsd, period: 'month', scope: body.scope };
    store.putBudget(b);
    return c.json({ budgets: store.listBudgets() });
  });
  api.delete('/settings/budgets/:id', (c) => {
    const denied = requireAdmin(c);
    if (denied) return denied;
    store.deleteBudget(c.req.param('id'));
    return c.json({ budgets: store.listBudgets() });
  });

  api.post('/settings/seats', async (c) => {
    const denied = requireAdmin(c);
    if (denied) return denied;
    const body = (await c.req.json()) as Partial<Seat>;
    if (!body.actorKey || !body.provider || !body.plan) return c.json({ error: 'actorKey, provider and plan are required' }, 400);
    const plan = catalog.subscriptions.find((p) => p.provider === body.provider && p.plan === body.plan);
    const s: Seat = { actorKey: body.actorKey, label: body.label, provider: body.provider, plan: body.plan, priceMonthly: typeof body.priceMonthly === 'number' ? body.priceMonthly : (plan?.priceMonthly ?? 0) };
    store.putSeat(s);
    return c.json({ seats: store.listSeats() });
  });
  api.delete('/settings/seats/:actorKey', (c) => {
    const denied = requireAdmin(c);
    if (denied) return denied;
    store.deleteSeat(c.req.param('actorKey'));
    return c.json({ seats: store.listSeats() });
  });

  api.post('/scan', async (c) => {
    if (mode !== 'local' || !opts.scan) return c.json({ error: 'Scanning local sources is only available in local mode' }, 400);
    const results = await opts.scan();
    return c.json({ results: results.map((r) => ({ source: r.source, seen: r.seen, inserted: r.inserted, updated: r.updated, unpriced: r.unpriced, error: r.error, detail: r.detail ?? null })) });
  });

  // ------------------------------------------------------------ team mode

  api.post('/v1/ingest', async (c) => {
    const p = c.get('principal') ?? { actorKey: 'me', role: 'admin' as const };
    const body = (await c.req.json()) as { events?: unknown };
    if (!Array.isArray(body.events)) return c.json({ error: 'body.events must be an array' }, 400);
    const events: UsageEvent[] = [];
    for (const e of body.events as UsageEvent[]) {
      if (!e || typeof e !== 'object' || typeof e.id !== 'string' || typeof e.ts !== 'string' || !e.usage || !e.cost) continue;
      // Members can only ingest as themselves.
      const actor = p.role === 'admin' ? e.actor ?? {} : { ...(e.actor ?? {}), email: p.actorKey };
      events.push({ ...e, actor });
    }
    const r = store.upsertEvents(events, `ingest:${p.actorKey}`);
    return c.json({ ...r, received: events.length });
  });

  api.get('/admin/tokens', (c) => {
    const denied = requireAdmin(c);
    if (denied) return denied;
    const rows = store.db.prepare('SELECT token_hash, actor_key, label, role, created_at, last_used_at, revoked_at FROM api_tokens ORDER BY created_at DESC').all();
    return c.json({ tokens: rows });
  });
  api.post('/admin/tokens', async (c) => {
    const denied = requireAdmin(c);
    if (denied) return denied;
    const body = (await c.req.json()) as { actorKey?: string; role?: string; label?: string };
    if (!body.actorKey) return c.json({ error: 'actorKey (usually the member email) is required' }, 400);
    const token = createToken(store, body.actorKey, body.role === 'admin' ? 'admin' : 'member', body.label);
    return c.json({ token, actorKey: body.actorKey, role: body.role === 'admin' ? 'admin' : 'member' });
  });
  api.delete('/admin/tokens/:hash', (c) => {
    const denied = requireAdmin(c);
    if (denied) return denied;
    store.db.prepare('UPDATE api_tokens SET revoked_at = :now WHERE token_hash = :h').run({ h: c.req.param('hash'), now: new Date().toISOString() });
    return c.json({ ok: true });
  });
  api.get('/admin/members', (c) => {
    const denied = requireAdmin(c);
    if (denied) return denied;
    return c.json({ members: store.db.prepare('SELECT actor_key, display_name, team, role, created_at, updated_at FROM members ORDER BY actor_key').all() });
  });
  api.post('/admin/members', async (c) => {
    const denied = requireAdmin(c);
    if (denied) return denied;
    const body = (await c.req.json()) as { actorKey?: string; displayName?: string; team?: string; role?: string };
    if (!body.actorKey) return c.json({ error: 'actorKey is required' }, 400);
    store.db
      .prepare('INSERT INTO members(actor_key, display_name, team, role, created_at, updated_at) VALUES (:a, :d, :t, :r, :now, :now) ON CONFLICT(actor_key) DO UPDATE SET display_name = COALESCE(excluded.display_name, members.display_name), team = COALESCE(excluded.team, members.team), role = excluded.role, updated_at = excluded.updated_at')
      .run({ a: body.actorKey, d: body.displayName ?? null, t: body.team ?? null, r: body.role === 'admin' ? 'admin' : 'member', now: new Date().toISOString() });
    return c.json({ members: store.db.prepare('SELECT actor_key, display_name, team, role, created_at, updated_at FROM members ORDER BY actor_key').all() });
  });

  api.notFound((c) => c.json({ error: 'Not found' }, 404));
  return api;
}
