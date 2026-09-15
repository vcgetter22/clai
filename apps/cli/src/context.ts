import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import type { PricingCatalog } from '@claii/core';
import type { Logger } from '@claii/connectors';
import { defaultDbPath } from '@claii/store';
import { SqliteEventStore } from '@claii/store/sqlite';
import { loadCatalog, type RunnerOptions } from '@claii/server';
import pc from 'picocolors';
import { motionEnabled, progress, type Progress } from './ui.js';

export interface GlobalOptions {
  json?: boolean;
  db?: string;
  quiet?: boolean;
  verbose?: boolean;
}

export interface CliContext {
  /** Concrete SQLite store, not the `EventStore` interface: the CLI is always local (`clai sync` talks HTTP to a team server), and `clai ask` needs the raw `db` handle. */
  store: SqliteEventStore;
  catalog: PricingCatalog;
  catalogOverridden: boolean;
  env: NodeJS.ProcessEnv;
  home: string;
  log: Logger;
  json: boolean;
  version: string;
  runner: RunnerOptions;
  /** Progress line on stderr while a command works; a no-op with --quiet, --json or a non-TTY stderr. */
  progress: (label: string) => Progress;
  /** Reveal animations on stdout (terminal only, never with --quiet or --json). */
  motion: boolean;
  close: () => Promise<void>;
}

export function cliVersion(): string {
  try {
    const req = createRequire(import.meta.url);
    const pkg = req('../package.json') as { version: string };
    return pkg.version;
  } catch {
    return '0.0.0';
  }
}

export function makeLogger(opts: GlobalOptions): Logger {
  const quiet = !!opts.quiet || !!opts.json;
  return {
    debug: (m) => {
      if (opts.verbose && !quiet) console.error(pc.dim(m));
    },
    info: (m) => {
      if (!quiet) console.error(m);
    },
    warn: (m) => {
      if (!quiet) console.error(pc.yellow(m));
    },
  };
}

export function openContext(opts: GlobalOptions = {}): CliContext {
  const env = process.env;
  const dbPath = opts.db ?? defaultDbPath(env);
  const store = new SqliteEventStore(dbPath, { timeZone: env['CLAI_TZ'] });
  const { catalog, overridden } = loadCatalog(env);
  const log = makeLogger(opts);
  const runner: RunnerOptions = { store, catalog, log, env, home: homedir() };
  return {
    store,
    catalog,
    catalogOverridden: overridden,
    env,
    home: homedir(),
    log,
    json: !!opts.json,
    version: cliVersion(),
    runner,
    progress: (label) => progress(label, opts.quiet || opts.json ? { enabled: false } : {}),
    motion: !opts.quiet && !opts.json && motionEnabled(),
    close: () => store.close(),
  };
}
