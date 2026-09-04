import type { ReactNode } from 'react';

interface StatDelta {
  text: string;
  direction: 'up' | 'down' | 'neutral';
}

interface StatTileProps {
  label: string;
  value: string;
  sub?: string;
  delta?: StatDelta;
  children?: ReactNode;
}

/** Figure contract: label (sentence case) · value (semibold, auto-compact) · optional signed delta. */
export function StatTile({ label, value, sub, delta, children }: StatTileProps) {
  return (
    <div className="stat-tile">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {delta && (
        <span className={`stat-delta ${delta.direction}`}>
          {delta.direction === 'up' ? '▲' : delta.direction === 'down' ? '▼' : ''} {delta.text}
        </span>
      )}
      {sub && <span className="stat-sub">{sub}</span>}
      {children}
    </div>
  );
}
