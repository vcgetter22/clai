import type { Command } from 'commander';
import { contextTokens, dayKey, weekdayIndex, addDays } from '@claii/core';
import { breakdown, computeSummary, toFilter, type QueryOptions } from '@claii/server';
import { openContext, type GlobalOptions } from '../context.js';
import { accent, bar, bold, box, count, dim, durationHuman, formatTokens, formatUsd, heading, kvLines, pct, printJson, providerOf, providerPaint, reveal, section, stripAnsi, table } from '../ui.js';

const VIEWS = ['overview', 'daily', 'weekly', 'monthly', 'models', 'projects', 'sessions', 'providers', 'sources', 'people', 'surfaces', 'billing'] as const;
type View = (typeof VIEWS)[number];

interface ReportOpts {
  since: string;
  until?: string;
  provider?: string;
  source?: string;
  project?: string;
  actor?: string;
  billing?: string;
  model?: string;
  limit: string;
}

export function registerReport(program: Command): void {
  program
    .command('report [view]')
    .description(`Usage and cost report. Views: ${VIEWS.join(', ')}`)
    .option('--since <expr>', 'range start: 7d, 30d, 90d, week, month, all, YYYY-MM-DD', '30d')
    .option('--until <date>', 'range end (exclusive)')
    .option('--provider <id>', 'filter by provider (comma-separated)')
    .option('--source <id>', 'filter by source (comma-separated)')
    .option('--project <name>', 'filter by project label')
    .option('--actor <key>', 'filter by actor key (email / user id)')
    .option('--billing <mode>', 'api | subscription | unknown')
    .option('--model <key>', 'filter by model')
    .option('--limit <n>', 'rows to show', '15')
    .action(async (view: string | undefined, opts: ReportOpts, cmd: Command) => {
      const g = cmd.optsWithGlobals() as GlobalOptions;
      const v = (view ?? 'overview') as View;
      if (!VIEWS.includes(v)) throw new Error(`Unknown view "${view}". Use one of: ${VIEWS.join(', ')}`);
      const ctx = openContext(g);
      try {
        const q: QueryOptions = { since: opts.since, until: opts.until, provider: opts.provider, source: opts.source, project: opts.project, actor: opts.actor, billing: opts.billing, model: opts.model };
        const limit = Number(opts.limit) || 15;
        if (v === 'overview') return await overview(ctx, q);
        if (v === 'sessions') return await sessions(ctx, q, limit);
        if (v === 'weekly') return await weekly(ctx, q);
        const dim = v === 'daily' ? 'day' : v === 'monthly' ? 'month' : v === 'models' ? 'model' : v === 'projects' ? 'project' : v === 'providers' ? 'provider' : v === 'sources' ? 'source' : v === 'people' ? 'actor' : v === 'surfaces' ? 'surface' : 'billing';
        return await dimension(ctx, dim, q, v === 'daily' || v === 'monthly' ? 400 : limit, v);
      } finally {
        await ctx.close();
      }
    });
}

async function overview(ctx: ReturnType<typeof openContext>, q: QueryOptions): Promise<void> {
  const s = await computeSummary(ctx.store, ctx.catalog, q);
  if (ctx.json) return printJson(s);
  const u = s.totals.usage;
  const range = `${q.since ?? '30d'}${q.until ? ` to ${q.until}` : ''}`;
  const basis = s.totals.billedUsd !== null ? 'billed' : 'API-equivalent';
  console.log(heading('clai report', `${range} · ${s.range.timeZone}`));
  await reveal(
    (t) =>
      box(
        kvLines([
          ['spend', `${bold(formatUsd(s.totals.usd * t))}  ${dim(basis)}`],
          ['requests', `${count(Math.round(u.requests * t))}  ${dim(`${count(s.totals.events)} events`)}`],
          ['tokens', `${formatTokens(contextTokens(u) * t)} in  ${dim(`${formatTokens(u.cacheRead)} cached, ${formatTokens(u.cacheWrite5m + u.cacheWrite1h)} cache writes`)}  ${formatTokens(u.output * t)} out`],
          ['today', formatUsd(s.today.usd * t)],
          ['this month', `${formatUsd(s.thisMonth.usd * t)}  ${dim(`projected ${formatUsd(s.forecast.projectedUsd)}, ${s.forecast.confidence} confidence`)}`],
          ['last month', formatUsd(s.lastMonth.usd * t) + (s.forecast.deltaVsLastMonth !== null ? dim(`  ${s.forecast.deltaVsLastMonth >= 0 ? '+' : ''}${pct(s.forecast.deltaVsLastMonth)} projected`) : '')],
        ]),
        { title: range },
      ),
    { enabled: ctx.motion },
  );
  type Rows = { key: string; usd: number; share: number; events: number; usage: { requests: number } }[];
  const blocks: [string, Rows, boolean][] = [
    ['By provider', s.byProvider, true],
    ['By model', s.byModel, true],
    ['By project', s.byProject, false],
  ];
  if (s.bySource.length > 1) blocks.push(['By source', s.bySource, true]);
  const present = blocks.filter(([, rows]) => rows.length > 0);
  if (present.length) {
    await reveal(
      (t) =>
        present
          .map(([title, rows, byProvider]) => {
            const paintFor = (key: string) => (byProvider ? providerPaint(providerOf(key)) : accent);
            return '\n' + section(title) + '\n' + table(['', 'share', 'spend', 'requests', ''], rows.slice(0, 8).map((r) => [byProvider ? paintFor(r.key)(r.key) : r.key, pct(r.share), formatUsd(r.usd), count(r.usage.requests || r.events), bar(r.share * t, 16, paintFor(r.key))]), ['l', 'r', 'r', 'r', 'l']);
          })
          .join('\n'),
      { enabled: ctx.motion },
    );
  }
  if (s.subscriptions.length) {
    console.log('');
    console.log(section('Subscription value'));
    for (const x of s.subscriptions) {
      const price = x.subscription.priceMonthly * (x.subscription.seats ?? 1);
      console.log(`  ${bold(x.subscription.label ?? `${x.subscription.provider} ${x.subscription.plan}`)}: ${formatUsd(x.mtdUsd)} API-equivalent this month, projected ${formatUsd(x.projectedUsd)} vs ${formatUsd(price)} price → ${bold(`${x.multiple.toFixed(1)}x`)}`);
    }
  }
  if (s.budgets.length) {
    console.log('');
    console.log(section('Budgets'));
    for (const b of s.budgets) console.log(`  ${b.budget.name}: ${formatUsd(b.mtdUsd)} of ${formatUsd(b.budget.amountUsd)} (${pct(b.usedPct)} used, ${pct(b.projectedPct)} projected) ${bar(b.usedPct, 16)}`);
  }
  console.log('');
  console.log(dim('  Views: clai report daily | weekly | monthly | models | projects | sessions | people'));
}

