import type { Command } from 'commander';
import { parseSince } from '@claii/core';
import { localConnectors } from '@claii/connectors';
import { runLocalScan, computeSummary } from '@claii/server';
import { openContext, type GlobalOptions } from '../context.js';
import { dim, formatUsd, heading, ok, printJson, table, warn } from '../ui.js';

export function registerScan(program: Command): void {
  program
    .command('scan')
    .description('Detect local AI tools (Claude Code, Codex CLI, Gemini CLI, OpenCode, Cline, Aider) and ingest their usage')
    .option('--since <expr>', 'only ingest usage newer than this (e.g. 30d, 2026-08-01); default: everything', undefined)
    .option('--full', 'ignore saved file offsets and re-read every file', false)
    .option('--only <ids>', 'comma-separated connector ids to scan', undefined)
    .action(async (opts: { since?: string; full: boolean; only?: string }, cmd: Command) => {
      const g = cmd.optsWithGlobals() as GlobalOptions;
      const ctx = openContext(g);
      try {
        const since = opts.since ? parseSince(opts.since, new Date(), ctx.store.timeZone) : null;
        const only = opts.only ? opts.only.split(',').map((s) => s.trim()) : undefined;
        const started = Date.now();
        const results = await runLocalScan(ctx.runner, { since, full: opts.full }, only);
        if (ctx.json) {
          printJson({ results, durationMs: Date.now() - started });
          return;
        }
        console.log(heading('clai scan'));
        const rows = results.map((r) => [
          r.source,
          r.detail ?? '',
          r.error ? warn(r.error) : r.seen === 0 && r.inserted === 0 ? dim('nothing new') : `${r.inserted} new, ${r.updated} updated`,
          r.unpriced ? warn(`${r.unpriced} unpriced (${r.unpricedModels.slice(0, 3).join(', ')})`) : '',
        ]);
        console.log(table(['source', 'detected', 'ingested', 'notes'], rows));
        const known = localConnectors.map((c) => c.id);
        const skipped = known.filter((id) => !results.some((r) => r.source === id));
        if (skipped.length) console.log(dim(`  skipped: ${skipped.join(', ')}`));
        const s = computeSummary(ctx.store, ctx.catalog, { since: '30d' });
        console.log('');
        console.log(ok(`${ctx.store.countEvents()} events in ${ctx.store.path}`));
        console.log(`  Last 30 days: ${formatUsd(s.totals.usd)} across ${s.totals.events} requests. This month: ${formatUsd(s.thisMonth.usd)}, projected ${formatUsd(s.forecast.projectedUsd)}.`);
        if (ctx.store.listSubscriptions().length === 0) {
          console.log(dim('  Tip: declare your plan so clai can value it, e.g. `clai plan set anthropic max_20x`'));
        }
        console.log(dim('  Next: `clai report`, `clai insights`, or `clai dashboard`'));
      } finally {
        ctx.close();
      }
    });
}
