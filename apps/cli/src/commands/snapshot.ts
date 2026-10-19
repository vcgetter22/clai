import type { Command } from 'commander';
import { computeSnapshot, runLocalScan, type RunResult } from '@claii/server';
import { openContext, type GlobalOptions } from '../context.js';
import { printJson } from '../ui.js';

/**
 * `clai snapshot`: the whole glanceable picture (today, month with basis and forecast, 30 days,
 * where it went, plans, budgets, top insights) as one JSON document. clai for Mac runs it with
 * --scan on every refresh; the shape is versioned by its `schema` field.
 */
export function registerSnapshot(program: Command): void {
  program
    .command('snapshot')
    .description('Everything the menu bar shows, as one JSON document (used by clai for Mac)')
    .option('--scan', 'refresh local sources first and report what was detected', false)
    .action(async (opts: { scan: boolean }, cmd: Command) => {
      const ctx = openContext({ ...(cmd.optsWithGlobals() as GlobalOptions), quiet: true });
      try {
        let scan: { results: RunResult[]; durationMs: number } | null = null;
        if (opts.scan) {
          const started = Date.now();
          const results = await runLocalScan(ctx.runner);
          scan = { results, durationMs: Date.now() - started };
        }
        printJson(await computeSnapshot(ctx.store, ctx.catalog, { engineVersion: ctx.version, scan }));
      } finally {
        await ctx.close();
      }
    });
}
