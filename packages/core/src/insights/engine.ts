import { dailyTotals, groupRows, rowCost, sumRows, type AggRow } from '../aggregate.js';
import { computeCost, round2 } from '../pricing/cost.js';
import { resolveModel } from '../pricing/resolve.js';
import type { ModelPrice } from '../pricing/types.js';
import { addDays, dayKey, daysInMonth, formatTokens, formatUsd, pct, weekdayIndex } from '../time.js';
import { addUsage, contextTokens, emptyUsage, type ProviderId } from '../types.js';
import type { Budget, DeclaredSubscription, Forecast, Insight, InsightContext } from './types.js';

const MTOK = 1_000_000;

function todayKey(ctx: InsightContext): string {
  return dayKey(ctx.now.toISOString(), ctx.timeZone);
}

function inMonth(rows: AggRow[], month: string): AggRow[] {
  return rows.filter((r) => r.day.startsWith(month));
}

function previousMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y!, m! - 2, 1));
  return d.toISOString().slice(0, 7);
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

// ------------------------------------------------------------------ Forecast

export function forecast(rows: AggRow[], ctx: InsightContext): Forecast {
  const today = todayKey(ctx);
  const month = today.slice(0, 7);
  const dim = daysInMonth(month);
  const dayOfMonth = Number(today.slice(8, 10));
  const monthRows = inMonth(rows, month);
  const mtdUsd = sumRows(monthRows).usd;
  const lastMonth = previousMonth(month);
  const lastRows = inMonth(rows, lastMonth);
  const lastMonthUsd = lastRows.length ? sumRows(lastRows).usd : null;

  // Baseline: last 28 complete days before today.
  const start = addDays(today, -28);
  const hist = dailyTotals(
    rows.filter((r) => r.day >= start && r.day < today),
    start,
    addDays(today, -1),
  );
  const daysWithData = hist.filter((d) => d.usd > 0).length;
  const overallAvg = hist.length ? hist.reduce((a, b) => a + b.usd, 0) / hist.length : 0;

  const byWeekday = new Map<number, number[]>();
  for (const d of hist) {
    const wd = weekdayIndex(`${d.day}T12:00:00Z`, 'UTC');
    const arr = byWeekday.get(wd) ?? [];
    arr.push(d.usd);
    byWeekday.set(wd, arr);
  }
  const rate = (wd: number) => {
    const arr = byWeekday.get(wd);
    if (!arr || arr.length < 2) return overallAvg;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  };

  let projected = mtdUsd;
  let method: Forecast['method'] = 'weekday-weighted';
  if (daysWithData < 3) {
    method = 'insufficient-data';
    const elapsed = Math.max(dayOfMonth, 1);
    projected = elapsed > 0 ? (mtdUsd / elapsed) * dim : mtdUsd;
  } else {
    for (let d = dayOfMonth + 1; d <= dim; d++) {
      const key = `${month}-${String(d).padStart(2, '0')}`;
      const wd = weekdayIndex(`${key}T12:00:00Z`, 'UTC');
      projected += rate(wd);
    }
    if (daysWithData < 10) method = 'run-rate';
  }
  const confidence: Forecast['confidence'] = daysWithData >= 14 ? 'high' : daysWithData >= 5 ? 'medium' : 'low';
  return {
    month,
    daysElapsed: dayOfMonth,
    daysInMonth: dim,
    mtdUsd: round2(mtdUsd),
    projectedUsd: round2(projected),
    avgDailyUsd: round2(overallAvg),
    lastMonthUsd: lastMonthUsd === null ? null : round2(lastMonthUsd),
    deltaVsLastMonth: lastMonthUsd && lastMonthUsd > 0 ? round2((projected - lastMonthUsd) / lastMonthUsd) : null,
    method,
    confidence,
  };
}

