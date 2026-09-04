import { getInsights } from '../api';
import { EmptyState } from '../components/EmptyState';
import { InsightCard } from '../components/InsightCard';
import { useAsync } from '../useAsync';
import type { CommonFilters, Insight, InsightSeverity } from '../types';

interface Props {
  filters: CommonFilters;
  emptyDb: boolean;
}

const GROUPS: { severity: InsightSeverity; label: string }[] = [
  { severity: 'critical', label: 'Critical' },
  { severity: 'warning', label: 'Warning' },
  { severity: 'opportunity', label: 'Opportunity' },
  { severity: 'info', label: 'Info' },
];

export function Insights({ filters, emptyDb }: Props) {
  const key = JSON.stringify(filters);
  const state = useAsync(() => getInsights(filters), [key]);
  const insights = state.data?.insights ?? [];

  return (
    <div className="page">
      <div className="page-header">
        <h1>Insights</h1>
        <span className="subtitle">computed over the last 90 days regardless of the range filter</span>
      </div>

      {emptyDb ? (
        <EmptyState />
      ) : state.error ? (
        <div className="error-note">{state.error}</div>
      ) : !state.data ? (
        <div className="loading-note">Loading…</div>
      ) : insights.length === 0 ? (
        <div className="card">
          <div className="no-data">No insights right now — nothing unusual, over budget, or worth optimizing.</div>
        </div>
      ) : (
        <div className={`stack ${state.refetching ? 'refetching' : ''}`}>
          {GROUPS.map(({ severity, label }) => {
            const rows = insights.filter((i: Insight) => i.severity === severity);
            if (rows.length === 0) return null;
            return (
              <div className="insight-group" key={severity}>
                <div className="insight-group-title">
                  {label} ({rows.length})
                </div>
                <div className="insight-list">
                  {rows.map((ins) => (
                    <InsightCard key={ins.id} insight={ins} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
