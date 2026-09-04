import { Hono } from 'hono';
import { serve, type ServerType } from '@hono/node-server';
import type { PricingCatalog } from '@claii/core';
import type { EventStore } from '@claii/store';
import { createApi, createToken } from './api.js';
import { runAllApiPulls, runLocalScan, type RunResult, type RunnerOptions } from './runner.js';
import { dashboardDistDir, serveDashboard } from './static.js';

export interface AppOptions {
  store: EventStore;
  catalog: PricingCatalog;
  mode: 'local' | 'team';
  version: string;
  runner?: Partial<RunnerOptions>;
  /** Local mode: enable POST /api/scan. */
  allowScan?: boolean;
  dashboardDir?: string | null;
}

export function createApp(opts: AppOptions): Hono {
  const app = new Hono();
  const runnerOpts: RunnerOptions = { store: opts.store, catalog: opts.catalog, ...(opts.runner ?? {}) };
  const api = createApi({
    store: opts.store,
    catalog: opts.catalog,
    mode: opts.mode,
    version: opts.version,
    scan: opts.mode === 'local' && opts.allowScan !== false ? () => runLocalScan(runnerOpts) : undefined,
  });
  app.route('/api', api);
  app.get('*', serveDashboard(opts.dashboardDir === undefined ? dashboardDistDir() : opts.dashboardDir));
  return app;
}

export interface ListenOptions extends AppOptions {
  port: number;
  host?: string;
}

export function listen(opts: ListenOptions): Promise<{ server: ServerType; url: string; close: () => Promise<void> }> {
  const app = createApp(opts);
  const host = opts.host ?? (opts.mode === 'local' ? '127.0.0.1' : '0.0.0.0');
  return new Promise((resolve, reject) => {
    const server = serve({ fetch: app.fetch, port: opts.port, hostname: host }, (info) => {
      const url = `http://${host === '0.0.0.0' ? 'localhost' : host}:${info.port}`;
      resolve({ server, url, close: () => new Promise<void>((res) => server.close(() => res())) });
    });
    server.on('error', reject);
  });
}

/** Team server bootstrap: ensure an admin token exists (from CLAI_ADMIN_TOKEN or a freshly generated one) and schedule connector pulls. */
export function bootstrapTeam(store: EventStore, env: NodeJS.ProcessEnv = process.env): { adminTokenCreated: string | null } {
  const count = Number((store.db.prepare('SELECT COUNT(*) AS n FROM api_tokens WHERE revoked_at IS NULL').get() as { n: number }).n);
  if (count > 0) return { adminTokenCreated: null };
  const provided = env['CLAI_ADMIN_TOKEN'];
  if (provided) {
    // Register the provided token verbatim for a reproducible bootstrap (docker/compose setups).
    const { tokenHash } = require('./api.js') as typeof import('./api.js');
    store.db
      .prepare('INSERT INTO api_tokens(token_hash, actor_key, label, role, created_at) VALUES (:h, :a, :l, :r, :now)')
      .run({ h: tokenHash(provided), a: env['CLAI_ADMIN_EMAIL'] ?? 'admin', l: 'bootstrap admin', r: 'admin', now: new Date().toISOString() });
    return { adminTokenCreated: provided };
  }
  return { adminTokenCreated: createToken(store, env['CLAI_ADMIN_EMAIL'] ?? 'admin', 'admin', 'bootstrap admin') };
}

export function schedulePulls(runner: RunnerOptions, intervalMinutes: number, onResult?: (r: RunResult[]) => void): () => void {
  if (intervalMinutes <= 0) return () => {};
  const tick = async () => {
    try {
      const r = await runAllApiPulls(runner);
      onResult?.(r);
    } catch (err) {
      runner.log?.warn(`scheduled pull failed: ${(err as Error).message}`);
    }
  };
  void tick();
  const handle = setInterval(() => void tick(), intervalMinutes * 60_000);
  return () => clearInterval(handle);
}