async function dimension(ctx: ReturnType<typeof openContext>, dim: string, q: QueryOptions, limit: number, view: string): Promise<void> {
  const rows = await breakdown(ctx.store, dim, q, limit);
  if (ctx.json) return printJson({ dim, rows });
  console.log(heading(`clai report ${view}`, stripAnsi(dimRange(q)).trim()));
  if (rows.length === 0) return console.log(dimText('  no data in range'));
  const byProvider = dim === 'provider' || dim === 'model' || dim === 'source';
  const paintFor = (key: string) => (byProvider ? providerPaint(providerOf(key)) : accent);
  await reveal(
    (t) =>
      table(
        [dim, 'spend', 'share', 'requests', 'input', 'cache read', 'output', ''],
        rows.map((r) => [byProvider ? paintFor(r.key)(r.key) : r.key, formatUsd(r.usd), pct(r.share), count(r.usage.requests || r.events), formatTokens(r.usage.input + r.usage.cacheWrite5m + r.usage.cacheWrite1h), formatTokens(r.usage.cacheRead), formatTokens(r.usage.output), bar(r.share * t, 12, paintFor(r.key))]),
        ['l', 'r', 'r', 'r', 'r', 'r', 'r', 'l'],
      ),
    { enabled: ctx.motion },
  );
  const total = rows.reduce((a, r) => a + r.usd, 0);
  console.log(dimText(`  total ${formatUsd(total)} across ${rows.length} ${dim}${rows.length === 1 ? '' : 's'}`));
}

async function weekly(ctx: ReturnType<typeof openContext>, q: QueryOptions): Promise<void> {
  const days = await breakdown(ctx.store, 'day', q, 1000);
  const weeks = new Map<string, { usd: number; requests: number; events: number }>();
  for (const d of days) {
    const wd = weekdayIndex(`${d.key}T12:00:00Z`, 'UTC');
    const monday = addDays(d.key, -((wd + 6) % 7));
    const w = weeks.get(monday) ?? { usd: 0, requests: 0, events: 0 };
    w.usd += d.usd;
    w.requests += d.usage.requests;
    w.events += d.events;
    weeks.set(monday, w);
  }
  const rows = [...weeks.entries()].sort(([a], [b]) => a.localeCompare(b));
  if (ctx.json) return printJson({ weeks: rows.map(([week, w]) => ({ week, ...w })) });
  console.log(heading('clai report weekly', stripAnsi(dimRange(q)).trim()));
  const max = Math.max(...rows.map(([, w]) => w.usd), 0.01);
  await reveal((t) => table(['week of', 'spend', 'requests', ''], rows.map(([week, w]) => [week, formatUsd(w.usd), count(w.requests || w.events), bar((w.usd / max) * t, 20)]), ['l', 'r', 'r', 'l']), { enabled: ctx.motion });
}

async function sessions(ctx: ReturnType<typeof openContext>, q: QueryOptions, limit: number): Promise<void> {
  const filter = toFilter(q, ctx.store.timeZone);
  const rows = await ctx.store.sessions(filter, limit);
  if (ctx.json) return printJson({ sessions: rows });
  console.log(heading('clai report sessions', stripAnsi(dimRange(q)).trim()));
  if (rows.length === 0) return console.log(dimText('  no sessions in range'));
  console.log(
    table(
      ['started', 'project', 'source', 'models', 'requests', 'max ctx', 'duration', 'spend'],
      rows.map((s) => [
        dayKey(s.started, ctx.store.timeZone) + ' ' + new Date(s.started).toISOString().slice(11, 16),
        (s.project ?? '-').slice(0, 24),
        s.source,
        s.models.map((m) => m.replace(/^claude-/, '')).join(',').slice(0, 28),
        String(s.usage.requests || s.events),
        formatTokens(s.maxContext),
        durationHuman(Date.parse(s.ended) - Date.parse(s.started)),
        formatUsd(s.usd),
      ]),
      ['l', 'l', 'l', 'l', 'r', 'r', 'r', 'r'],
    ),
  );
}

function dimRange(q: QueryOptions): string {
  return dimText(`${q.since ?? '30d'}${q.until ? ` to ${q.until}` : ''}${q.provider ? ` · ${q.provider}` : ''}${q.project ? ` · ${q.project}` : ''}`);
}

function dimText(s: string): string {
  return dim(s);
}
