import { defaultDbPath } from '@claii/store';
import { SqliteEventStore } from '@claii/store/sqlite';
import { bootstrapTeam, listen, schedulePulls } from './app.js';
import { loadCatalog } from './catalog.js';

/** `clai-server` entry point (team mode). Configuration via environment variables. */
export async function main(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const port = Number(env['PORT'] ?? 8787);
  const dbPath = defaultDbPath(env);
  const store = new SqliteEventStore(dbPath, { timeZone: env['CLAI_TZ'] });
  const { catalog, overridden } = loadCatalog(env);
  const boot = await bootstrapTeam(store, env);
  const log = { debug: () => {}, info: (m: string) => console.log(`[clai-server] ${m}`), warn: (m: string) => console.warn(`[clai-server] ${m}`) };
  const { url } = await listen({ store, catalog, mode: 'team', version: '0.2.0', port, host: env['HOST'] ?? '0.0.0.0', runner: { log, env } });
  log.info(`team server listening on ${url} (db: ${dbPath}${overridden ? ', pricing overrides active' : ''})`);
  if (boot.adminTokenCreated) {
    log.info('');
    log.info('Bootstrap admin token (store it now; it is not shown again):');
    log.info(`  ${boot.adminTokenCreated}`);
    log.info('');
  }
  const interval = Number(env['CLAI_PULL_INTERVAL_MINUTES'] ?? 60);
  schedulePulls({ store, catalog, log, env }, interval, (results) => {
    for (const r of results) log.info(`pull ${r.source}: ${r.inserted} new, ${r.updated} updated${r.error ? `, error: ${r.error}` : ''}`);
  });
}
