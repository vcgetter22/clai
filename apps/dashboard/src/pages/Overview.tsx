import { getInsights, getSummary } from '../api';
import { ACCENT, modelColor, providerColor, providerLabel } from '../colors';
import { BreakdownBars } from '../components/BreakdownBars';
import { EmptyState } from '../components/EmptyState';
import { InsightCard } from '../components/InsightCard';
import { StackedBarChart } from '../components/StackedBarChart';
import { StatTile } from '../components/StatTile';
import { SubscriptionCard } from '../components/SubscriptionCard';
import { formatInt, formatPct, formatPctSigned, formatUsd } from '../format';
import { buildHash } from '../hash';
import { useAsync } from '../useAsync';
import type { CommonFilters, HealthResponse } from '../types';

interface Props {
  filters: CommonFilters;
  health: HealthResponse;
  emptyDb: boolean;
  filtersToQuery: (f: CommonFilters) => URLSearchParams;
}

export function Overview({ filters, health, emptyDb, filtersToQuery }: Props) {
  const key = JSON.stringify(filters);
  const summary = useAsync(() => getSummary(filters), [key]);
  const insightsRes = useAsync(() => getInsights(filters), [key]);

  return (
    <div className="page">
      <div className="page-header">
        <h1>Overview</h1>
        <span className="subtitle tabular">
          {health.timeZone} · pricing {health.pricingVersion}
        </span>
      </div>

      {emptyDb ? (
        <EmptyState />
      ) : summary.error ? (
        <div className="error-note">{summary.error}</div>
      ) : !summary.data ? (
        <div className="loading-note">Loading…</div>
      ) : (
        <div className={`stack ${summary.refetching ? 'refetching' : ''}`}>
          <div className="stat-grid">
            <StatTile label="This month" value={formatUsd(summary.data.thisMonth.usd)} sub={`${formatInt(summary.data.thisMonth.events)} events`} />
            <StatTile
              label="Projected month-end"
              value={formatUsd(summary.data.forecast.projectedUsd)}
              sub={`${summary.data.forecast.confidence} confidence · ${summary.data.forecast.daysElapsed}/${summary.data.forecast.daysInMonth} days elapsed`}
            />
            <StatTile label="Today" value={formatUsd(summary.data.today.usd)} sub={`${formatInt(summary.data.today.events)} events`} />
            <StatTile
              label="Last month"
              value={formatUsd(summary.data.lastMonth.usd)}
              delta={
                summary.data.forecast.deltaVsLastMonth === null
                  ? undefined
                  : {
                      text: `${formatPctSigned(summary.data.forecast.deltaVsLastMonth)} projected vs last month`,
                      direction: summary.data.forecast.deltaVsLastMonth > 0.02 ? 'up' : summary.data.forecast.deltaVsLastMonth < -0.02 ? 'down' : 'neutral',
                    }
              }
            />
          </div>

          <div className="card chart-card">
            <div className="card-header">
              <h2>Daily spend by provider</h2>
              <span className="subtitle">{formatUsd(summary.data.totals.usd)} total in range</span>
            </div>
            <StackedBarChart data={summary.data.daily.map((d) => ({ day: d.day, values: d.byProvider }))} series={summary.data.byProvider.map((r) => r.key)} colorFor={providerColor} labelFor={providerLabel} />
          </div>

          <div className="grid-2">
            <div className="card">
              <div className="card-header">
                <h3>By provider</h3>
              </div>
              <BreakdownBars rows={summary.data.byProvider} colorFor={providerColor} labelFor={providerLabel} />
            </div>
            <div className="card">
              <div className="card-header">
                <h3>By model</h3>
              </div>
              <BreakdownBars rows={summary.data.byModel} colorFor={modelColor} />
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <h3>Top projects</h3>
            </div>
            <BreakdownBars rows={summary.data.byProject} colorFor={() => ACCENT} limit={6} />
          </div>

          {summary.data.subscriptions.length > 0 && (
            <div className="card">
              <div className="card-header">
                <h3>Subscription value</h3>
              </div>
              <div className="grid-3">
                {summary.data.subscriptions.map((row) => (
                  <SubscriptionCard key={row.subscription.id} row={row} />
                ))}
              </div>
            </div>
          )}

          {summary.data.budgets.length > 0 && (
            <div className="card">
              <div className="card-header">
                <h3>Budgets</h3>
              </div>
              <div className="stack">
                {summary.data.budgets.map((b) => {
                  const over = b.usedPct >= 1;
                  const projOver = !over && b.projectedPct > 1;
                  return (
                    <div className="meter" key={b.budget.id}>
                      <div className="meter-label">
                        <span>{b.budget.name}</span>
                        <span className="tabular">
                          {formatUsd(b.mtdUsd)} / {formatUsd(b.budget.amountUsd)} ({formatPct(b.usedPct)})
                        </span>
                      </div>
                      <div className="meter-track">
                        <div className={`meter-fill${over ? ' critical' : projOver ? ' warning' : ''}`} style={{ width: `${Math.min(100, b.usedPct * 100)}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {insightsRes.data && insightsRes.data.insights.length > 0 && (
            <div className="card">
              <div className="card-header">
                <h3>Top insights</h3>
                <a className="btn btn-sm btn-ghost" href={buildHash('insights', filtersToQuery(filters))}>
                  View all ({insightsRes.data.insights.length})
                </a>
              </div>
              <div className="insight-list">
                {insightsRes.data.insights.slice(0, 3).map((ins) => (
                  <InsightCard key={ins.id} insight={ins} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
