import { getInsights, getSummary } from '../api';
import { ACCENT, KNOWN_PROVIDERS, modelColor, providerColor, providerLabel } from '../colors';
import type { Basis } from '../components/BasisLabel';
import { BreakdownBars } from '../components/BreakdownBars';
import { EmptyState } from '../components/EmptyState';
import { InsightCard } from '../components/InsightCard';
import { SeriesLegend, StackedBarChart } from '../components/StackedBarChart';
import { StatTile } from '../components/StatTile';
import { SubscriptionCard } from '../components/SubscriptionCard';
import { formatInt, formatPct, formatPctSigned, formatUsd } from '../format';
import { buildHash } from '../hash';
import { useAsync } from '../useAsync';
import type { CommonFilters, HealthResponse, SummaryResponse } from '../types';

interface Props {
  filters: CommonFilters;
  health: HealthResponse;
  emptyDb: boolean;
  filtersToQuery: (f: CommonFilters) => URLSearchParams;
}

const RANGE_LABEL: Record<string, string> = { '7d': '7 days', '30d': '30 days', '90d': '90 days', month: 'this month', all: 'all time' };

function monthDate(ym: string, offset = 0): Date {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1 + offset, 1);
}
function monthName(ym: string, offset = 0, style: 'long' | 'short' = 'long'): string {
  return monthDate(ym, offset).toLocaleDateString('en-US', { month: style });
}
function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
/** Billed only when the whole range is billed; mixed cells are API-equivalent. */
function basisOf(t: SummaryResponse['totals']): Basis {
  return t.billedUsd !== null && Math.abs(t.billedUsd - t.usd) < 0.005 ? 'billed' : 'computed';
}

