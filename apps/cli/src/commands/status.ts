import type { Command } from 'commander';
import { computeSummary } from '@claii/server';
import { openContext, type GlobalOptions } from '../context.js';
import { formatUsd, printJson } from '../ui.js';

export function registerStatus(program: Command): void {
  program
    .command('status')
    .description('One-line status for shell prompts and statuslines (today, month, projection, plan value)')
    .option('--scan', 'refresh local sources first', false)
    .action(async (opts: { scan: boolean }, cmd: Command) => {
      const ctx = openContext({ ...(cmd.optsWithGlobals() as GlobalOptions), quiet: true });
      try {
        if (opts.scan) {
          const { runLocalScan } = await import('@claii/server');
          await runLocalScan(ctx.runner);
        }
        const s = await computeSummary(ctx.store, ctx.catalog, { since: 'month' });
        const top = s.byModel[0];
        const plan = s.subscriptions[0];
        const parts = [`today ${formatUsd(s.today.usd)}`, `month ${formatUsd(s.thisMonth.usd)} → ${formatUsd(s.forecast.projectedUsd)}`];
        if (top) parts.push(`top ${top.key.replace(/^claude-/, '')}`);
        if (plan) parts.push(`${plan.subscription.plan} ${plan.multiple.toFixed(1)}x`);
        if (ctx.json) return printJson({ today: s.today.usd, month: s.thisMonth.usd, projected: s.forecast.projectedUsd, topModel: top?.key ?? null, plan: plan ? { plan: plan.subscription.plan, multiple: plan.multiple } : null });
        process.stdout.write(parts.join(' | ') + '\n');
      } finally {
        await ctx.close();
      }
    });
}
