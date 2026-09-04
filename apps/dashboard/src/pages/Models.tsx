import { useMemo } from 'react';
import { getBreakdown, getModels } from '../api';
import { modelColor } from '../colors';
import { RetiredBadge, TierBadge, VerifiedBadge } from '../components/Badge';
import { EmptyState } from '../components/EmptyState';
import { SortHeader } from '../components/SortHeader';
import { StackedBarChart, type StackedBarDatum } from '../components/StackedBarChart';
import { contextTokens, formatInt, formatPct, formatTokens, formatUsd } from '../format';
import { useAsync } from '../useAsync';
import { useSort } from '../useSort';
import type { CommonFilters, ModelCatalogEntry } from '../types';

interface Props {
  filters: CommonFilters;
  emptyDb: boolean;
}

interface ModelsData {
  models: ModelCatalogEntry[];
  chart: StackedBarDatum[];
  chartModels: string[];
}

const TOP_N = 6;

/**
 * The documented API has no single "cost by model per day" endpoint, so this composes
 * one from what's documented: the top models by cost (from /api/models), then one
 * /api/breakdown?dim=day&model=<key> call per model — each aggregates server-side
 * (or, in mock mode, over the full filtered set), so the resulting series has no
 * event-sampling bias the way scanning a capped /api/events page would.
 */
async function loadModelsData(filters: CommonFilters): Promise<ModelsData> {
  const res = await getModels(filters);
  const used = res.models.filter((m) => m.events > 0);
  const top = used.slice(0, TOP_N);
  if (top.length === 0) return { models: used, chart: [], chartModels: [] };

  const perModel = await Promise.all(top.map((m) => getBreakdown('day', { ...filters, model: m.key }, 400)));
  const dayKeys = new Set<string>();
  for (const r of perModel) for (const row of r.rows) dayKeys.add(row.key);
  const days = [...dayKeys].sort();

  const chart: StackedBarDatum[] = days.map((day) => {
    const values: Record<string, number> = {};
    top.forEach((m, i) => {
      const row = perModel[i]!.rows.find((r) => r.key === day);
      values[m.key] = row?.usd ?? 0;
    });
    return { day, values };
  });

  return { models: used, chart, chartModels: top.map((m) => m.key) };
}

export function Models({ filters, emptyDb }: Props) {
  const key = JSON.stringify(filters);
  const state = useAsync(() => loadModelsData(filters), [key]);
  const rows = state.data?.models ?? [];
  const total = rows.reduce((a, r) => a + r.usd, 0);

  const accessors = useMemo(
    () => ({
      model: (r: ModelCatalogEntry) => r.displayName,
      usd: (r: ModelCatalogEntry) => r.usd,
      requests: (r: ModelCatalogEntry) => r.usage.requests,
      input: (r: ModelCatalogEntry) => r.usage.input,
      output: (r: ModelCatalogEntry) => r.usage.output,
      context: (r: ModelCatalogEntry) => (r.usage.requests > 0 ? contextTokens(r.usage) / r.usage.requests : 0),
    }),
    [],
  );
  const { sorted, sortKey, dir, toggle } = useSort(rows, 'usd', 'desc', accessors);
  const nameOf = (modelKey: string): string => rows.find((r) => r.key === modelKey)?.displayName ?? modelKey;

  return (
    <div className="page">
      <div className="page-header">
        <h1>Models</h1>
        <span className="subtitle">
          {rows.length} model{rows.length === 1 ? '' : 's'} with usage in range
        </span>
      </div>

      {emptyDb ? (
        <EmptyState />
      ) : state.error ? (
        <div className="error-note">{state.error}</div>
      ) : !state.data ? (
        <div className="loading-note">Loading…</div>
      ) : (
        <div className={`stack ${state.refetching ? 'refetching' : ''}`}>
          <div className="card chart-card">
            <div className="card-header">
              <h2>Cost by model over time</h2>
              <span className="subtitle">top {state.data.chartModels.length} models by cost</span>
            </div>
            <StackedBarChart data={state.data.chart} series={state.data.chartModels} colorFor={modelColor} labelFor={nameOf} />
          </div>

          <div className="card">
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <SortHeader label="Model" sortKeyName="model" activeKey={sortKey} dir={dir} onSort={toggle} />
                    <SortHeader label="Cost" sortKeyName="usd" activeKey={sortKey} dir={dir} onSort={toggle} numeric />
                    <th className="num">Share</th>
                    <SortHeader label="Input" sortKeyName="input" activeKey={sortKey} dir={dir} onSort={toggle} numeric />
                    <th className="num">Cache read</th>
                    <th className="num">Cache write</th>
                    <SortHeader label="Output" sortKeyName="output" activeKey={sortKey} dir={dir} onSort={toggle} numeric />
                    <SortHeader label="Requests" sortKeyName="requests" activeKey={sortKey} dir={dir} onSort={toggle} numeric />
                    <SortHeader label="Avg context" sortKeyName="context" activeKey={sortKey} dir={dir} onSort={toggle} numeric />
                    <th>Tier</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((m) => (
                    <tr key={m.key}>
                      <td>
                        <div className="flex gap-2">
                          <span className="color-dot" style={{ background: modelColor(m.key) }} aria-hidden="true" />
                          <span>{m.displayName}</span>
                          <VerifiedBadge verified={m.verified} />
                          <RetiredBadge retired={m.retired} />
                        </div>
                      </td>
                      <td className="num tabular">{formatUsd(m.usd)}</td>
                      <td className="num tabular">{formatPct(total > 0 ? m.usd / total : 0)}</td>
                      <td className="num tabular">{formatTokens(m.usage.input)}</td>
                      <td className="num tabular">{formatTokens(m.usage.cacheRead)}</td>
                      <td className="num tabular">{formatTokens(m.usage.cacheWrite5m + m.usage.cacheWrite1h)}</td>
                      <td className="num tabular">{formatTokens(m.usage.output)}</td>
                      <td className="num tabular">{formatInt(m.usage.requests)}</td>
                      <td className="num tabular">{formatTokens(m.usage.requests > 0 ? contextTokens(m.usage) / m.usage.requests : 0)}</td>
                      <td>
                        <TierBadge tier={m.tier} />
                      </td>
                    </tr>
                  ))}
                  {sorted.length === 0 && (
                    <tr>
                      <td colSpan={10} className="no-data">
                        No model usage in this range.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
