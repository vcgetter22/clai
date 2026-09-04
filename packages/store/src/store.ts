import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  actorKeyOf,
  dayKey,
  emptyUsage,
  localTimeZone,
  repriceEvent,
  type AggRow,
  type BillingMode,
  type Budget,
  type DeclaredSubscription,
  type PricingCatalog,
  type ProviderId,
  type Seat,
  type SourceId,
  type Surface,
  type TokenUsage,
  type UsageEvent,
} from '@claii/core';
import { SCHEMA_SQL, SCHEMA_VERSION } from './schema.js';

export interface EventFilter {
  /** ISO lower bound (inclusive) on ts. */
  since?: string | null;
  /** ISO upper bound (exclusive) on ts. */
  until?: string | null;
  /** Local day key lower bound (inclusive). Prefer over `since` for calendar reports. */
  fromDay?: string;
  toDay?: string;
  provider?: ProviderId | ProviderId[];
  source?: SourceId | SourceId[];
  project?: string;
  actorKey?: string;
  sessionId?: string;
  billing?: BillingMode;
  surface?: Surface;
  model?: string;
}

export interface StoreOptions {
  timeZone?: string;
  readonly?: boolean;
}

export interface UpsertResult {
  inserted: number;
  updated: number;
  unchanged: number;
}

type Row = Record<string, SQLInputValue>;

function whereClause(f: EventFilter, params: Record<string, SQLInputValue>): string {
  const parts: string[] = [];
  if (f.since) {
    parts.push('ts >= :since');
    params['since'] = f.since;
  }
  if (f.until) {
    parts.push('ts < :until');
    params['until'] = f.until;
  }
  if (f.fromDay) {
    parts.push('day >= :fromDay');
    params['fromDay'] = f.fromDay;
  }
  if (f.toDay) {
    parts.push('day <= :toDay');
    params['toDay'] = f.toDay;
  }
  const list = (col: string, name: string, v: string | string[] | undefined) => {
    if (!v) return;
    const arr = Array.isArray(v) ? v : [v];
    const names = arr.map((x, i) => {
      params[`${name}${i}`] = x;
      return `:${name}${i}`;
    });
    parts.push(`${col} IN (${names.join(',')})`);
  };
  list('provider', 'provider', f.provider);
  list('source', 'source', f.source);
  if (f.project) {
    parts.push('project = :project');
    params['project'] = f.project;
  }
  if (f.actorKey) {
    parts.push('actor_key = :actorKey');
    params['actorKey'] = f.actorKey;
  }
  if (f.sessionId) {
    parts.push('session_id = :sessionId');
    params['sessionId'] = f.sessionId;
  }
  if (f.billing) {
    parts.push('billing = :billing');
    params['billing'] = f.billing;
  }
  if (f.surface) {
    parts.push('surface = :surface');
    params['surface'] = f.surface;
  }
  if (f.model) {
    parts.push('(model_key = :model OR model = :model)');
    params['model'] = f.model;
  }
  return parts.length ? `WHERE ${parts.join(' AND ')}` : '';
}

const USAGE_SUMS = `
  SUM(input_tokens) AS input_tokens,
  SUM(output_tokens) AS output_tokens,
  SUM(cache_read_tokens) AS cache_read_tokens,
  SUM(cache_write_5m_tokens) AS cache_write_5m_tokens,
  SUM(cache_write_1h_tokens) AS cache_write_1h_tokens,
  SUM(COALESCE(reasoning_tokens, 0)) AS reasoning_tokens,
  SUM(requests) AS requests,
  SUM(web_searches) AS web_searches,
  SUM(web_fetches) AS web_fetches,
  SUM(COALESCE(computed_usd, 0)) AS computed_usd,
  SUM(billed_usd) AS billed_usd,
  SUM(CASE WHEN billed_usd IS NOT NULL THEN 1 ELSE 0 END) AS billed_rows,
  COUNT(*) AS events,
  MAX(CASE WHEN granularity IN ('request','message') THEN input_tokens + cache_read_tokens + cache_write_5m_tokens + cache_write_1h_tokens ELSE 0 END) AS max_context,
  SUM(CASE WHEN granularity IN ('request','message') AND input_tokens + cache_read_tokens + cache_write_5m_tokens + cache_write_1h_tokens > 200000 THEN 1 ELSE 0 END) AS long_context_events,
  MAX(CASE WHEN model_key IS NULL THEN 1 ELSE 0 END) AS unpriced
`;

