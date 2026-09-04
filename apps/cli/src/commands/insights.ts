import type { Command } from 'commander';
import { computeInsights, type QueryOptions } from '@claii/server';
import { openContext, type GlobalOptions } from '../context.js';
import { bold, dim, formatUsd, heading, printJson, severityGlyph } from '../ui.js';

export function registerInsights(program: Command): void {
  program
    .command('insights')
    .description('Savings opportunities, anomalies, forecast, plan value and budget status')
    .option('--since <expr>', 'analysis window', '90d')
    .option('--provider <id>', 'filter by provider')
    .option('--project <name>', 'filter by project')
    .option('--actor <key>', 'filter by actor key')
    .option('--min-impact <usd>', 'hide opportunities below this monthly impact', '0')
    .action((opts: { since: string; provider?: string; project?: string; actor?: string; minImpact: string }, cmd: Command) => {
      const g = cmd.optsWithGlobals() as GlobalOptions;
      const ctx = openContext(g);
      try {
        const q: QueryOptions = { since: opts.since, provider: opts.provider, project: opts.project, actor: opts.actor };
        const min = Number(opts.minImpact) || 0;
        const insights = computeInsights(ctx.store, ctx.catalog, q).filter((i) => (i.impactUsdPerMonth ?? Infinity) >= min || i.severity !== 'opportunity');
        if (ctx.json) return printJson({ insights });
        console.log(heading('clai insights') + dim(`  last ${opts.since}`));
        if (insights.length === 0) {
          console.log(dim('  Nothing to report yet. Ingest more data with `clai scan`, or declare a plan with `clai plan set`.'));
          return;
        }
        const totalImpact = insights.filter((i) => i.severity === 'opportunity').reduce((a, i) => a + (i.impactUsdPerMonth ?? 0), 0);
        for (const i of insights) {
          console.log('');
          console.log(`${severityGlyph(i.severity)} ${bold(i.title)}${i.impactUsdPerMonth ? dim(`  ~${formatUsd(i.impactUsdPerMonth)}/mo`) : ''}`);
          if (i.detail) console.log(`  ${i.detail}`);
          if (i.action) console.log(`  ${dim('→')} ${i.action}`);
        }
        console.log('');
        if (totalImpact > 0) console.log(bold(`  Identified savings: about ${formatUsd(totalImpact)} per month.`));
        console.log(dim('  Insights use API list prices; subscription usage is valued at API-equivalent cost.'));
      } finally {
        ctx.close();
      }
    });
}
