import type { Command } from 'commander';
import { parseSince, type UsageEvent } from '@claii/core';
import { readCredentialsFile, writeCredentials } from '@claii/server';
import { openContext, type GlobalOptions } from '../context.js';
import { HOSTED_URL } from '../hosted.js';
import { count, dim, elapsed, fail, heading, ok, printJson } from '../ui.js';

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
        const token = opts.token ?? ctx.env['CLAI_SYNC_TOKEN'] ?? saved['token'];
        let server = (opts.server ?? ctx.env['CLAI_SYNC_SERVER'] ?? (await ctx.store.getSetting('sync.server')) ?? saved['server'])?.replace(/\/$/, '');
        // A token with nothing else to resolve a server from (e.g. CLAI_SYNC_TOKEN alone) means the hosted service.
        if (!server && token) server = HOSTED_URL;
        if (!server) throw new Error('No server. Pass --server https://clai.example.com or set CLAI_SYNC_SERVER.');
        if (!token) throw new Error('No token. Pass --token (ask your clai admin) or set CLAI_SYNC_TOKEN.');
        if (opts.server || opts.token) writeCredentials('sync', { server, token }, ctx.env);
        const last = await ctx.store.getSetting('sync.last_ts');
        let since: string | null = null;
        if (!opts.all) {
          if (opts.since) since = parseSince(opts.since, new Date(), ctx.store.timeZone);
          else if (last) since = new Date(Date.parse(last) - 3 * 86400e3).toISOString(); // overlap: late-arriving events
        }
        const batchSize = Math.max(1, Number(opts.batch) || 500);
        let sent = 0;
        let inserted = 0;
        let updated = 0;
        let dropped = 0;
        let maxTs = last ?? '';
        let chunk: UsageEvent[] = [];
        const started = Date.now();
        const spin = ctx.progress(`syncing to ${server}`);
        const sendChunk = async () => {
          if (chunk.length === 0) return;
          const res = await fetch(`${server}/api/v1/ingest`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
            body: JSON.stringify({ events: chunk }),
          });
          if (!res.ok) {
            const body = await res.text().catch(() => '');
            throw new Error(`Server responded ${res.status}: ${body.slice(0, 300)}`);
          }
          const r = (await res.json()) as { inserted: number; updated: number; dropped?: number };
          sent += chunk.length;
          inserted += r.inserted;
          updated += r.updated;
          dropped += r.dropped ?? 0;
          for (const e of chunk) if (e.ts > maxTs) maxTs = e.ts;
          spin.update(`sent ${count(sent)} events to ${server}`);
          chunk = [];
        };
        // Batch straight from the store's async iterator instead of materializing every event
        // up front, so a first sync over a large store doesn't hold it all in memory at once.
        try {
          for await (const e of ctx.store.iterateEvents(since ? { since } : {})) {
            chunk.push(opts.keepPaths ? e : stripPaths(e));
            if (chunk.length >= batchSize) await sendChunk();
          }
          await sendChunk();
        } finally {
          spin.stop();
        }
        if (maxTs) await ctx.store.setSetting('sync.last_ts', maxTs);
        if (ctx.json) return printJson({ server, sent, inserted, updated, dropped, since });
        console.log(heading('clai sync', elapsed(Date.now() - started)));
        console.log(ok(`sent ${count(sent)} events to ${server}  ${dim(`${count(inserted)} new, ${count(updated)} updated on the server`)}`));
        if (!opts.keepPaths) console.log(dim('  Working directories and git remotes were stripped; project labels were kept.'));
        if (dropped > 0) console.log(dim(`  ${dropped} events older than your plan's history window were not stored`));
      } catch (err) {
        if (ctx.json) {
          printJson({ error: (err as Error).message });
          process.exitCode = 1;
          return;
        }
        console.log(fail((err as Error).message));
        process.exitCode = 1;
      } finally {
        await ctx.close();
      }
    });
}