export function forecastInsights(rows: AggRow[], ctx: InsightContext): Insight[] {
  const f = forecast(rows, ctx);
  if (f.mtdUsd === 0 && f.projectedUsd === 0) return [];
  const delta = f.deltaVsLastMonth;
  const trend = delta === null ? '' : delta > 0.15 ? ` That is ${pct(delta)} above last month.` : delta < -0.15 ? ` That is ${pct(-delta)} below last month.` : ' Roughly flat versus last month.';
  return [
    {
      id: `forecast:${f.month}`,
      kind: 'forecast',
      severity: delta !== null && delta > 0.5 ? 'warning' : 'info',
      title: `On track for ${formatUsd(f.projectedUsd)} this month`,
      detail: `${formatUsd(f.mtdUsd)} so far across ${f.daysElapsed} of ${f.daysInMonth} days; ${formatUsd(f.avgDailyUsd)} per day on average over the last four weeks.${trend}`,
      evidence: { ...f },
    },
  ];
}

// -------------------------------------------------------- Subscription value

function subscriptionRows(rows: AggRow[], sub: DeclaredSubscription): AggRow[] {
  return rows.filter((r) => {
    if (r.provider !== sub.provider) return false;
    if (sub.appliesTo?.sources && !sub.appliesTo.sources.includes(r.source)) return false;
    if (sub.appliesTo?.actorKeys && !sub.appliesTo.actorKeys.includes(r.actorKey)) return false;
    if (!sub.appliesTo?.sources && r.billing === 'api') return false;
    return true;
  });
}

export function subscriptionValueInsights(rows: AggRow[], ctx: InsightContext): Insight[] {
  const out: Insight[] = [];
  const today = todayKey(ctx);
  const month = today.slice(0, 7);
  for (const sub of ctx.subscriptions) {
    const price = sub.priceMonthly * (sub.seats ?? 1);
    if (price <= 0) continue;
    const mine = subscriptionRows(rows, sub);
    const mtd = sumRows(inMonth(mine, month));
    const last = sumRows(inMonth(mine, previousMonth(month)));
    // Same weekday-weighted projection as the forecast card, restricted to this plan's usage.
    const projected = forecast(mine, ctx).projectedUsd;
    const basis = last.computedUsd > 0 ? last.computedUsd : projected;
    const multiple = basis / price;
    const label = sub.label ?? `${sub.provider} ${sub.plan}`;
    let severity: Insight['severity'] = 'info';
    let title: string;
    let action: string | undefined;
    let impact: number | undefined;
    if (mtd.events === 0 && last.events === 0) {
      severity = 'warning';
      title = `${label}: no usage recorded`;
      action = 'If this plan is unused, cancel it or reassign the seat.';
      impact = price;
    } else if (multiple < 0.5) {
      severity = 'opportunity';
      title = `${label} returns ${multiple.toFixed(1)}x its price in API-equivalent usage`;
      action = `Usage worth about ${formatUsd(basis)}/month costs ${formatUsd(price)}/month. A cheaper plan or pay-as-you-go API would likely save ${formatUsd(price - basis)}/month.`;
      impact = round2(price - basis);
    } else if (multiple >= 3) {
      title = `${label} delivers ${multiple.toFixed(1)}x its price`;
      action = `You would pay about ${formatUsd(basis)}/month at API list prices for the same work. The plan saves you ${formatUsd(basis - price)}/month.`;
    } else {
      title = `${label} delivers ${multiple.toFixed(1)}x its price`;
      action = 'Fair value. Keep the plan; watch the weekly limit if you hit it often.';
    }
    out.push({
      id: `subscription:${sub.id}`,
      kind: 'subscription_value',
      severity,
      title,
      detail: `Month to date: ${formatUsd(mtd.computedUsd)} of API-equivalent usage (${formatTokens(mtd.usage.input + mtd.usage.cacheRead + mtd.usage.cacheWrite5m + mtd.usage.cacheWrite1h)} input, ${formatTokens(mtd.usage.output)} output tokens). Projected ${formatUsd(projected)} for the month${last.computedUsd > 0 ? `; last month ${formatUsd(last.computedUsd)}` : ''}.`,
      action,
      impactUsdPerMonth: impact,
      evidence: { subscription: sub, priceMonthly: price, mtdUsd: round2(mtd.computedUsd), projectedUsd: round2(projected), lastMonthUsd: round2(last.computedUsd), multiple: round2(multiple) },
    });
  }
  return out;
}

// ------------------------------------------------------------------ Budgets

