import { existsSync, statSync } from 'node:fs';
import type { Command } from 'commander';
import { resolveModel } from '@claii/core';
import { apiConnectors, localConnectors, readClaudeStatsCache, type ApiConnector, type LocalConnector } from '@claii/connectors';
import { connectorContext, dashboardDistDir, resolveCredentials } from '@claii/server';
import { credentialsPath } from '@claii/store';
import { openContext, type GlobalOptions } from '../context.js';
import { dim, fail, formatTokens, formatUsd, heading, ok, printJson, table, warn } from '../ui.js';

export function registerDoctor(program: Command): void {
  program
    .command('doctor')
    .description('Check the environment, detect sources, and cross-check clai against Claude Code\'s own cost numbers')
    .action(async (_o: unknown, cmd: Command) => {
      const ctx = openContext(cmd.optsWithGlobals() as GlobalOptions);
      try {
        const report: Record<string, unknown> = {};
        const lines: string[] = [];
        const nodeOk = Number(process.versions.node.split('.')[0]) >= 22;
        lines.push(nodeOk ? ok(`Node ${process.versions.node}`) : fail(`Node ${process.versions.node} (need >= 22.13 for built-in SQLite)`));
        lines.push(ok(`Database ${ctx.store.path} (${await ctx.store.countEvents()} events${existsSync(ctx.store.path) ? `, ${(statSync(ctx.store.path).size / 1e6).toFixed(1)} MB` : ''})`));
        lines.push(ok(`Timezone ${ctx.store.timeZone}`));
        lines.push(ok(`Pricing catalog ${ctx.catalog.version} (${ctx.catalog.models.length} models${ctx.catalogOverridden ? ', overrides active' : ''})`));
        lines.push(dashboardDistDir() ? ok('Dashboard bundle found') : warn('Dashboard bundle missing (npm run build -w @claii/dashboard)'));
        lines.push(existsSync(credentialsPath(ctx.env)) ? ok(`Credentials file ${credentialsPath(ctx.env)}`) : dim(`No credentials file yet (${credentialsPath(ctx.env)})`));
        report['node'] = process.versions.node;

        const local: unknown[] = [];
        for (const c of localConnectors as LocalConnector[]) {
          const det = await c.detect(await connectorContext(ctx.runner, c.id));
          local.push({ id: c.id, ...det });
          lines.push(det.found ? ok(`${c.displayName}: ${det.summary}`) : dim(`${c.displayName}: ${det.summary}`));
        }
        report['local'] = local;
        const api: unknown[] = [];
        for (const c of apiConnectors as ApiConnector[]) {
          const r = resolveCredentials(c, ctx.env);
          api.push({ id: c.id, configured: r.missing.length === 0, source: r.source });
          lines.push(r.missing.length === 0 ? ok(`${c.displayName}: configured (${r.source})`) : dim(`${c.displayName}: not configured`));
        }
        report['api'] = api;

        // Cross-check against Claude Code's own stats cache. Claude Code writes one transcript line per
        // streamed content block, each repeating the same usage, and its /stats counters add up every line;
        // clai counts each API request once (message id + request id), which is what the API bills.
        const stats = readClaudeStatsCache(ctx.env, ctx.home);
        let crossRows: string[][] = [];
        let anyCcCost = false;
        if (stats) {
          const ours = await ctx.store.totalsBy('model', { source: 'claude-code' }, 100);
          crossRows = Object.entries(stats.modelUsage).map(([model, cc]) => {
            const key = resolveModel(ctx.catalog, model).price?.id ?? model;
            const mine = ours.find((o) => o.key === key || o.key === model);
            const ccTokens = cc.inputTokens + cc.cacheReadInputTokens + cc.cacheCreationInputTokens + cc.outputTokens;
            const ourTokens = mine ? mine.usage.input + mine.usage.cacheRead + mine.usage.cacheWrite5m + mine.usage.cacheWrite1h + mine.usage.output : 0;
            const ratio = ourTokens > 0 ? ccTokens / ourTokens : 0;
            if (cc.costUSD > 0) anyCcCost = true;
            return [key, formatTokens(ccTokens), formatTokens(ourTokens), ratio ? `${ratio.toFixed(2)}x` : '-', cc.costUSD > 0 ? formatUsd(cc.costUSD) : '-', formatUsd(mine?.computedUsd ?? 0)];
          });
          report['claudeCodeCrossCheck'] = crossRows;
        }
        if (ctx.json) return printJson(report);
        console.log(heading('clai doctor'));
        for (const l of lines) console.log('  ' + l);
        if (crossRows.length) {
          console.log('');
          console.log(heading('Cross-check vs Claude Code /stats'));
          console.log(table(['model', 'Claude Code tokens', 'clai tokens', 'ratio', 'CC cost', 'clai cost'], crossRows, ['l', 'r', 'r', 'r', 'r', 'r']));
          console.log(dim('  Claude Code counts every streamed content block (usually 2-3 lines per request); clai counts each request once, as billed.'));
          console.log(dim('  A ratio near 2x is expected. Models missing on the clai side were used before the earliest transcript still on disk.'));
          if (!anyCcCost) console.log(dim('  Claude Code reports no cost in its stats cache on this machine; clai prices from its catalog.'));
        }
      } finally {
        await ctx.close();
      }
    });
}
