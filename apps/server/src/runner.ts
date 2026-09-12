import { homedir } from 'node:os';
import { finalizeEvent, type PricingCatalog, type RawUsageEvent, type UsageEvent } from '@claii/core';
import { apiConnectors, importConnectors, localConnectors, noopLogger, type ApiConnector, type ConnectorContext, type ImportConnector, type ImportOptions, type LocalConnector, type Logger, type PullOptions, type ScanOptions } from '@claii/connectors';
import type { EventStore } from '@claii/store';
import { resolveCredentials } from './credentials.js';

export interface RunResult {
  source: string;
  seen: number;
  inserted: number;
  updated: number;
  unchanged: number;
  unpriced: number;
  unpricedModels: string[];
  error: string | null;
  durationMs: number;
  detail?: string;
}

export interface RunnerOptions {
  store: EventStore;
  catalog: PricingCatalog;
  log?: Logger;
  env?: NodeJS.ProcessEnv;
  home?: string;
  identity?: ConnectorContext['identity'];
  now?: () => Date;
  fetch?: typeof fetch;
}

/**
 * A `ConnectorContext` plus the flush for the per-source state snapshot it carries. Connectors
 * only ever see the plain `ConnectorContext` shape (its `state` is a synchronous `StateStore`
 * over an in-memory snapshot); `ingest()` calls `flushState` alongside its own event-batch flush
 * so a source's cursor is durable every 500 events and at the end, even if the process is killed
 * mid-pull (a scheduled job never re-reads from scratch and never loops forever).
 */
export interface RunnerContext extends ConnectorContext {
  flushState: () => Promise<void>;
}

export async function connectorContext(opts: RunnerOptions, source: string): Promise<RunnerContext> {
  const { store } = opts;
  const subs = await store.listSubscriptions();
  const snapshot = await store.loadState(source);
  const dirty = new Set<string>();
  const flushState = async () => {
    if (dirty.size === 0) return;
    const values: Record<string, string> = {};
    for (const key of dirty) values[key] = snapshot.get(key) as string;
    dirty.clear();
    await store.saveState(source, values);
  };
  return {
    catalog: opts.catalog,
    state: {
      get: (k) => snapshot.get(k),
      set: (k, v) => {
        snapshot.set(k, v);
        dirty.add(k);
      },
    },
    log: opts.log ?? noopLogger,
    now: opts.now ?? (() => new Date()),
    home: opts.home ?? homedir(),
    env: opts.env ?? process.env,
    planFor: (provider) => subs.find((s) => s.provider === provider)?.plan,
    identity: opts.identity ?? (await identityFromStore(store)),
    fetch: opts.fetch,
    flushState,
  };
}

async function identityFromStore(store: EventStore): Promise<ConnectorContext['identity']> {
  const email = await store.getSetting('identity.email');
  const name = await store.getSetting('identity.name');
  const device = await store.getSetting('identity.device');
  if (!email && !name && !device) return undefined;
  return { email, name, device };
}

/** Consume a connector's event stream into the store in batches. */
export async function ingest(opts: RunnerOptions, source: string, events: AsyncIterable<RawUsageEvent>, ctx: RunnerContext): Promise<RunResult> {
  const { store, catalog } = opts;
  const started = Date.now();
  const runId = await store.startRun(source);
  const result: RunResult = { source, seen: 0, inserted: 0, updated: 0, unchanged: 0, unpriced: 0, unpricedModels: [], error: null, durationMs: 0 };
  const unpricedSet = new Set<string>();
  let batch: UsageEvent[] = [];
  const flush = async () => {
    if (batch.length > 0) {
      const r = await store.upsertEvents(batch, source);
      result.inserted += r.inserted;
      result.updated += r.updated;
      result.unchanged += r.unchanged;
      batch = [];
    }
    await ctx.flushState();
  };
  try {
    for await (const raw of events) {
      const { event, unpriced } = finalizeEvent(raw, catalog);
      result.seen++;
      if (unpriced) {
        result.unpriced++;
        unpricedSet.add(`${event.provider}:${event.model}`);
      }
      batch.push(event);
      if (batch.length >= 500) await flush();
    }
    await flush();
  } catch (err) {
    await flush();
    result.error = (err as Error).message;
  }
  result.unpricedModels = [...unpricedSet];
  result.durationMs = Date.now() - started;
  await store.finishRun(runId, { seen: result.seen, inserted: result.inserted, updated: result.updated, unpriced: result.unpriced, error: result.error ?? undefined });
  return result;
}

export async function runLocalScan(opts: RunnerOptions, scan: ScanOptions = {}, only?: string[]): Promise<RunResult[]> {
  const out: RunResult[] = [];
  for (const c of localConnectors as LocalConnector[]) {
    if (only && !only.includes(c.id)) continue;
    const ctx = await connectorContext(opts, c.id);
    const det = await c.detect(ctx);
    if (!det.found) {
      out.push({ source: c.id, seen: 0, inserted: 0, updated: 0, unchanged: 0, unpriced: 0, unpricedModels: [], error: null, durationMs: 0, detail: det.summary });
      continue;
    }
    const r = await ingest(opts, c.id, c.scan(ctx, scan), ctx);
    r.detail = det.summary;
    out.push(r);
  }
  return out;
}

export async function runApiPull(opts: RunnerOptions, connector: ApiConnector, pull: PullOptions = {}, creds?: Record<string, string>): Promise<RunResult> {
  const resolved = creds ?? resolveCredentials(connector, opts.env ?? process.env).creds;
  const ctx = await connectorContext(opts, connector.id);
  return ingest(opts, connector.id, connector.pull(ctx, resolved, pull), ctx);
}

export async function runAllApiPulls(opts: RunnerOptions, pull: PullOptions = {}): Promise<RunResult[]> {
  const out: RunResult[] = [];
  for (const c of apiConnectors as ApiConnector[]) {
    const { creds, missing } = resolveCredentials(c, opts.env ?? process.env);
    if (missing.length) continue; // not configured
    out.push(await runApiPull(opts, c, pull, creds));
  }
  return out;
}

export async function runImport(opts: RunnerOptions, connector: ImportConnector, file: string, importOpts: ImportOptions = {}): Promise<RunResult> {
  const ctx = await connectorContext(opts, connector.id);
  return ingest(opts, connector.id, connector.import(ctx, file, importOpts), ctx);
}

export function findImportConnector(file: string, head: string): ImportConnector | undefined {
  return (importConnectors as ImportConnector[]).find((c) => c.canImport(file, head));
}