export function Overview({ filters, health, emptyDb, filtersToQuery }: Props) {
  const key = JSON.stringify(filters);
  const summary = useAsync(() => getSummary(filters), [key]);
  const insightsRes = useAsync(() => getInsights(filters), [key]);
  const plansHref = buildHash('plans', filtersToQuery(filters));

  if (emptyDb) {
    return (
      <div className="page overview">
        <EmptyState />
      </div>
    );
  }
  if (summary.error) return <div className="page overview error-note">{summary.error}</div>;
  const s = summary.data;
  if (!s) return <div className="page overview loading-note">Loading…</div>;

  const f = s.forecast;
  const since = filters.since ?? '30d';
  const rangeLabel = RANGE_LABEL[since] ?? since;
  const rangeNote = s.range.since && s.range.until ? `${s.range.since.slice(0, 10)} → ${s.range.until.slice(0, 10)}` : rangeLabel;
  const basis = basisOf(s.totals);
  const delta = f.deltaVsLastMonth;
  const providers = s.byProvider.map((r) => r.key);
  const insights = insightsRes.data?.insights ?? [];
  const lastMonthName = monthName(f.month, -1);

  return (
    <div className={`page overview ${summary.refetching ? 'refetching' : ''}`}>
      <div className="stat-grid">
        <StatTile label={`this month · ${monthName(f.month, 0, 'short')} 1–${f.daysElapsed}`} value={formatUsd(s.thisMonth.usd)} basis={basis} note={`${formatInt(s.thisMonth.events)} requests`} />
        <StatTile
          label={`projected month-end · ${f.confidence} confidence`}
          value={formatUsd(f.projectedUsd)}
          basis="estimated"
          note={delta === null ? `${f.daysElapsed}/${f.daysInMonth} days elapsed` : `${formatPctSigned(delta)} vs last month`}
          noteTone={delta === null ? 'muted' : delta > 0.02 ? 'bad' : delta < -0.02 ? 'good' : 'muted'}
        />
        <StatTile label={`today · ${todayIso()}`} value={formatUsd(s.today.usd)} basis={basis} note={`${formatInt(s.today.events)} requests`} />
        <StatTile label={`last month · ${lastMonthName}`} value={formatUsd(s.lastMonth.usd)} basis={basis} note={`${formatInt(s.lastMonth.events)} requests`} />
      </div>

      <section className="section">
        <div className="section-head">
          <h2>Daily spend by provider</h2>
          <SeriesLegend series={providers} colorFor={providerColor} labelFor={providerLabel} note={`${rangeLabel} total ${formatUsd(s.totals.usd)} · ${formatInt(s.totals.events)} requests`} />
        </div>
        <StackedBarChart data={s.daily.map((d) => ({ day: d.day, values: d.byProvider }))} series={providers} colorFor={providerColor} labelFor={providerLabel} basis={basis} note={`${rangeNote} · ${s.range.timeZone}`} />
      </section>

      <div className="sections-3">
        <section className="section">
          <h2>By provider</h2>
          <BreakdownBars rows={s.byProvider} colorFor={providerColor} labelFor={providerLabel} known={KNOWN_PROVIDERS} entity="provider" valueHeader={rangeLabel} />
          <a className="text-link" href={plansHref}>
            Add a connector →
          </a>
        </section>
        <section className="section">
          <h2>By model{providers.length === 1 ? ` · ${providerLabel(providers[0] ?? '')}` : ''}</h2>
          <BreakdownBars rows={s.byModel} colorFor={modelColor} entity="model" valueHeader={rangeLabel} bars limit={8} />
        </section>
        <section className="section">
          <h2>Subscription value</h2>
          {s.subscriptions.length > 0 ? (
            <div className="stack">
              {s.subscriptions.map((row) => (
                <SubscriptionCard key={row.subscription.id} row={row} />
              ))}
            </div>
          ) : (
            <p className="note">
              No plan declared. Run <code>clai plan set anthropic max_5x</code> (or your plan) to see what it delivers in API dollars.
            </p>
          )}
        </section>
      </div>

      <div className="sections-2">
        <section className="section">
          <h2>Budgets</h2>
          {s.budgets.length > 0 ? (
            <div className="budget-list">
              {s.budgets.map((b) => {
                const over = b.usedPct >= 1;
                const projOver = !over && b.projectedPct > 1;
                return (
                  <div className="budget" key={b.budget.id}>
                    <div className="budget-head">
                      <span>{b.budget.name}</span>
                      <span>
                        {formatUsd(b.mtdUsd)} of {formatUsd(b.budget.amountUsd)}
                      </span>
                    </div>
                    <div className="budget-track">
                      <div className={`budget-fill${over ? ' critical' : projOver ? ' warning' : ''}`} data-anim="" style={{ width: `${Math.min(100, b.usedPct * 100)}%` }} />
                    </div>
                    <div className="budget-foot">
                      <span>$0</span>
                      <span>
                        {formatPct(b.usedPct)} used · {formatPct(b.projectedPct)} projected · {basis === 'billed' ? 'billed' : 'computed (API-equivalent)'}
                      </span>
                      <span>{formatUsd(b.budget.amountUsd)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="budget-list">
              <div className="budget">
                <div className="budget-head">
                  <span>
                    {monthName(f.month)} · projected against {lastMonthName}
                  </span>
                  <span>
                    {formatUsd(f.projectedUsd)} of {formatUsd(s.lastMonth.usd)}
                  </span>
                </div>
                <div className="budget-track">
                  <div className={`budget-fill${s.lastMonth.usd > 0 && f.projectedUsd > s.lastMonth.usd ? ' warning' : ''}`} data-anim="" style={{ width: `${s.lastMonth.usd > 0 ? Math.min(100, (f.projectedUsd / s.lastMonth.usd) * 100) : 0}%` }} />
                </div>
                <div className="budget-foot">
                  <span>$0</span>
                  <span>{s.lastMonth.usd > 0 ? `${formatPct(f.projectedUsd / s.lastMonth.usd)} · estimated` : 'no usage last month'}</span>
                  <span>{formatUsd(s.lastMonth.usd)}</span>
                </div>
              </div>
              <p className="note">No fixed budget is set. The bar compares this month's projection with last month's total.</p>
              <a className="btn" href={plansHref} style={{ alignSelf: 'flex-start' }}>
                Set a monthly budget
              </a>
            </div>
          )}
        </section>
        <section className="section">
          <div className="section-head">
            <h2>Top insights</h2>
            {insights.length > 3 && (
              <a className="text-link" href={buildHash('insights', filtersToQuery(filters))}>
                View all ({insights.length}) →
              </a>
            )}
          </div>
          {insights.length > 0 ? (
            <div className="insight-list">
              {insights.slice(0, 3).map((ins) => (
                <InsightCard key={ins.id} insight={ins} />
              ))}
            </div>
          ) : (
            <p className="note">{insightsRes.data ? 'Nothing to flag in this range.' : 'Loading…'}</p>
          )}
        </section>
      </div>

      {s.byProject.length > 0 && (
        <section className="section">
          <h2>Top projects</h2>
          <BreakdownBars rows={s.byProject} colorFor={() => ACCENT} entity="project" valueHeader={rangeLabel} bars limit={6} />
        </section>
      )}
    </div>
  );
}
