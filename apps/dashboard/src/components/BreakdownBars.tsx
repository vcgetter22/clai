import type { Breakdown } from '../types';
import { formatInt, formatPct, formatUsd } from '../format';

interface Props {
  rows: Breakdown[];
  colorFor: (key: string) => string;
  labelFor?: (key: string) => string;
  limit?: number;
  metric?: 'usd' | 'events';
}

/** A ranked meter-bar list — ordinal magnitude compare, one color per entity (never a value-ramp on the row). */
export function BreakdownBars({ rows, colorFor, labelFor, limit = 8, metric = 'usd' }: Props) {
  const shown = rows.slice(0, limit);
  if (shown.length === 0) return <div className="no-data">No data in this range.</div>;
  const max = Math.max(...shown.map((r) => (metric === 'usd' ? r.usd : r.events)), 1);
  return (
    <div className="breakdown-list">
      {shown.map((r) => {
        const value = metric === 'usd' ? r.usd : r.events;
        const widthPct = Math.max(2, (value / max) * 100);
        const color = colorFor(r.key);
        const label = labelFor ? labelFor(r.key) : r.key;
        return (
          <div className="breakdown-row" key={r.key}>
            <div className="bd-label-row">
              <span className="bd-label" title={label}>
                <span className="bd-dot" style={{ background: color }} aria-hidden="true" />
                {label}
              </span>
              <span className="bd-usd">
                {metric === 'usd' ? formatUsd(r.usd) : formatInt(r.events)}
                <span className="mute2">· {formatPct(r.share)}</span>
              </span>
            </div>
            <div className="bd-track">
              <div className="bd-fill" style={{ width: `${widthPct}%`, background: color }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