function usageFromRow(r: Row): TokenUsage {
  return {
    input: Number(r['input_tokens'] ?? 0),
    output: Number(r['output_tokens'] ?? 0),
    cacheRead: Number(r['cache_read_tokens'] ?? 0),
    cacheWrite5m: Number(r['cache_write_5m_tokens'] ?? 0),
    cacheWrite1h: Number(r['cache_write_1h_tokens'] ?? 0),
    reasoning: Number(r['reasoning_tokens'] ?? 0),
    requests: Number(r['requests'] ?? 0),
    webSearches: Number(r['web_searches'] ?? 0),
    webFetches: Number(r['web_fetches'] ?? 0),
  };
}

/** Effective cost for an aggregate: billed where available for every event in the cell, else computed. */
function costFromRow(r: Row): { computedUsd: number; billedUsd: number | null } {
  const computed = Number(r['computed_usd'] ?? 0);
  const billedRows = Number(r['billed_rows'] ?? 0);
  const events = Number(r['events'] ?? 0);
  const billed = r['billed_usd'] === null || r['billed_usd'] === undefined ? null : Number(r['billed_usd']);
  // Only trust billed totals when the whole cell is billed; mixed cells fall back to computed.
  return { computedUsd: computed, billedUsd: billed !== null && billedRows === events ? billed : null };
}

export class EventStore {
  readonly db: DatabaseSync;
  readonly path: string;
  timeZone: string;

