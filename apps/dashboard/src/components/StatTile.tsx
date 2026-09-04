import type { ReactNode } from 'react';
import { BasisLabel, type Basis } from './BasisLabel';

interface StatDelta {
  text: string;
  direction: 'up' | 'down' | 'neutral';
}

interface StatTileProps {
  label: string;
  value: string;
  basis?: Basis;
  note?: ReactNode;
  noteTone?: 'good' | 'bad' | 'muted';
  sub?: string;
  delta?: StatDelta;
  children?: ReactNode;
}

/** label (12 mono muted) · value (34 mono 600 tabular) · basis label plus one note. */
export function StatTile({ label, value, basis, note, noteTone = 'muted', sub, delta, children }: StatTileProps) {
  return (
    <div className="stat-tile">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {(basis || note) && (
        <span className="stat-foot">
          {basis && <BasisLabel basis={basis} />}
          {note && <span className={`stat-note ${noteTone}`}>{note}</span>}
        </span>
      )}
      {delta && <span className={`stat-delta ${delta.direction}`}>{delta.text}</span>}
      {sub && <span className="stat-sub">{sub}</span>}
      {children}
    </div>
  );
}