function budgetRows(rows: AggRow[], b: Budget): AggRow[] {
  const s = b.scope;
  if (!s) return rows;
  return rows.filter(
    (r) => (!s.provider || r.provider === s.provider) && (!s.source || r.source === s.source) && (!s.project || r.project === s.project) && (!s.actorKey || r.actorKey === s.actorKey),
  );
}

export function budgetInsights(rows: AggRow[], ctx: InsightContext): Insight[] {
  const out: Insight[] = [];
  for (const b of ctx.budgets) {
    const scoped = budgetRows(rows, b);
    const f = forecast(scoped, ctx);
    const usedPct = b.amountUsd > 0 ? f.mtdUsd / b.amountUsd : 0;
    const projPct = b.amountUsd > 0 ? f.projectedUsd / b.amountUsd : 0;
    let severity: Insight['severity'] = 'info';
    let title = `Budget "${b.name}": ${pct(usedPct)} used`;
    let action: string | undefined;
    if (usedPct >= 1) {
      severity = 'critical';
      title = `Budget "${b.name}" exceeded (${pct(usedPct)})`;
      action = 'Spending has already passed the budget this month.';
    } else if (projPct > 1) {
      severity = 'warning';
      const remaining = b.amountUsd - f.mtdUsd;
      const daysLeft = f.avgDailyUsd > 0 ? Math.max(0, Math.floor(remaining / f.avgDailyUsd)) : null;
      title = `Budget "${b.name}" projected to overrun by ${formatUsd(f.projectedUsd - b.amountUsd)}`;
      action = daysLeft !== null ? `At the current pace the budget runs out around ${addDays(todayKey(ctx), daysLeft)}.` : 'Reduce usage or raise the budget.';
    }
    out.push({
      id: `budget:${b.id}`,
      kind: 'budget',
      severity,
      title,
      detail: `${formatUsd(f.mtdUsd)} of ${formatUsd(b.amountUsd)} used; projected ${formatUsd(f.projectedUsd)} (${pct(projPct)}).`,
      action,
      impactUsdPerMonth: projPct > 1 ? round2(f.projectedUsd - b.amountUsd) : undefined,
      evidence: { budget: b, mtdUsd: f.mtdUsd, projectedUsd: f.projectedUsd, usedPct: round2(usedPct), projectedPct: round2(projPct) },
    });
  }
  return out;
}

// ---------------------------------------------------------------- Anomalies

export function anomalyInsights(rows: AggRow[], ctx: InsightContext, opts: { lookbackDays?: number; minUsd?: number } = {}): Insight[] {
  const lookback = opts.lookbackDays ?? 30;
  const minUsd = opts.minUsd ?? 2;
  const today = todayKey(ctx);
  const start = addDays(today, -lookback);
  const series = dailyTotals(
    rows.filter((r) => r.day >= start && r.day <= today),
    start,
    today,
  );
  const out: Insight[] = [];
  for (let i = 7; i < series.length; i++) {
    const day = series[i]!;
    if (day.usd < minUsd) continue;
    const window = series.slice(Math.max(0, i - 14), i).map((d) => d.usd);
    const med = median(window);
    const mad = median(window.map((x) => Math.abs(x - med))) * 1.4826;
    const threshold = med + Math.max(3 * mad, 0.5 * med, minUsd);
    if (day.usd <= threshold || med === 0) continue;
    const dayRows = rows.filter((r) => r.day === day.day);
    const topModel = groupRows(dayRows, (r) => r.model)[0];
    const topProject = groupRows(dayRows, (r) => r.project)[0];
    const ratio = med > 0 ? day.usd / med : Infinity;
    out.push({
      id: `anomaly:${day.day}`,
      kind: 'anomaly',
      severity: day.day === today ? 'warning' : 'info',
      title: `${day.day}: ${formatUsd(day.usd)} spent, ${ratio === Infinity ? 'far' : `${ratio.toFixed(1)}x`} above the typical ${formatUsd(med)}`,
      detail: `${topModel ? `${topModel.key} accounted for ${formatUsd(topModel.usd)}` : ''}${topProject ? `, mostly in ${topProject.key}` : ''}.`,
      evidence: { day: day.day, usd: round2(day.usd), medianUsd: round2(med), madUsd: round2(mad), topModel: topModel?.key, topProject: topProject?.key },
    });
  }
  return out.sort((a, b) => String(b.evidence['day']).localeCompare(String(a.evidence['day']))).slice(0, 5);
}

