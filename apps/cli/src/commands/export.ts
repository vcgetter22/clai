import { createWriteStream } from 'node:fs';
import type { Command } from 'commander';
import { effectiveCost, type UsageEvent } from '@claii/core';
import { toFilter } from '@claii/server';
import { openContext, type GlobalOptions } from '../context.js';
import { ok } from '../ui.js';

const COLUMNS = ['id', 'ts', 'day', 'source', 'provider', 'model', 'model_key', 'surface', 'billing', 'plan', 'granularity', 'actor', 'project', 'session_id', 'input_tokens', 'cache_read_tokens', 'cache_write_5m_tokens', 'cache_write_1h_tokens', 'output_tokens', 'reasoning_tokens', 'requests', 'web_searches', 'computed_usd', 'billed_usd', 'effective_usd', 'confidence'];

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function rowOf(e: UsageEvent, tz: string): unknown[] {
  const actor = e.actor.email ?? e.actor.userId ?? e.actor.apiKeyId ?? 'me';
  return [
    e.id,
    e.ts,
    e.ts.slice(0, 10),
    e.source,
    e.provider,
    e.model,
    e.modelKey,
    e.surface,
    e.billing,
    e.plan ?? '',
    e.granularity,
    actor,
    e.context.project ?? '',
    e.context.sessionId ?? '',
    e.usage.input,
    e.usage.cacheRead,
    e.usage.cacheWrite5m,
    e.usage.cacheWrite1h,
    e.usage.output,
    e.usage.reasoning ?? '',
    e.usage.requests,
    e.usage.webSearches ?? 0,
    e.cost.computedUsd,
    e.cost.billedUsd,
    effectiveCost(e),
    e.cost.confidence,
  ].map((v, i) => (i === 2 ? dayLocal(e.ts, tz) : v));
}

function dayLocal(ts: string, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ts));
}

export function registerExport(program: Command): void {
  program
    .command('export')
    .description('Export events for finance or BI (CSV, JSON or JSONL)')
    .option('--format <fmt>', 'csv | json | jsonl', 'csv')
    .option('--since <expr>', 'range start', 'all')
    .option('--until <date>', 'range end')
    .option('--provider <id>')
    .option('--source <id>')
    .option('--project <name>')
    .option('-o, --out <file>', 'write to a file instead of stdout')
    .action(async (opts: { format: string; since: string; until?: string; provider?: string; source?: string; project?: string; out?: string }, cmd: Command) => {
      const ctx = openContext({ ...(cmd.optsWithGlobals() as GlobalOptions), quiet: true });
      try {
        const filter = toFilter({ since: opts.since, until: opts.until, provider: opts.provider, source: opts.source, project: opts.project }, ctx.store.timeZone);
        const out = opts.out ? createWriteStream(opts.out) : process.stdout;
        const write = (s: string) => new Promise<void>((res) => (out.write(s) ? res() : out.once('drain', res)));
        let n = 0;
        if (opts.format === 'csv') await write(COLUMNS.join(',') + '\n');
        if (opts.format === 'json') await write('[\n');
        for (const e of ctx.store.iterateEvents(filter)) {
          if (opts.format === 'csv') await write(rowOf(e, ctx.store.timeZone).map(csvCell).join(',') + '\n');
          else if (opts.format === 'jsonl') await write(JSON.stringify(e) + '\n');
          else await write((n ? ',\n' : '') + JSON.stringify(e));
          n++;
        }
        if (opts.format === 'json') await write('\n]\n');
        if (opts.out) {
          await new Promise<void>((res) => (out as import('node:fs').WriteStream).end(res));
          console.error(ok(`wrote ${n} events to ${opts.out}`));
        }
      } finally {
        ctx.close();
      }
    });
}
