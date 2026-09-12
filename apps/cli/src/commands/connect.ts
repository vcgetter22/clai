import type { Command } from 'commander';
import { parseSince } from '@claii/core';
import { apiConnectors, type ApiConnector } from '@claii/connectors';
import { connectorContext, deleteCredentials, maskSecret, resolveCredentials, runApiPull, writeCredentials } from '@claii/server';
import { openContext, type GlobalOptions } from '../context.js';
import { dim, fail, formatUsd, heading, ok, printJson, table, warn } from '../ui.js';

function findApi(id: string): ApiConnector {
  const c = (apiConnectors as ApiConnector[]).find((x) => x.id === id);
  if (!c) throw new Error(`Unknown API connector "${id}". Available: ${(apiConnectors as ApiConnector[]).map((x) => x.id).join(', ') || 'none'}`);
  return c;
}

export function registerConnect(program: Command): void {
  program
    .command('connect [source]')
    .description('Configure a provider connector (Anthropic Admin API, OpenAI Admin API, OpenRouter, Cursor, GitHub Copilot). Credentials are stored in ~/.clai/credentials.json (0600).')
    .option('--set <pairs...>', 'credential values as key=value (e.g. --set adminKey=sk-ant-admin...)')
    .option('--no-verify', 'skip the verification request')
    .option('--list', 'show connector status', false)
    .action(async (source: string | undefined, opts: { set?: string[]; verify: boolean; list: boolean }, cmd: Command) => {
      const ctx = openContext(cmd.optsWithGlobals() as GlobalOptions);
      try {
        if (!source || opts.list) {
          const rows = (apiConnectors as ApiConnector[]).map((c) => {
            const r = resolveCredentials(c, ctx.env);
            return { id: c.id, name: c.displayName, configured: r.missing.length === 0, source: r.source, missing: r.missing, credentials: c.credentials.map((s) => `${s.key}${s.envVar ? ` ($${s.envVar})` : ''}`) };
          });
          if (ctx.json) return printJson({ connectors: rows });
          console.log(heading('API connectors'));
          if (rows.length === 0) return console.log(dim('  no API connectors registered in this build'));
          console.log(table(['id', 'name', 'status', 'credentials'], rows.map((r) => [r.id, r.name, r.configured ? ok(`configured (${r.source})`) : dim(`missing ${r.missing.join(', ')}`), r.credentials.join(', ')])));
          console.log(dim('  Configure: clai connect <id> --set key=value ...   Pull: clai pull [id]'));
          return;
        }
        const c = findApi(source);
        const given: Record<string, string> = {};
        for (const pair of opts.set ?? []) {
          const i = pair.indexOf('=');
          if (i <= 0) throw new Error(`--set expects key=value, got "${pair}"`);
          given[pair.slice(0, i)] = pair.slice(i + 1);
        }
        if (Object.keys(given).length) writeCredentials(c.id, given, ctx.env);
        const { creds, missing } = resolveCredentials(c, ctx.env);
        if (missing.length) {
          const help = c.credentials.filter((s) => missing.includes(s.key)).map((s) => `  --set ${s.key}=...   ${s.label}${s.help ? ` (${s.help})` : ''}${s.envVar ? ` [env ${s.envVar}]` : ''}`);
          throw new Error(`Missing credentials for ${c.displayName}:\n${help.join('\n')}`);
        }
        if (opts.verify) {
          const cctx = await connectorContext(ctx.runner, c.id);
          const v = await c.verify(cctx, creds);
          if (ctx.json) return printJson({ connector: c.id, ok: v.ok, message: v.message });
          console.log(v.ok ? ok(`${c.displayName}: ${v.message}`) : fail(`${c.displayName}: ${v.message}`));
          if (!v.ok) process.exitCode = 1;
          else console.log(dim(`  Stored ${Object.keys(creds).map((k) => `${k}=${maskSecret(creds[k]!)}`).join(', ')}. Next: clai pull ${c.id}`));
        } else if (!ctx.json) console.log(ok(`${c.displayName} configured (not verified)`));
      } finally {
        await ctx.close();
      }
    });

  program
    .command('disconnect <source>')
    .description('Remove stored credentials for a connector (keeps ingested data)')
    .action(async (source: string, _o: unknown, cmd: Command) => {
      const ctx = openContext(cmd.optsWithGlobals() as GlobalOptions);
      try {
        const removed = deleteCredentials(source, ctx.env);
        if (ctx.json) return printJson({ removed });
        console.log(removed ? ok(`Removed credentials for ${source}`) : warn(`No stored credentials for ${source}`));
      } finally {
        await ctx.close();
      }
    });

  program
    .command('pull [source]')
    .description('Pull usage from configured provider connectors (all configured ones when no source is given)')
    .option('--since <expr>', 'start of the window (default: last pull, or 90d on first run)')
    .option('--until <date>', 'end of the window')
    .option('--full', 'ignore saved cursors', false)
    .action(async (source: string | undefined, opts: { since?: string; until?: string; full: boolean }, cmd: Command) => {
      const ctx = openContext(cmd.optsWithGlobals() as GlobalOptions);
      try {
        const targets = source ? [findApi(source)] : (apiConnectors as ApiConnector[]).filter((c) => resolveCredentials(c, ctx.env).missing.length === 0);
        if (targets.length === 0) throw new Error('No configured connectors. Run `clai connect --list`.');
        const since = opts.since ? parseSince(opts.since, new Date(), ctx.store.timeZone) : undefined;
        const until = opts.until ? new Date(opts.until).toISOString() : undefined;
        const results = [];
        for (const c of targets) {
          const { creds, missing } = resolveCredentials(c, ctx.env);
          if (missing.length) throw new Error(`${c.id}: missing credentials ${missing.join(', ')} (run clai connect ${c.id})`);
          ctx.log.info(`pulling ${c.displayName}...`);
          results.push(await runApiPull(ctx.runner, c, { since, until, full: opts.full }, creds));
        }
        if (ctx.json) return printJson({ results });
        console.log(heading('clai pull'));
        console.log(table(['source', 'seen', 'new', 'updated', 'unpriced', 'time', 'status'], results.map((r) => [r.source, String(r.seen), String(r.inserted), String(r.updated), r.unpriced ? warn(String(r.unpriced)) : '0', `${(r.durationMs / 1000).toFixed(1)}s`, r.error ? fail(r.error) : ok('ok')])));
        const t = await ctx.store.total({ since: parseSince('30d') ?? undefined });
        console.log(dim(`  Last 30 days across all sources: ${formatUsd(t.usd)}`));
      } finally {
        await ctx.close();
      }
    });
}