// ---------------------------------------------------------------- Model mix

const MID_TIER_ALTERNATIVE: Partial<Record<ProviderId, string>> = {
  anthropic: 'claude-sonnet-5',
  openai: 'gpt-5-mini',
  google: 'gemini-2.5-flash',
  xai: 'grok-4-fast',
};

export function modelMixInsights(rows: AggRow[], ctx: InsightContext, opts: { shiftShare?: number } = {}): Insight[] {
  const shift = opts.shiftShare ?? 0.3;
  const total = sumRows(rows).usd;
  if (total < 10) return [];
  const out: Insight[] = [];
  const byProvider = groupRows(rows, (r) => r.provider);
  for (const p of byProvider) {
    const provider = p.key as ProviderId;
    const altId = MID_TIER_ALTERNATIVE[provider];
    if (!altId) continue;
    const alt = resolveModel(ctx.catalog, altId, provider).price;
    if (!alt) continue;
    const provRows = rows.filter((r) => r.provider === provider);
    const frontierRows = provRows.filter((r) => resolveModel(ctx.catalog, r.model, provider).price?.tier === 'frontier');
    if (frontierRows.length === 0) continue;
    const frontierUsd = sumRows(frontierRows).usd;
    const share = frontierUsd / p.usd;
    if (share < 0.6 || frontierUsd < 10) continue;
    // What-if: shift `shift` of frontier usage (by tokens) to the mid-tier model.
    let altUsd = 0;
    const byModel = groupRows(frontierRows, (r) => r.model);
    for (const g of byModel) {
      altUsd += computeCost(ctx.catalog, alt, g.usage).total;
    }
    const savings = round2(shift * (frontierUsd - altUsd));
    if (savings < 5) continue;
    const frontierNames = byModel.map((g) => g.key).join(', ');
    out.push({
      id: `model_mix:${provider}`,
      kind: 'model_mix',
      severity: 'opportunity',
      title: `${pct(share)} of ${provider} spend runs on frontier models (${frontierNames})`,
      detail: `Frontier usage cost ${formatUsd(frontierUsd)} in this period. The same tokens on ${alt.displayName} would cost ${formatUsd(altUsd)}.`,
      action: `Routing ${pct(shift)} of frontier work (simple edits, summaries, boilerplate) to ${alt.displayName} would save about ${formatUsd(savings)} per period.`,
      impactUsdPerMonth: savings,
      evidence: { provider, frontierShare: round2(share), frontierUsd: round2(frontierUsd), altModel: alt.id, altUsd: round2(altUsd), shiftShare: shift },
    });
  }
  return out;
}

// --------------------------------------------------------- Cache efficiency

export function cacheEfficiencyInsights(rows: AggRow[], ctx: InsightContext): Insight[] {
  const out: Insight[] = [];
  const groups = groupRows(
    rows.filter((r) => r.billing !== 'subscription' && (r.provider === 'anthropic' || r.provider === 'openai' || r.provider === 'google')),
    (r) => `${r.provider}${r.model}`,
  );
  for (const g of groups) {
    const [provider, model] = g.key.split('') as [ProviderId, string];
    const ctxTokens = contextTokens(g.usage);
    if (ctxTokens < 2 * MTOK) continue;
    const hit = g.usage.cacheRead / ctxTokens;
    if (hit >= 0.3) continue;
    const price = resolveModel(ctx.catalog, model, provider).price;
    if (!price) continue;
    const readPrice = price.cacheRead ?? price.input * 0.1;
    // Conservative: assume half of uncached input is a repeated prefix that could be cached.
    const cacheable = g.usage.input * 0.5;
    const savings = round2((cacheable / MTOK) * (price.input - readPrice) - (cacheable / MTOK) * (price.input * 0.25) * 0.1);
    if (savings < 2) continue;
    out.push({
      id: `cache:${provider}:${model}`,
      kind: 'cache_efficiency',
      severity: 'opportunity',
      title: `${price.displayName} API traffic has a ${pct(hit)} cache hit rate`,
      detail: `${formatTokens(g.usage.input)} uncached input tokens vs ${formatTokens(g.usage.cacheRead)} cache reads. Repeated system prompts, tool definitions and document context are prime caching candidates.`,
      action: `Enable prompt caching on the stable prefix. If half the input is cacheable, that saves about ${formatUsd(savings)} per period.`,
      impactUsdPerMonth: savings,
      evidence: { provider, model, hitRate: round2(hit), inputTokens: g.usage.input, cacheReadTokens: g.usage.cacheRead, estimatedSavingsUsd: savings },
    });
  }
  return out;
}

