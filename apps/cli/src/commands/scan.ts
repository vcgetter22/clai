import type { Command } from 'commander';
import { parseSince } from '@claii/core';
import { localConnectors } from '@claii/connectors';
import { runLocalScan, computeSummary } from '@claii/server';
import { openContext, type GlobalOptions } from '../context.js';
import { box, count, dim, elapsed, formatUsd, heading, homePath, kvLines, ok, pct, printJson, table, termWidth, truncate, warn } from '../ui.js';

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
        const spin = ctx.progress('scanning');
        let results;
        try {
          results = await runLocalScan(ctx.runner, { since, full: opts.full }, only, {
            onStart: (id) => spin.update(`scanning ${id}`),
            onResult: (r) => {
              if (r.inserted || r.updated) spin.update(`${r.source}: ${count(r.inserted)} new`);
            },
          });
        } finally {
          spin.stop();
        }
        if (ctx.json) {
          printJson({ results, durationMs: Date.now() - started });
          return;
        }
        console.log(heading('clai scan', elapsed(Date.now() - started)));
        // The detected column carries connector messages with full paths; cap it so the table fits
        // the terminal (source ~12, ingested ~22, notes ~24 plus gutters).
        const detailWidth = Math.max(40, Math.min(72, termWidth() - 56));
        const rows = results.map((r) => [
          r.source,
          truncate(homePath(r.detail ?? '', ctx.home), detailWidth),
          r.error ? warn(r.error) : r.seen === 0 && r.inserted === 0 ? dim('nothing new') : `${r.inserted} new, ${r.updated} updated`,
          r.unpriced ? warn(`${r.unpriced} unpriced (${r.unpricedModels.slice(0, 3).join(', ')})`) : '',
        ]);
        console.log(table(['source', 'detected', 'ingested', 'notes'], rows));
        const known = localConnectors.map((c) => c.id);
        const skipped = known.filter((id) => !results.some((r) => r.source === id));
        if (skipped.length) console.log(dim(`  skipped: ${skipped.join(', ')}`));
        const s = await computeSummary(ctx.store, ctx.catalog, { since: '30d' });
        const basis = s.totals.billedUsd !== null ? 'billed' : 'API-equivalent';
        const top = s.byModel[0];
        console.log('');
        console.log(ok(`${count(await ctx.store.countEvents())} events in ${homePath(ctx.store.path, ctx.home)}`));
        const card: [string, string][] = [
          ['spend', `${formatUsd(s.totals.usd)}  ${dim(basis)}`],
          ['this month', `${formatUsd(s.thisMonth.usd)}  ${dim(`projected ${formatUsd(s.forecast.projectedUsd)}`)}`],
          ['requests', count(s.totals.events)],
        ];
        if (top) card.push(['top model', `${top.key}  ${dim(pct(top.share))}`]);
        console.log(box(kvLines(card), { title: 'last 30 days' }));
        if ((await ctx.store.listSubscriptions()).length === 0) {
          console.log(dim('  Tip: declare your plan so clai can value it, e.g. `clai plan set anthropic max_20x`'));
        }
        console.log(dim('  Next: clai report · clai insights · clai dashboard'));
      } finally {
        await ctx.close();
      }
    });
}
