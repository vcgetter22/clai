import { getEvents } from '../api';
import { modelColor, providerLabel, sourceLabel } from '../colors';
import { ConfidenceBadge } from '../components/Badge';
import { EmptyState } from '../components/EmptyState';
import { contextTokens, formatDateTime, formatTokens, formatUsd } from '../format';
import { useAsync } from '../useAsync';
import type { CommonFilters, HealthResponse } from '../types';

interface Props {
  filters: CommonFilters;
  health: HealthResponse;
  emptyDb: boolean;
}

export function Events({ filters, health, emptyDb }: Props) {
  const key = JSON.stringify(filters);
  const state = useAsync(() => getEvents(filters, 150), [key]);
  const rows = state.data?.events ?? [];

  return (
    <div className="page">
      <div className="page-header">
        <h1>Events</h1>
        <span className="subtitle">most recent {rows.length} raw events</span>
      </div>

      {emptyDb ? (
        <EmptyState />
      ) : (
        <div className="card">
          {state.error ? (
            <div className="error-note">{state.error}</div>
          ) : !state.data ? (
            <div className="loading-note">Loading…</div>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Source</th>
                    <th>Provider</th>
                    <th>Model</th>
                    <th>Project</th>
                    <th className="num">Tokens</th>
                    <th className="num">Cost</th>
                    <th>Confidence</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((e) => {
                    const project = typeof e.context['project'] === 'string' ? (e.context['project'] as string) : null;
                    return (
                      <tr key={e.id}>
                        <td className="tabular">{formatDateTime(e.ts, health.timeZone)}</td>
                        <td>{sourceLabel(e.source)}</td>
                        <td>{providerLabel(e.provider)}</td>
                        <td>
                          <div className="flex gap-2">
                            <span className="color-dot" style={{ background: modelColor(e.model) }} aria-hidden="true" />
                            {e.model}
                          </div>
                        </td>
                        <td className="truncate" title={project ?? undefined}>
                          {project ?? '—'}
                        </td>
                        <td className="num tabular">{formatTokens(contextTokens(e.usage) + e.usage.output)}</td>
                        <td className="num tabular">{formatUsd(e.cost.billedUsd ?? e.cost.computedUsd)}</td>
                        <td>
                          <ConfidenceBadge confidence={e.cost.confidence} />
                        </td>
                      </tr>
                    );
                  })}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={8} className="no-data">
                        No events in this range.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