// -------------------------------------------------------------- Context size

export function contextSizeInsights(rows: AggRow[], ctx: InsightContext): Insight[] {
  const agentRows = rows.filter((r) => r.surface === 'cli-agent' || r.surface === 'ide');
  const total = sumRows(agentRows);
  if (total.events < 20) return [];
  const ctxTokens = contextTokens(total.usage);
  const avg = ctxTokens / Math.max(total.usage.requests, 1);
  const cacheShare = total.usd > 0 ? cacheCostShare(agentRows, ctx) : 0;
  const out: Insight[] = [];
  if (avg > 120_000) {
    out.push({
      id: 'context_size',
      kind: 'context_size',
      severity: 'opportunity',
      title: `Average agent request carries ${formatTokens(avg)} tokens of context`,
      detail: `Cache reads and writes make up ${pct(cacheShare)} of agent cost. Long sessions re-send the whole conversation on every turn, so cost per request grows with session length.`,
      action: 'Start fresh sessions for new tasks and compact long ones; each 100k tokens of context trimmed saves roughly ' + formatUsd(perRequestSavings(agentRows, ctx)) + ' per request.',
      evidence: { avgContextTokens: Math.round(avg), cacheCostShare: round2(cacheShare), requests: total.usage.requests },
    });
  }
  const longCtx = agentRows.reduce((a, r) => a + r.longContextEvents, 0);
  if (longCtx > 0) {
    const premiumRows = agentRows.filter((r) => r.longContextEvents > 0 && resolveModel(ctx.catalog, r.model, r.provider).price?.longContext);
    if (premiumRows.length > 0) {
      out.push({
        id: 'long_context_premium',
        kind: 'long_context_premium',
        severity: 'warning',
        title: `${longCtx} requests exceeded 200k tokens of context on models with a long-context premium`,
        detail: 'Above 200k input tokens these models bill 2x input and 1.5x output.',
        action: 'Compact or restart sessions before they cross 200k tokens, or use a model with 1M context at standard pricing.',
        evidence: { longContextEvents: longCtx, models: [...new Set(premiumRows.map((r) => r.model))] },
      });
    }
  }
  return out;
}

function cacheCostShare(rows: AggRow[], ctx: InsightContext): number {
  let cache = 0;
  let total = 0;
  for (const r of rows) {
    const price = resolveModel(ctx.catalog, r.model, r.provider).price;
    if (!price) continue;
    const c = computeCost(ctx.catalog, price, r.usage, { detectLongContext: false });
    cache += c.cacheRead + c.cacheWrite5m + c.cacheWrite1h;
    total += c.total;
  }
  return total > 0 ? cache / total : 0;
}

function perRequestSavings(rows: AggRow[], ctx: InsightContext): number {
  // Weighted average cache-read price per 100k tokens across the rows.
  let weightedPrice = 0;
  let weight = 0;
  for (const r of rows) {
    const price = resolveModel(ctx.catalog, r.model, r.provider).price;
    if (!price) continue;
    const readPrice = price.cacheRead ?? price.input * 0.1;
    weightedPrice += readPrice * r.usage.requests;
    weight += r.usage.requests;
  }
  const avgRead = weight > 0 ? weightedPrice / weight : 0;
  return round2((100_000 / MTOK) * avgRead * 100) / 100;
}

// ------------------------------------------------------------ Concentration

