import type { Command } from 'commander';
import { parseSince, type UsageEvent } from '@claii/core';
import { readCredentialsFile, writeCredentials } from '@claii/server';
import { openContext, type GlobalOptions } from '../context.js';
import { dim, fail, heading, ok, printJson } from '../ui.js';

/** Remove local paths before sharing with a team; keeps the project label. */
export function stripPaths(e: UsageEvent): UsageEvent {
  const { cwd: _cwd, gitRepo: _repo, ...rest } = e.context;
  return { ...e, context: rest };
}

export function registerSync(program: Command): void {
  program
    .command('sync')
    .description('Push local usage (metadata only, never prompt content) to a clai team server')
    .option('--server <url>', 'team server URL (or CLAI_SYNC_SERVER / config sync.server)')
    .option('--token <token>', 'member token (or CLAI_SYNC_TOKEN; stored in ~/.clai/credentials.json after first use)')
    .option('--since <expr>', 'resend events newer than this instead of continuing from the last sync')
    .option('--all', 'resend everything', false)
    .option('--keep-paths', 'include working directories and git remotes (default: stripped)', false)
    .option('--batch <n>', 'events per request', '500')
    .action(async (opts: { server?: string; token?: string; since?: string; all: boolean; keepPaths: boolean; batch: string }, cmd: Command) => {
      const ctx = openContext(cmd.optsWithGlobals() as GlobalOptions);
      try {
        const saved = readCredentialsFile(ctx.env)['sync'] ?? {};
        const server = (opts.server ?? ctx.env['CLAI_SYNC_SERVER'] ?? ctx.store.getSetting('sync.server') ?? saved['server'])?.replace(/\/$/, '');
        const token = opts.token ?? ctx.env['CLAI_SYNC_TOKEN'] ?? saved['token'];
        if (!server) throw new Error('No server. Pass --server https://clai.example.com or set CLAI_SYNC_SERVER.');
        if (!token) throw new Error('No token. Pass --token (ask your clai admin) or set CLAI_SYNC_TOKEN.');
        if (opts.server || opts.token) writeCredentials('sync', { server, token }, ctx.env);
        const last = ctx.store.getSetting('sync.last_ts');
        let since: string | null = null;
        if (!opts.all) {
          if (opts.since) since = parseSince(opts.since, new Date(), ctx.store.timeZone);
          else if (last) since = new Date(Date.parse(last) - 3 * 86400e3).toISOString(); // overlap: late-arriving events
        }
        const events = [...ctx.store.iterateEvents(since ? { since } : {})].map((e) => (opts.keepPaths ? e : stripPaths(e)));
        const batch = Math.max(1, Number(opts.batch) || 500);
        let sent = 0;
        let inserted = 0;
        let updated = 0;
        let maxTs = last ?? '';
        for (let i = 0; i < events.length; i += batch) {
          const chunk = events.slice(i, i + batch);
          const res = await fetch(`${server}/api/v1/ingest`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
            body: JSON.stringify({ events: chunk }),
          });
          if (!res.ok) {
            const body = await res.text().catch(() => '');
            throw new Error(`Server responded ${res.status}: ${body.slice(0, 300)}`);
          }
          const r = (await res.json()) as { inserted: number; updated: number };
          sent += chunk.length;
          inserted += r.inserted;
          updated += r.updated;
          for (const e of chunk) if (e.ts > maxTs) maxTs = e.ts;
          ctx.log.debug(`sent ${sent}/${events.length}`);
        }
        if (maxTs) ctx.store.setSetting('sync.last_ts', maxTs);
        if (ctx.json) return printJson({ server, sent, inserted, updated, since });
        console.log(heading('clai sync'));
        console.log(ok(`sent ${sent} events to ${server} (${inserted} new, ${updated} updated on the server)`));
        if (!opts.keepPaths) console.log(dim('  Working directories and git remotes were stripped; project labels were kept.'));
      } catch (err) {
        if (ctx.json) {
          printJson({ error: (err as Error).message });
          process.exitCode = 1;
          return;
        }
        console.log(fail((err as Error).message));
        process.exitCode = 1;
      } finally {
        ctx.close();
      }
    });
}
