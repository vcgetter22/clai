import type { Breakdown } from '../types';
import { formatInt, formatPct, formatUsd } from '../format';

interface Props {
  rows: Breakdown[];
  colorFor: (key: string) => string;
  labelFor?: (key: string) => string;
  limit?: number;
  metric?: 'usd' | 'events';
  /** Keys that are always listed; missing ones show "no source". */
  known?: string[];
  entity?: string;
  valueHeader?: string;
  /** Draw a share bar under each name (one color per entity, never a value ramp). */
  bars?: boolean;
}

/** A ledger: ink top rule, dashed row rules, mono tabular figures, amounts right-aligned, no zebra. */
export function BreakdownBars({ rows, colorFor, labelFor, limit = 8, metric = 'usd', known = [], entity = 'name', valueHeader = 'spend', bars = false }: Props) {
  const shown = rows.slice(0, limit);
  const missing = known.filter((k) => !rows.some((r) => r.key === k));
  if (shown.length === 0 && missing.length === 0) return <div className="no-data">No data in this range.</div>;
  const label = (k: string) => (labelFor ? labelFor(k) : k);
  return (
    <table className="ledger">
      <thead>
        <tr>
          <th>{entity}</th>
          <th className="num">requests</th>
          <th className="num">share</th>
          <th className="num">{valueHeader}</th>
        </tr>
      </thead>
      <tbody>
        {shown.map((r) => (
          <tr key={r.key}>
            <td>
              <span className="ledger-name" title={label(r.key)}>
                <span className="swatch" style={{ background: colorFor(r.key) }} aria-hidden="true" />
                {label(r.key)}
              </span>
              {bars && (
                <span className="share-bar">
                  <span className="share-fill" style={{ width: `${Math.max(1, r.share * 100)}%`, background: colorFor(r.key) }} />
                </span>
              )}
            </td>
            <td className="num">{formatInt(r.usage.requests || r.events)}</td>
            <td className="num">{formatPct(r.share)}</td>
            <td className="num strong">{metric === 'usd' ? formatUsd(r.usd) : formatInt(r.events)}</td>
          </tr>
        ))}
        {missing.map((k) => (
          <tr key={k} className="muted-row">
            <td>
              <span className="ledger-name">
                <span className="swatch" style={{ background: colorFor(k) }} aria-hidden="true" />
                {label(k)}
              </span>
            </td>
            <td className="num">no source</td>
            <td className="num">—</td>
            <td className="num">—</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