export function concentrationInsights(rows: AggRow[], _ctx: InsightContext): Insight[] {
  const total = sumRows(rows).usd;
  if (total < 5) return [];
  const out: Insight[] = [];
  const byProject = groupRows(rows, (r) => r.project);
  if (byProject.length >= 3) {
    const top = byProject[0]!;
    const share = top.usd / total;
    if (share >= 0.5) {
      out.push({
        id: 'concentration:project',
        kind: 'concentration',
        severity: 'info',
        title: `${top.key} drives ${pct(share)} of spend`,
        detail: `${formatUsd(top.usd)} of ${formatUsd(total)} across ${byProject.length} projects.`,
        evidence: { project: top.key, share: round2(share), usd: round2(top.usd), projects: byProject.length },
      });
    }
  }
  const byActor = groupRows(rows, (r) => r.actorKey);
  if (byActor.length >= 3) {
    const top3 = byActor.slice(0, 3).reduce((a, b) => a + b.usd, 0);
    const share = top3 / total;
    if (share >= 0.6) {
      out.push({
        id: 'concentration:actor',
        kind: 'concentration',
        severity: 'info',
        title: `Top 3 people account for ${pct(share)} of spend`,
        detail: byActor
          .slice(0, 3)
          .map((a) => `${a.key}: ${formatUsd(a.usd)}`)
          .join(', '),
        evidence: { share: round2(share), top: byActor.slice(0, 3).map((a) => ({ actorKey: a.key, usd: round2(a.usd) })) },
      });
    }
  }
  return out;
}

// ------------------------------------------------------- Expensive sessions

export function expensiveSessionInsights(rows: AggRow[], _ctx: InsightContext, opts: { minUsd?: number; top?: number } = {}): Insight[] {
  const minUsd = opts.minUsd ?? 5;
  const sessions = groupRows(
    rows.filter((r) => r.sessionId),
    (r) => r.sessionId,
  );
  if (sessions.length < 5) return [];
  const costs = sessions.map((s) => s.usd).sort((a, b) => a - b);
  const p90 = costs[Math.floor(costs.length * 0.9)] ?? 0;
  const threshold = Math.max(minUsd, p90);
  const out: Insight[] = [];
  for (const s of sessions.slice(0, opts.top ?? 3)) {
    if (s.usd < threshold) continue;
    const srows = rows.filter((r) => r.sessionId === s.key);
    const project = srows[0]?.project ?? 'unknown project';
    const days = [...new Set(srows.map((r) => r.day))].sort();
    out.push({
      id: `session:${s.key}`,
      kind: 'expensive_session',
      severity: 'info',
      title: `Session in ${project} cost ${formatUsd(s.usd)} (${formatTokens(contextTokens(s.usage))} context tokens over ${s.usage.requests} requests)`,
      detail: `${days[0]}${days.length > 1 ? ` to ${days[days.length - 1]}` : ''}; the median session costs ${formatUsd(median(costs))}.`,
      evidence: { sessionId: s.key, usd: round2(s.usd), requests: s.usage.requests, project, days, medianSessionUsd: round2(median(costs)) },
    });
  }
  return out;
}

// --------------------------------------------------------------- Idle seats

export function idleSeatInsights(rows: AggRow[], ctx: InsightContext, opts: { idleDays?: number } = {}): Insight[] {
  const idleDays = opts.idleDays ?? 30;
  if (ctx.seats.length === 0) return [];
  const since = addDays(todayKey(ctx), -idleDays);
  const lastSeen = new Map<string, string>();
  for (const r of rows) {
    const prev = lastSeen.get(r.actorKey);
    if (!prev || r.day > prev) lastSeen.set(r.actorKey, r.day);
  }
  const idle = ctx.seats.filter((s) => (lastSeen.get(s.actorKey) ?? '') < since);
  if (idle.length === 0) return [];
  const waste = round2(idle.reduce((a, s) => a + s.priceMonthly, 0));
  return [
    {
      id: 'idle_seats',
      kind: 'idle_seat',
      severity: 'opportunity',
      title: `${idle.length} of ${ctx.seats.length} paid seats had no activity in ${idleDays} days`,
      detail: idle.map((s) => `${s.label ?? s.actorKey} (${s.provider} ${s.plan}, ${formatUsd(s.priceMonthly)}/mo${lastSeen.get(s.actorKey) ? `, last seen ${lastSeen.get(s.actorKey)}` : ', never seen'})`).join('; '),
      action: `Reassign or cancel idle seats to save ${formatUsd(waste)} per month.`,
      impactUsdPerMonth: waste,
      evidence: { idle: idle.map((s) => ({ actorKey: s.actorKey, lastSeen: lastSeen.get(s.actorKey) ?? null, priceMonthly: s.priceMonthly })), idleDays },
    },
  ];
}

