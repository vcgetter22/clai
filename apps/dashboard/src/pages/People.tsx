import { getActors } from '../api';
import { Badge } from '../components/Badge';
import { EmptyState } from '../components/EmptyState';
import { formatInt, formatUsd } from '../format';
import { useAsync } from '../useAsync';
import type { CommonFilters, HealthResponse } from '../types';

interface Props {
  filters: CommonFilters;
  health: HealthResponse;
  emptyDb: boolean;
}

function displayName(actor: Record<string, unknown>, key: string): string {
  const name = actor['name'];
  if (typeof name === 'string' && name) return name;
  const email = actor['email'];
  if (typeof email === 'string' && email) return email;
  return key;
}

/**
 * Day-key comparison (not millisecond math) so this agrees with the idle-seat insight
 * on the Insights page regardless of what time of day "now" happens to be — a seat
 * last active exactly on the 30-day boundary counts as idle in both places.
 */
function isIdle(lastDay: string | null): boolean {
  if (!lastDay) return true;
  const today = new Date().toISOString().slice(0, 10);
  const [y, m, d] = today.split('-').map(Number);
  const since = new Date(Date.UTC(y!, m! - 1, d! - 30)).toISOString().slice(0, 10);
  return lastDay <= since;
}

export function People({ filters, health, emptyDb }: Props) {
  const key = JSON.stringify(filters);
  const state = useAsync(() => getActors(filters), [key]);
  const rows = state.data?.actors ?? [];
  const isLocal = health.mode === 'local';

  return (
    <div className="page">
      <div className="page-header">
        <h1>People</h1>
        <span className="subtitle">last 90 days</span>
      </div>

      {emptyDb ? (
        <EmptyState />
      ) : (
        <div className="stack">
          {isLocal && (
            <div className="card">
              <p className="muted" style={{ margin: 0 }}>
                Local mode tracks a single actor (you). Point this dashboard at a <code>clai-server</code> running in team mode to see usage broken down by teammate, with declared seats and idle-seat detection.
              </p>
            </div>
          )}
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
                      <th>Actor</th>
                      <th>Seat / plan</th>
                      <th>First activity</th>
                      <th>Last activity</th>
                      <th className="num">Events</th>
                      <th className="num">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((a) => {
                      const idle = !!a.seat && isIdle(a.lastDay);
                      return (
                        <tr key={a.actorKey} className={idle ? 'idle' : undefined}>
                          <td>{displayName(a.actor, a.actorKey)}</td>
                          <td>
                            {a.seat ? (
                              <span className="pill">
                                {a.seat.provider} · {a.seat.plan} · {formatUsd(a.seat.priceMonthly)}/mo
                              </span>
                            ) : (
                              <span className="mute2">no seat declared</span>
                            )}
                          </td>
                          <td className="tabular">{a.firstDay ?? '—'}</td>
                          <td className="tabular">
                            <span className="flex gap-2">
                              {a.lastDay ?? '—'}
                              {idle && <Badge tone="warning">Idle 30d+</Badge>}
                            </span>
                          </td>
                          <td className="num tabular">{formatInt(a.events)}</td>
                          <td className="num tabular">{formatUsd(a.usd)}</td>
                        </tr>
                      );
                    })}
                    {rows.length === 0 && (
                      <tr>
                        <td colSpan={6} className="no-data">
                          No activity in this range.
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
    </div>
  );
}