  constructor(path: string, opts: StoreOptions = {}) {
    this.path = path;
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path, { readOnly: opts.readonly ?? false });
    if (!opts.readonly) {
      this.db.exec('PRAGMA journal_mode = WAL');
      this.db.exec('PRAGMA synchronous = NORMAL');
      this.db.exec('PRAGMA foreign_keys = ON');
      this.db.exec(SCHEMA_SQL);
      const v = this.getMeta('schema_version');
      if (!v) this.setMeta('schema_version', String(SCHEMA_VERSION));
    }
    const tz = opts.timeZone ?? this.getSetting('timezone') ?? localTimeZone();
    this.timeZone = tz;
    if (!opts.readonly && !this.getSetting('timezone')) this.setSetting('timezone', tz);
  }

  close(): void {
    this.db.close();
  }

  // ------------------------------------------------------------ meta/settings

  getMeta(key: string): string | undefined {
    const r = this.db.prepare('SELECT value FROM meta WHERE key = :key').get({ key }) as Row | undefined;
    return r ? String(r['value']) : undefined;
  }

  setMeta(key: string, value: string): void {
    this.db.prepare('INSERT INTO meta(key, value) VALUES (:key, :value) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run({ key, value });
  }

  getSetting(key: string): string | undefined {
    try {
      const r = this.db.prepare('SELECT value FROM settings WHERE key = :key').get({ key }) as Row | undefined;
      return r ? String(r['value']) : undefined;
    } catch {
      return undefined;
    }
  }

  setSetting(key: string, value: string): void {
    this.db
      .prepare('INSERT INTO settings(key, value, updated_at) VALUES (:key, :value, :now) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
      .run({ key, value, now: new Date().toISOString() });
  }

  getJsonSetting<T>(key: string): T | undefined {
    const v = this.getSetting(key);
    if (v === undefined) return undefined;
    try {
      return JSON.parse(v) as T;
    } catch {
      return undefined;
    }
  }

  setJsonSetting(key: string, value: unknown): void {
    this.setSetting(key, JSON.stringify(value));
  }

  allSettings(): Record<string, string> {
    const rows = this.db.prepare('SELECT key, value FROM settings ORDER BY key').all() as Row[];
    return Object.fromEntries(rows.map((r) => [String(r['key']), String(r['value'])]));
  }

  // ----------------------------------------------------------- source state

  getState(source: string, key: string): string | undefined {
    const r = this.db.prepare('SELECT value FROM source_state WHERE source = :source AND key = :key').get({ source, key }) as Row | undefined;
    return r ? String(r['value']) : undefined;
  }

  setState(source: string, key: string, value: string): void {
    this.db
      .prepare(
        'INSERT INTO source_state(source, key, value, updated_at) VALUES (:source, :key, :value, :now) ON CONFLICT(source, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
      )
      .run({ source, key, value, now: new Date().toISOString() });
  }

  clearState(source: string): void {
    this.db.prepare('DELETE FROM source_state WHERE source = :source').run({ source });
  }

  stateFor(source: string): { get: (k: string) => string | undefined; set: (k: string, v: string) => void } {
    return { get: (k) => this.getState(source, k), set: (k, v) => this.setState(source, k, v) };
  }

  // ------------------------------------------------------------------ events

  upsertEvents(events: Iterable<UsageEvent>, origin?: string): UpsertResult {
    const insert = this.db.prepare(`
      INSERT INTO events (
        id, ts, day, source, provider, model, model_key, surface, billing, plan, granularity, period_end,
        actor_key, actor_json, session_id, project, context_json,
        input_tokens, output_tokens, cache_read_tokens, cache_write_5m_tokens, cache_write_1h_tokens, reasoning_tokens,
        requests, web_searches, web_fetches, billed_usd, computed_usd, cost_confidence, pricing_version, meta_json, origin, ingested_at
      ) VALUES (
        :id, :ts, :day, :source, :provider, :model, :model_key, :surface, :billing, :plan, :granularity, :period_end,
        :actor_key, :actor_json, :session_id, :project, :context_json,
        :input_tokens, :output_tokens, :cache_read_tokens, :cache_write_5m_tokens, :cache_write_1h_tokens, :reasoning_tokens,
        :requests, :web_searches, :web_fetches, :billed_usd, :computed_usd, :cost_confidence, :pricing_version, :meta_json, :origin, :ingested_at
      )
      ON CONFLICT(id) DO UPDATE SET
        ts = excluded.ts, day = excluded.day, model = excluded.model, model_key = excluded.model_key, surface = excluded.surface,
        billing = excluded.billing, plan = COALESCE(excluded.plan, events.plan), period_end = excluded.period_end,
        actor_key = excluded.actor_key, actor_json = excluded.actor_json, session_id = excluded.session_id, project = excluded.project,
        context_json = excluded.context_json,
        input_tokens = excluded.input_tokens, output_tokens = excluded.output_tokens, cache_read_tokens = excluded.cache_read_tokens,
        cache_write_5m_tokens = excluded.cache_write_5m_tokens, cache_write_1h_tokens = excluded.cache_write_1h_tokens,
        reasoning_tokens = excluded.reasoning_tokens, requests = excluded.requests, web_searches = excluded.web_searches, web_fetches = excluded.web_fetches,
        billed_usd = COALESCE(excluded.billed_usd, events.billed_usd), computed_usd = excluded.computed_usd,
        cost_confidence = excluded.cost_confidence, pricing_version = excluded.pricing_version, meta_json = excluded.meta_json,
        origin = COALESCE(excluded.origin, events.origin)
      WHERE excluded.ts != events.ts OR excluded.input_tokens != events.input_tokens OR excluded.output_tokens != events.output_tokens
         OR excluded.cache_read_tokens != events.cache_read_tokens OR excluded.cache_write_5m_tokens != events.cache_write_5m_tokens
         OR excluded.cache_write_1h_tokens != events.cache_write_1h_tokens OR COALESCE(excluded.computed_usd, -1) != COALESCE(events.computed_usd, -1)
         OR COALESCE(excluded.billed_usd, -1) != COALESCE(events.billed_usd, -1) OR excluded.model != events.model
         OR COALESCE(excluded.plan, '') != COALESCE(events.plan, '') OR excluded.billing != events.billing
    `);
    const exists = this.db.prepare('SELECT 1 FROM events WHERE id = :id');
    const now = new Date().toISOString();
    let inserted = 0;
    let updated = 0;
    let unchanged = 0;
    this.db.exec('BEGIN');
    try {
      for (const e of events) {
        const had = exists.get({ id: e.id }) !== undefined;
        const res = insert.run({
          id: e.id,
          ts: e.ts,
          day: dayKey(e.ts, this.timeZone),
          source: e.source,
          provider: e.provider,
          model: e.model,
          model_key: e.modelKey,
          surface: e.surface,
          billing: e.billing,
          plan: e.plan ?? null,
          granularity: e.granularity,
          period_end: e.periodEnd ?? null,
          actor_key: actorKeyOf(e),
          actor_json: JSON.stringify(e.actor),
          session_id: e.context.sessionId ?? null,
          project: e.context.project ?? e.actor.projectName ?? e.actor.workspaceName ?? null,
          context_json: JSON.stringify(e.context),
          input_tokens: e.usage.input,
          output_tokens: e.usage.output,
          cache_read_tokens: e.usage.cacheRead,
          cache_write_5m_tokens: e.usage.cacheWrite5m,
          cache_write_1h_tokens: e.usage.cacheWrite1h,
          reasoning_tokens: e.usage.reasoning ?? null,
          requests: e.usage.requests,
          web_searches: e.usage.webSearches ?? 0,
          web_fetches: e.usage.webFetches ?? 0,
          billed_usd: e.cost.billedUsd,
          computed_usd: e.cost.computedUsd,
          cost_confidence: e.cost.confidence,
          pricing_version: e.cost.pricingVersion ?? null,
          meta_json: e.meta ? JSON.stringify(e.meta) : null,
          origin: origin ?? null,
          ingested_at: now,
        });
        if (!had) inserted++;
        else if (Number(res.changes) > 0) updated++;
        else unchanged++;
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    return { inserted, updated, unchanged };
  }

  countEvents(filter: EventFilter = {}): number {
    const params: Record<string, SQLInputValue> = {};
    const where = whereClause(filter, params);
    const r = this.db.prepare(`SELECT COUNT(*) AS n FROM events ${where}`).get(params) as Row;
    return Number(r['n']);
  }

  /** Earliest and latest event timestamps. */
  span(filter: EventFilter = {}): { first: string | null; last: string | null } {
    const params: Record<string, SQLInputValue> = {};
    const where = whereClause(filter, params);
    const r = this.db.prepare(`SELECT MIN(ts) AS first, MAX(ts) AS last FROM events ${where}`).get(params) as Row;
    return { first: (r['first'] as string | null) ?? null, last: (r['last'] as string | null) ?? null };
  }

  /** The aggregate rows consumed by the insights engine and reports. */
  rows(filter: EventFilter = {}, opts: { bySession?: boolean } = {}): AggRow[] {
    const params: Record<string, SQLInputValue> = {};
    const where = whereClause(filter, params);
    const sessionCol = opts.bySession === false ? 'NULL' : 'session_id';
    const sql = `
      SELECT day, provider, COALESCE(model_key, model) AS model, source, surface, billing, plan, actor_key, project, ${sessionCol} AS session_id,
      ${USAGE_SUMS}
      FROM events ${where}
      GROUP BY day, provider, COALESCE(model_key, model), source, surface, billing, plan, actor_key, project, ${sessionCol}
      ORDER BY day
    `;
    const out: AggRow[] = [];
    for (const r of this.db.prepare(sql).all(params) as Row[]) {
      const cost = costFromRow(r);
      out.push({
        day: String(r['day']),
        provider: String(r['provider']) as ProviderId,
        model: String(r['model']),
        source: String(r['source']) as SourceId,
        surface: String(r['surface']) as Surface,
        billing: String(r['billing']) as BillingMode,
        plan: (r['plan'] as string | null) ?? null,
        actorKey: String(r['actor_key']),
        project: (r['project'] as string | null) ?? null,
        sessionId: (r['session_id'] as string | null) ?? null,
        usage: usageFromRow(r),
        computedUsd: cost.computedUsd,
        billedUsd: cost.billedUsd,
        events: Number(r['events']),
        maxContext: Number(r['max_context'] ?? 0),
        longContextEvents: Number(r['long_context_events'] ?? 0),
        unpriced: Number(r['unpriced'] ?? 0) === 1,
      });
    }
    return out;
  }

  /** Totals grouped by one dimension. */
  totalsBy(dim: 'day' | 'month' | 'provider' | 'model' | 'source' | 'project' | 'actor_key' | 'surface' | 'billing' | 'plan' | 'session_id', filter: EventFilter = {}, limit = 1000) {
    const params: Record<string, SQLInputValue> = {};
    const where = whereClause(filter, params);
    const col = dim === 'model' ? 'COALESCE(model_key, model)' : dim === 'month' ? 'substr(day, 1, 7)' : dim;
    const sql = `SELECT ${col} AS k, ${USAGE_SUMS} FROM events ${where} GROUP BY ${col} ORDER BY ${dim === 'day' || dim === 'month' ? 'k' : 'COALESCE(SUM(billed_usd), SUM(computed_usd)) DESC'} LIMIT ${Math.max(1, Math.floor(limit))}`;
    return (this.db.prepare(sql).all(params) as Row[]).map((r) => {
      const cost = costFromRow(r);
      return {
        key: (r['k'] as string | null) ?? '(none)',
        usage: usageFromRow(r),
        computedUsd: cost.computedUsd,
        billedUsd: cost.billedUsd,
        usd: cost.billedUsd ?? cost.computedUsd,
        events: Number(r['events']),
        maxContext: Number(r['max_context'] ?? 0),
      };
    });
  }

  /** Grand total for a filter. */
  total(filter: EventFilter = {}) {
    const params: Record<string, SQLInputValue> = {};
    const where = whereClause(filter, params);
    const r = this.db.prepare(`SELECT ${USAGE_SUMS} FROM events ${where}`).get(params) as Row;
    const cost = costFromRow(r);
    return { usage: usageFromRow(r), computedUsd: cost.computedUsd, billedUsd: cost.billedUsd, usd: cost.billedUsd ?? cost.computedUsd, events: Number(r['events'] ?? 0) };
  }

  /** Session list with cost, ordered by cost. */
  sessions(filter: EventFilter = {}, limit = 50) {
    const params: Record<string, SQLInputValue> = {};
    const where = whereClause({ ...filter }, params);
    const sql = `
      SELECT session_id, MIN(ts) AS started, MAX(ts) AS ended, MIN(project) AS project, MIN(source) AS source, MIN(provider) AS provider,
        GROUP_CONCAT(DISTINCT COALESCE(model_key, model)) AS models, ${USAGE_SUMS}
      FROM events ${where ? where + ' AND' : 'WHERE'} session_id IS NOT NULL
      GROUP BY session_id ORDER BY COALESCE(SUM(billed_usd), SUM(computed_usd)) DESC LIMIT ${Math.max(1, Math.floor(limit))}`;
    return (this.db.prepare(sql).all(params) as Row[]).map((r) => {
      const cost = costFromRow(r);
      return {
        sessionId: String(r['session_id']),
        started: String(r['started']),
        ended: String(r['ended']),
        project: (r['project'] as string | null) ?? null,
        source: String(r['source']) as SourceId,
        provider: String(r['provider']) as ProviderId,
        models: String(r['models'] ?? '').split(',').filter(Boolean),
        usage: usageFromRow(r),
        usd: cost.billedUsd ?? cost.computedUsd,
        events: Number(r['events']),
        maxContext: Number(r['max_context'] ?? 0),
      };
    });
  }

  /** Raw events (most recent first). */
  listEvents(filter: EventFilter = {}, limit = 100): UsageEvent[] {
    const params: Record<string, SQLInputValue> = {};
    const where = whereClause(filter, params);
    const rows = this.db.prepare(`SELECT * FROM events ${where} ORDER BY ts DESC LIMIT ${Math.max(1, Math.floor(limit))}`).all(params) as Row[];
    return rows.map(rowToEvent);
  }

  *iterateEvents(filter: EventFilter = {}): Generator<UsageEvent> {
    const params: Record<string, SQLInputValue> = {};
    const where = whereClause(filter, params);
    for (const r of this.db.prepare(`SELECT * FROM events ${where} ORDER BY ts`).iterate(params) as Iterable<Row>) yield rowToEvent(r);
  }

  /** Recompute computed costs with a new catalog (after `clai pricing update`). Returns number of changed rows. */
  repriceAll(catalog: PricingCatalog): number {
    const all = [...this.iterateEvents()];
    const changed = all.map((e) => repriceEvent(e, catalog)).filter((e, i) => e.cost.computedUsd !== all[i]!.cost.computedUsd || e.modelKey !== all[i]!.modelKey);
    if (changed.length === 0) return 0;
    const res = this.upsertEvents(changed);
    return res.updated + res.inserted;
  }

  /** Recompute the local `day` column after a timezone change. */
  recomputeDays(timeZone: string): void {
    this.timeZone = timeZone;
    this.setSetting('timezone', timeZone);
    const upd = this.db.prepare('UPDATE events SET day = :day WHERE id = :id');
    this.db.exec('BEGIN');
    try {
      for (const r of this.db.prepare('SELECT id, ts FROM events').all() as Row[]) {
        upd.run({ id: r['id'] as string, day: dayKey(String(r['ts']), timeZone) });
      }
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  deleteSource(source: SourceId): number {
    const r = this.db.prepare('DELETE FROM events WHERE source = :source').run({ source });
    this.clearState(source);
    return Number(r.changes);
  }

  // ---------------------------------------------------- subscriptions etc.

  listSubscriptions(): DeclaredSubscription[] {
    return (this.db.prepare('SELECT json FROM subscriptions ORDER BY id').all() as Row[]).map((r) => JSON.parse(String(r['json'])) as DeclaredSubscription);
  }

  putSubscription(sub: DeclaredSubscription): void {
    this.db
      .prepare('INSERT INTO subscriptions(id, json, updated_at) VALUES (:id, :json, :now) ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at')
      .run({ id: sub.id, json: JSON.stringify(sub), now: new Date().toISOString() });
  }

  deleteSubscription(id: string): boolean {
    return Number(this.db.prepare('DELETE FROM subscriptions WHERE id = :id').run({ id }).changes) > 0;
  }

  listBudgets(): Budget[] {
    return (this.db.prepare('SELECT json FROM budgets ORDER BY id').all() as Row[]).map((r) => JSON.parse(String(r['json'])) as Budget);
  }

  putBudget(b: Budget): void {
    this.db
      .prepare('INSERT INTO budgets(id, json, updated_at) VALUES (:id, :json, :now) ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at')
      .run({ id: b.id, json: JSON.stringify(b), now: new Date().toISOString() });
  }

  deleteBudget(id: string): boolean {
    return Number(this.db.prepare('DELETE FROM budgets WHERE id = :id').run({ id }).changes) > 0;
  }

  listSeats(): Seat[] {
    return (this.db.prepare('SELECT json FROM seats ORDER BY actor_key').all() as Row[]).map((r) => JSON.parse(String(r['json'])) as Seat);
  }

  putSeat(s: Seat): void {
    this.db
      .prepare('INSERT INTO seats(actor_key, json, updated_at) VALUES (:k, :json, :now) ON CONFLICT(actor_key) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at')
      .run({ k: s.actorKey, json: JSON.stringify(s), now: new Date().toISOString() });
  }

  deleteSeat(actorKey: string): boolean {
    return Number(this.db.prepare('DELETE FROM seats WHERE actor_key = :k').run({ k: actorKey }).changes) > 0;
  }

  // ------------------------------------------------------------ ingest runs

  startRun(source: string): number {
    const r = this.db.prepare('INSERT INTO ingest_runs(source, started_at) VALUES (:source, :now)').run({ source, now: new Date().toISOString() });
    return Number(r.lastInsertRowid);
  }

  finishRun(id: number, stats: { seen: number; inserted: number; updated: number; unpriced: number; error?: string }): void {
    this.db
      .prepare(
        'UPDATE ingest_runs SET finished_at = :now, events_seen = :seen, events_inserted = :inserted, events_updated = :updated, unpriced = :unpriced, ok = :ok, error = :error WHERE id = :id',
      )
      .run({ id, now: new Date().toISOString(), seen: stats.seen, inserted: stats.inserted, updated: stats.updated, unpriced: stats.unpriced, ok: stats.error ? 0 : 1, error: stats.error ?? null });
  }

  lastRuns(limit = 20) {
    return this.db.prepare(`SELECT * FROM ingest_runs ORDER BY id DESC LIMIT ${Math.max(1, Math.floor(limit))}`).all() as Row[];
  }

  /** Distinct sources with counts and last event time. */
  sources(): { source: SourceId; events: number; first: string; last: string }[] {
    return (this.db.prepare('SELECT source, COUNT(*) AS n, MIN(ts) AS first, MAX(ts) AS last FROM events GROUP BY source ORDER BY n DESC').all() as Row[]).map((r) => ({
      source: String(r['source']) as SourceId,
      events: Number(r['n']),
      first: String(r['first']),
      last: String(r['last']),
    }));
  }

  /** Distinct actors with last activity (team views). */
  actors(filter: EventFilter = {}) {
    const params: Record<string, SQLInputValue> = {};
    const where = whereClause(filter, params);
    return (this.db.prepare(`SELECT actor_key, MIN(actor_json) AS actor_json, MAX(day) AS last_day, MIN(day) AS first_day, ${USAGE_SUMS} FROM events ${where} GROUP BY actor_key ORDER BY COALESCE(SUM(billed_usd), SUM(computed_usd)) DESC`).all(params) as Row[]).map((r) => {
      const cost = costFromRow(r);
      return {
        actorKey: String(r['actor_key']),
        actor: JSON.parse(String(r['actor_json'] ?? '{}')) as UsageEvent['actor'],
        firstDay: String(r['first_day']),
        lastDay: String(r['last_day']),
        usage: usageFromRow(r),
        usd: cost.billedUsd ?? cost.computedUsd,
        events: Number(r['events']),
      };
    });
  }
}

function rowToEvent(r: Row): UsageEvent {
  return {
    id: String(r['id']),
    ts: String(r['ts']),
    source: String(r['source']) as SourceId,
    provider: String(r['provider']) as ProviderId,
    model: String(r['model']),
    modelKey: (r['model_key'] as string | null) ?? null,
    surface: String(r['surface']) as Surface,
    billing: String(r['billing']) as BillingMode,
    plan: (r['plan'] as string | null) ?? undefined,
    granularity: String(r['granularity']) as UsageEvent['granularity'],
    periodEnd: (r['period_end'] as string | null) ?? undefined,
    actor: JSON.parse(String(r['actor_json'] ?? '{}')),
    context: JSON.parse(String(r['context_json'] ?? '{}')),
    usage: {
      ...emptyUsage(),
      input: Number(r['input_tokens']),
      output: Number(r['output_tokens']),
      cacheRead: Number(r['cache_read_tokens']),
      cacheWrite5m: Number(r['cache_write_5m_tokens']),
      cacheWrite1h: Number(r['cache_write_1h_tokens']),
      ...(r['reasoning_tokens'] === null || r['reasoning_tokens'] === undefined ? {} : { reasoning: Number(r['reasoning_tokens']) }),
      requests: Number(r['requests']),
      webSearches: Number(r['web_searches'] ?? 0),
      webFetches: Number(r['web_fetches'] ?? 0),
    },
    cost: {
      billedUsd: r['billed_usd'] === null || r['billed_usd'] === undefined ? null : Number(r['billed_usd']),
      computedUsd: r['computed_usd'] === null || r['computed_usd'] === undefined ? null : Number(r['computed_usd']),
      currency: 'USD',
      confidence: String(r['cost_confidence']) as UsageEvent['cost']['confidence'],
      pricingVersion: (r['pricing_version'] as string | null) ?? undefined,
    },
    meta: r['meta_json'] ? (JSON.parse(String(r['meta_json'])) as Record<string, unknown>) : undefined,
  };
}
