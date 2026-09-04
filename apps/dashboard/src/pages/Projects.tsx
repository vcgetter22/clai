import { useMemo, useState } from 'react';
import { getBreakdown, getSessions } from '../api';
import { ACCENT, modelColor } from '../colors';
import { BreakdownBars } from '../components/BreakdownBars';
import { EmptyState } from '../components/EmptyState';
import { SessionDetail } from '../components/SessionDetail';
import { SortHeader } from '../components/SortHeader';
import { formatDateTime, formatDurationBetween, formatInt, formatTokens, formatUsd } from '../format';
import { useAsync } from '../useAsync';
import { useSort } from '../useSort';
import type { CommonFilters, HealthResponse, Session } from '../types';

interface Props {
  filters: CommonFilters;
  health: HealthResponse;
  emptyDb: boolean;
}

export function Projects({ filters, health, emptyDb }: Props) {
  const key = JSON.stringify(filters);
  const projectBreakdown = useAsync(() => getBreakdown('project', filters, 20), [key]);
  const sessionsRes = useAsync(() => getSessions(filters, 200), [key]);
  const [selected, setSelected] = useState<Session | null>(null);

  const rows = sessionsRes.data?.sessions ?? [];
  const accessors = useMemo(
    () => ({
      project: (s: Session) => s.project ?? '',
      started: (s: Session) => s.started,
      duration: (s: Session) => new Date(s.ended).getTime() - new Date(s.started).getTime(),
      requests: (s: Session) => s.events,
      context: (s: Session) => s.maxContext,
      cost: (s: Session) => s.usd,
    }),
    [],
  );
  const { sorted, sortKey, dir, toggle } = useSort(rows, 'started', 'desc', accessors);

  return (
    <div className="page">
      <div className="page-header">
        <h1>Projects &amp; Sessions</h1>
      </div>

      {emptyDb ? (
        <EmptyState />
      ) : (
        <div className="stack">
          <div className="card">
            <div className="card-header">
              <h2>Cost by project</h2>
            </div>
            {projectBreakdown.error ? (
              <div className="error-note">{projectBreakdown.error}</div>
            ) : projectBreakdown.data ? (
              <BreakdownBars rows={projectBreakdown.data.rows} colorFor={() => ACCENT} limit={12} />
            ) : (
              <div className="loading-note">Loading…</div>
            )}
          </div>

          <div className="card">
            <div className="card-header">
              <h2>Sessions</h2>
              <span className="subtitle">{rows.length} shown · click a row for detail</span>
            </div>
            {sessionsRes.error ? (
              <div className="error-note">{sessionsRes.error}</div>
            ) : !sessionsRes.data ? (
              <div className="loading-note">Loading…</div>
            ) : (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <SortHeader label="Project" sortKeyName="project" activeKey={sortKey} dir={dir} onSort={toggle} />
                      <SortHeader label="Started" sortKeyName="started" activeKey={sortKey} dir={dir} onSort={toggle} />
                      <SortHeader label="Duration" sortKeyName="duration" activeKey={sortKey} dir={dir} onSort={toggle} numeric />
                      <th>Models</th>
                      <SortHeader label="Requests" sortKeyName="requests" activeKey={sortKey} dir={dir} onSort={toggle} numeric />
                      <SortHeader label="Max context" sortKeyName="context" activeKey={sortKey} dir={dir} onSort={toggle} numeric />
                      <SortHeader label="Cost" sortKeyName="cost" activeKey={sortKey} dir={dir} onSort={toggle} numeric />
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((s) => (
                      <tr
                        key={s.sessionId}
                        className="clickable"
                        tabIndex={0}
                        onClick={() => setSelected(s)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') setSelected(s);
                        }}
                      >
                        <td className="truncate" title={s.project ?? undefined}>
                          {s.project ?? '—'}
                        </td>
                        <td className="tabular">{formatDateTime(s.started, health.timeZone)}</td>
                        <td className="num tabular">{formatDurationBetween(s.started, s.ended)}</td>
                        <td>
                          <div className="flex gap-2">
                            {s.models.slice(0, 3).map((m) => (
                              <span key={m} className="color-dot" style={{ background: modelColor(m) }} title={m} />
                            ))}
                            {s.models.length > 3 && <span className="mute2">+{s.models.length - 3}</span>}
                          </div>
                        </td>
                        <td className="num tabular">{formatInt(s.events)}</td>
                        <td className="num tabular">{formatTokens(s.maxContext)}</td>
                        <td className="num tabular">{formatUsd(s.usd)}</td>
                      </tr>
                    ))}
                    {sorted.length === 0 && (
                      <tr>
                        <td colSpan={7} className="no-data">
                          No sessions in this range.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {selected && <SessionDetail session={selected} timeZone={health.timeZone} onClose={() => setSelected(null)} />}
    </div>
  );
}
