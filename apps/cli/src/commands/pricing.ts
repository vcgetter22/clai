import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Command } from 'commander';
import { resolveModel, type ModelPrice, type PricingCatalog } from '@claii/core';
import { pricingOverridePath } from '@claii/store';
import { openContext, type GlobalOptions } from '../context.js';
import { dim, formatUsd, heading, ok, printJson, table, warn } from '../ui.js';

function readOverride(path: string): Partial<PricingCatalog> {
  if (!existsSync(path)) return { models: [] };
  return JSON.parse(readFileSync(path, 'utf8')) as Partial<PricingCatalog>;
}

export function registerPricing(program: Command): void {
  const pricing = program.command('pricing').description('Model price catalog: list, inspect, override, reprice');
  pricing
    .command('list')
    .option('--provider <id>')
    .option('--all', 'include retired models', false)
    .action((opts: { provider?: string; all: boolean }, cmd: Command) => {
      const ctx = openContext(cmd.optsWithGlobals() as GlobalOptions);
      try {
        const models = ctx.catalog.models.filter((m) => (!opts.provider || m.provider === opts.provider) && (opts.all || !m.retired));
        if (ctx.json) return printJson({ version: ctx.catalog.version, models });
        console.log(heading(`Pricing catalog ${ctx.catalog.version}`) + dim(' (USD per 1M tokens)'));
        console.log(table(['provider', 'model', 'tier', 'input', 'cache read', 'cache write', 'output', 'ctx', 'status'], models.map((m) => [m.provider, m.id, m.tier, formatUsd(m.input), m.cacheRead === null ? '-' : formatUsd(m.cacheRead), m.cacheWrite5m === null ? '-' : formatUsd(m.cacheWrite5m), formatUsd(m.output), m.contextWindow ? `${Math.round(m.contextWindow / 1000)}k` : '-', m.retired ? dim('retired') : m.verified ? ok('verified') : warn('unverified')]), ['l', 'l', 'l', 'r', 'r', 'r', 'r', 'r', 'l']));
      } finally {
        ctx.close();
      }
    });
  pricing
    .command('show <model>')
    .action((model: string, _o: unknown, cmd: Command) => {
      const ctx = openContext(cmd.optsWithGlobals() as GlobalOptions);
      try {
        const r = resolveModel(ctx.catalog, model);
        if (ctx.json) return printJson(r);
        if (!r.price) return console.log(warn(`No price for "${model}" (normalized: ${r.normalized}). Add one with: clai pricing set ${r.normalized} --input X --output Y`));
        const p = r.price;
        console.log(heading(`${p.displayName} (${p.id})`) + dim(`  matched by ${r.match}`));
        console.log(table(['field', 'value'], [
          ['provider', p.provider],
          ['tier', p.tier],
          ['input', formatUsd(p.input)],
          ['cache read', p.cacheRead === null ? 'derived' : formatUsd(p.cacheRead)],
          ['cache write 5m / 1h', `${p.cacheWrite5m === null ? 'derived' : formatUsd(p.cacheWrite5m)} / ${p.cacheWrite1h === null ? 'derived' : formatUsd(p.cacheWrite1h)}`],
          ['output', formatUsd(p.output)],
          ['batch multiplier', p.batchMultiplier === null ? 'none' : String(p.batchMultiplier)],
          ['long context', p.longContext ? `> ${p.longContext.threshold.toLocaleString()} tokens: ${formatUsd(p.longContext.input)} in / ${formatUsd(p.longContext.output)} out` : 'none'],
          ['context window', p.contextWindow ? p.contextWindow.toLocaleString() : '-'],
          ['status', p.retired ? `retired ${p.retired}` : p.deprecated ? `deprecated ${p.deprecated}` : 'active'],
          ['verified', p.verified ? `yes (${p.source ?? ''})` : 'no'],
          ['aliases', p.aliases.join(', ') || '-'],
          ['note', p.note ?? '-'],
        ]));
      } finally {
        ctx.close();
      }
    });
  pricing
    .command('set <model>')
    .description('Add or override a model price in ~/.clai/pricing.json, then reprice stored events')
    .requiredOption('--input <usd>', 'input price per 1M tokens')
    .requiredOption('--output <usd>', 'output price per 1M tokens')
    .option('--provider <id>', 'provider id (default: inferred)')
    .option('--cache-read <usd>')
    .option('--cache-write-5m <usd>')
    .option('--cache-write-1h <usd>')
    .option('--display <name>')
    .option('--tier <tier>', 'frontier | mid | small | embedding | other', 'mid')
    .action((model: string, opts: { input: string; output: string; provider?: string; cacheRead?: string; cacheWrite5m?: string; cacheWrite1h?: string; display?: string; tier: string }, cmd: Command) => {
      const ctx = openContext(cmd.optsWithGlobals() as GlobalOptions);
      try {
        const path = pricingOverridePath(ctx.env);
        const override = readOverride(path);
        const existing = resolveModel(ctx.catalog, model).price;
        const provider = (opts.provider ?? existing?.provider ?? 'other') as ModelPrice['provider'];
        const entry: ModelPrice = {
          ...(existing ?? { aliases: [], family: model, batchMultiplier: null, longContext: null, contextWindow: null, maxOutput: null }),
          provider,
          id: existing?.id ?? model,
          displayName: opts.display ?? existing?.displayName ?? model,
          family: existing?.family ?? model,
          tier: (opts.tier as ModelPrice['tier']) ?? existing?.tier ?? 'mid',
          input: Number(opts.input),
          output: Number(opts.output),
          cacheRead: opts.cacheRead !== undefined ? Number(opts.cacheRead) : (existing?.cacheRead ?? null),
          cacheWrite5m: opts.cacheWrite5m !== undefined ? Number(opts.cacheWrite5m) : (existing?.cacheWrite5m ?? null),
          cacheWrite1h: opts.cacheWrite1h !== undefined ? Number(opts.cacheWrite1h) : (existing?.cacheWrite1h ?? null),
          verified: false,
          note: 'User override',
        } as ModelPrice;
        override.models = [...(override.models ?? []).filter((m) => m.id !== entry.id), entry];
        override.version = override.version ?? `${ctx.catalog.version}+local`;
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, JSON.stringify(override, null, 2));
        // Reprice with the merged catalog.
        const fresh = openContext({ ...(cmd.optsWithGlobals() as GlobalOptions), quiet: true });
        const changed = fresh.store.repriceAll(fresh.catalog);
        fresh.close();
        if (ctx.json) return printJson({ entry, path, repriced: changed });
        console.log(ok(`Saved ${entry.id} to ${path}; repriced ${changed} events.`));
      } finally {
        ctx.close();
      }
    });
  pricing
    .command('reprice')
    .description('Recompute costs of all stored events with the current catalog')
    .action((_o: unknown, cmd: Command) => {
      const ctx = openContext(cmd.optsWithGlobals() as GlobalOptions);
      try {
        const n = ctx.store.repriceAll(ctx.catalog);
        if (ctx.json) return printJson({ repriced: n });
        console.log(ok(`Repriced ${n} events with catalog ${ctx.catalog.version}.`));
      } finally {
        ctx.close();
      }
    });
  pricing
    .command('check')
    .description('List models seen in your data that are unpriced or unverified')
    .action((_o: unknown, cmd: Command) => {
      const ctx = openContext(cmd.optsWithGlobals() as GlobalOptions);
      try {
        const used = ctx.store.totalsBy('model', {}, 500);
        const rows = used.map((u) => {
          const r = resolveModel(ctx.catalog, u.key);
          return { model: u.key, events: u.events, usd: u.usd, status: r.match === 'synthetic' ? 'synthetic (free)' : !r.price ? 'UNPRICED' : r.price.verified ? 'verified' : 'unverified', match: r.match };
        });
        if (ctx.json) return printJson({ models: rows });
        console.log(heading('Pricing check'));
        console.log(table(['model', 'events', 'spend', 'status', 'match'], rows.map((r) => [r.model, String(r.events), formatUsd(r.usd), r.status === 'UNPRICED' ? warn(r.status) : r.status === 'unverified' ? warn(r.status) : ok(r.status), r.match]), ['l', 'r', 'r', 'l', 'l']));
      } finally {
        ctx.close();
      }
    });
}
