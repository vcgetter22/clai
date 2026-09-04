import type { Command } from 'commander';
import { contextTokens, dayKey, weekdayIndex, addDays } from '@claii/core';
import { breakdown, computeSummary, toFilter, type QueryOptions } from '@claii/server';
import { openContext, type GlobalOptions } from '../context.js';
import { bar, bold, dim, durationHuman, formatTokens, formatUsd, heading, kv, pct, printJson, table } from '../ui.js';

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
    .action((view: string | undefined, opts: ReportOpts, cmd: Command) => {
      const g = cmd.optsWithGlobals() as GlobalOptions;
      const v = (view ?? 'overview') as View;
      if (!VIEWS.includes(v)) throw new Error(`Unknown view "${view}". Use one of: ${VIEWS.join(', ')}`);
      const ctx = openContext(g);
      try {
        const q: QueryOptions = { since: opts.since, until: opts.until, provider: opts.provider, source: opts.source, project: opts.project, actor: opts.actor, billing: opts.billing, model: opts.model };
        const limit = Number(opts.limit) || 15;
        if (v === 'overview') return overview(ctx, q);
        if (v === 'sessions') return sessions(ctx, q, limit);
        if (v === 'weekly') return weekly(ctx, q);
        const dim = v === 'daily' ? 'day' : v === 'monthly' ? 'month' : v === 'models' ? 'model' : v === 'projects' ? 'project' : v === 'providers' ? 'provider' : v === 'sources' ? 'source' : v === 'people' ? 'actor' : v === 'surfaces' ? 'surface' : 'billing';
        return dimension(ctx, dim, q, v === 'daily' || v === 'monthly' ? 400 : limit, v);
      } finally {
        ctx.close();
      }
    });
}

function overview(ctx: ReturnType<typeof openContext>, q: QueryOptions): void {
  const s = computeSummary(ctx.store, ctx.catalog, q);
  if (ctx.json) return printJson(s);
  const u = s.totals.usage;
  console.log(heading(`clai report`) + dim(`  ${q.since ?? '30d'}${q.until ? ` to ${q.until}` : ''} · ${s.range.timeZone}`));
  console.log(
    kv([
      ['Spend', `${bold(formatUsd(s.totals.usd))}${s.totals.billedUsd !== null ? dim(' (billed)') : dim(' (API-equivalent)')}`],
      ['Requests', `${u.requests.toLocaleString()} across ${s.totals.events.toLocaleString()} events`],
      ['Tokens', `${formatTokens(contextTokens(u))} in (${formatTokens(u.cacheRead)} cached, ${formatTokens(u.cacheWrite5m + u.cacheWrite1h)} cache writes), ${formatTokens(u.output)} out`],
      ['Today', formatUsd(s.today.usd)],
      ['This month', `${formatUsd(s.thisMonth.usd)} so far, projected ${bold(formatUsd(s.forecast.projectedUsd))} ${dim(`(${s.forecast.confidence} confidence)`)}`],
      ['Last month', formatUsd(s.lastMonth.usd) + (s.forecast.deltaVsLastMonth !== null ? dim(`  ${s.forecast.deltaVsLastMonth >= 0 ? '+' : ''}${pct(s.forecast.deltaVsLastMonth)} projected`) : '')],
    ]),
  );
  const show = (title: string, rows: { key: string; usd: number; share: number; events: number; usage: { requests: number } }[]) => {
    if (rows.length === 0) return;
    console.log('');
    console.log(heading(title));
    console.log(table(['', 'share', 'spend', 'requests', ''], rows.slice(0, 8).map((r) => [r.key, pct(r.share), formatUsd(r.usd), String(r.usage.requests || r.events), bar(r.share, 16)]), ['l', 'r', 'r', 'r', 'l']));
  };
  show('By provider', s.byProvider);
  show('By model', s.byModel);
  show('By project', s.byProject);
  if (s.bySource.length > 1) show('By source', s.bySource);
  if (s.subscriptions.length) {
    console.log('');
    console.log(heading('Subscription value'));
    for (const x of s.subscriptions) {
      const price = x.subscription.priceMonthly * (x.subscription.seats ?? 1);
      console.log(`  ${bold(x.subscription.label ?? `${x.subscription.provider} ${x.subscription.plan}`)}: ${formatUsd(x.mtdUsd)} API-equivalent this month, projected ${formatUsd(x.projectedUsd)} vs ${formatUsd(price)} price → ${bold(`${x.multiple.toFixed(1)}x`)}`);
    }
  }
  if (s.budgets.length) {
    console.log('');
    console.log(heading('Budgets'));
    for (const b of s.budgets) console.log(`  ${b.budget.name}: ${formatUsd(b.mtdUsd)} of ${formatUsd(b.budget.amountUsd)} (${pct(b.usedPct)} used, ${pct(b.projectedPct)} projected) ${bar(b.usedPct, 16)}`);
  }
  console.log('');
  console.log(dim('  Views: clai report daily | weekly | monthly | models | projects | sessions | people'));
}

function dimension(ctx: ReturnType<typeof openContext>, dim: string, q: QueryOptions, limit: number, view: string): void {
  const rows = breakdown(ctx.store, dim, q, limit);
  if (ctx.json) return printJson({ dim, rows });
  console.log(heading(`clai report ${view}`) + ` ${dimRange(q)}`);
  if (rows.length === 0) return console.log(dimText('  no data in range'));
  console.log(
    table(
      [dim, 'spend', 'share', 'requests', 'input', 'cache read', 'output', ''],
      rows.map((r) => [r.key, formatUsd(r.usd), pct(r.share), String(r.usage.requests || r.events), formatTokens(r.usage.input + r.usage.cacheWrite5m + r.usage.cacheWrite1h), formatTokens(r.usage.cacheRead), formatTokens(r.usage.output), bar(r.share, 12)]),
      ['l', 'r', 'r', 'r', 'r', 'r', 'r', 'l'],
    ),
  );
  const total = rows.reduce((a, r) => a + r.usd, 0);
  console.log(dimText(`  total ${formatUsd(total)} across ${rows.length} ${dim}${rows.length === 1 ? '' : 's'}`));
}

function weekly(ctx: ReturnType<typeof openContext>, q: QueryOptions): void {
  const days = breakdown(ctx.store, 'day', q, 1000);
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
  console.log(heading('clai report weekly') + ` ${dimRange(q)}`);
  const max = Math.max(...rows.map(([, w]) => w.usd), 0.01);
  console.log(table(['week of', 'spend', 'requests', ''], rows.map(([week, w]) => [week, formatUsd(w.usd), String(w.requests || w.events), bar(w.usd / max, 20)]), ['l', 'r', 'r', 'l']));
}

function sessions(ctx: ReturnType<typeof openContext>, q: QueryOptions, limit: number): void {
  const filter = toFilter(q, ctx.store.timeZone);
  const rows = ctx.store.sessions(filter, limit);
  if (ctx.json) return printJson({ sessions: rows });
  console.log(heading('clai report sessions') + ` ${dimRange(q)}`);
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