// ------------------------------------------------------------ Data quality

export function unpricedModelInsights(rows: AggRow[], _ctx: InsightContext): Insight[] {
  const bad = groupRows(
    rows.filter((r) => r.unpriced),
    (r) => `${r.provider}:${r.model}`,
  );
  if (bad.length === 0) return [];
  return [
    {
      id: 'unpriced',
      kind: 'unpriced_model',
      severity: 'warning',
      title: `${bad.length} model${bad.length > 1 ? 's' : ''} could not be priced`,
      detail: bad.map((b) => `${b.key} (${b.events} events)`).join(', ') + '. Their cost is shown as $0.',
      action: 'Run `clai pricing update` to refresh the catalog, or add the model to pricing overrides.',
      evidence: { models: bad.map((b) => ({ key: b.key, events: b.events })) },
    },
  ];
}

// ------------------------------------------------------------- Batch hint

export function batchCandidateInsights(rows: AggRow[], ctx: InsightContext): Insight[] {
  // API traffic from api keys with steady daily volume and no interactive surface could use the Batch API (50% off).
  const api = rows.filter((r) => r.surface === 'api' && r.billing === 'api');
  const byKey = groupRows(api, (r) => r.actorKey);
  const out: Insight[] = [];
  for (const g of byKey) {
    if (g.usd < 50) continue;
    const days = new Set(api.filter((r) => r.actorKey === g.key).map((r) => r.day)).size;
    if (days < 7) continue;
    const price = resolveModel(ctx.catalog, api.find((r) => r.actorKey === g.key)!.model).price;
    if (!price?.batchMultiplier) continue;
    const savings = round2(g.usd * (1 - price.batchMultiplier));
    out.push({
      id: `batch:${g.key}`,
      kind: 'batch_candidate',
      severity: 'opportunity',
      title: `API key ${g.key} spent ${formatUsd(g.usd)} on steady daily traffic`,
      detail: `Active on ${days} days. If part of this workload tolerates a delay of up to 24 hours, the Batch API halves the price.`,
      action: `Moving the whole workload to batch would save up to ${formatUsd(savings)}.`,
      impactUsdPerMonth: savings,
      evidence: { actorKey: g.key, usd: round2(g.usd), activeDays: days },
    });
  }
  return out.slice(0, 3);
}

// ------------------------------------------------------------------ All

export function generateInsights(rows: AggRow[], ctx: InsightContext): Insight[] {
  const all = [
    ...budgetInsights(rows, ctx),
    ...subscriptionValueInsights(rows, ctx),
    ...forecastInsights(rows, ctx),
    ...anomalyInsights(rows, ctx),
    ...modelMixInsights(rows, ctx),
    ...cacheEfficiencyInsights(rows, ctx),
    ...contextSizeInsights(rows, ctx),
    ...batchCandidateInsights(rows, ctx),
    ...idleSeatInsights(rows, ctx),
    ...expensiveSessionInsights(rows, ctx),
    ...concentrationInsights(rows, ctx),
    ...unpricedModelInsights(rows, ctx),
  ];
  const rank: Record<Insight['severity'], number> = { critical: 0, warning: 1, opportunity: 2, info: 3 };
  return all.sort((a, b) => rank[a.severity] - rank[b.severity] || (b.impactUsdPerMonth ?? 0) - (a.impactUsdPerMonth ?? 0));
}

/** Convenience for tests and CLI: quick totals table by an arbitrary dimension. */
export function totalsBy(rows: AggRow[], dim: 'provider' | 'model' | 'source' | 'project' | 'actorKey' | 'day' | 'surface' | 'billing') {
  return groupRows(rows, (r) => (r[dim] as string | null) ?? '(none)').map((g) => ({
    key: g.key,
    usd: round2(g.usd),
    usage: g.usage,
    events: g.events,
  }));
}

export { addUsage, emptyUsage, rowCost };
export type { ModelPrice };
