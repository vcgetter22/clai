import type { ReactNode } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { XAxisTickContentProps } from 'recharts';
import { formatDayFull, formatDayShort, formatUsd } from '../format';
import { BasisLabel, type Basis } from './BasisLabel';

export interface StackedBarDatum {
  day: string;
  values: Record<string, number>;
}

interface LegendProps {
  series: string[];
  colorFor: (key: string) => string;
  labelFor: (key: string) => string;
  note?: ReactNode;
}

export function SeriesLegend({ series, colorFor, labelFor, note }: LegendProps) {
  return (
    <div className="chart-legend">
      {series.map((k) => (
        <span className="legend-item" key={k}>
          <span className="legend-swatch" style={{ background: colorFor(k) }} />
          {labelFor(k)}
        </span>
      ))}
      {note && <span className="legend-note">{note}</span>}
    </div>
  );
}

interface Props {
  data: StackedBarDatum[];
  series: string[];
  colorFor: (key: string) => string;
  labelFor: (key: string) => string;
  height?: number;
  basis?: Basis;
  note?: ReactNode;
}

/** Part-to-whole over time: stacked bars, axes from zero, gridlines in the rule color, the peak day called out when it is an outlier. */
export function StackedBarChart({ data, series, colorFor, labelFor, height = 220, basis = 'computed', note }: Props) {
  if (data.length === 0 || series.length === 0) return <div className="no-data">No usage in this range.</div>;
  const totals = data.map((d) => series.reduce((a, k) => a + (d.values[k] ?? 0), 0));
  const peak = Math.max(...totals);
  const peakDay = data[totals.indexOf(peak)]?.day ?? '';
  const nonzero = totals.filter((t) => t > 0).sort((a, b) => a - b);
  const median = nonzero[Math.floor(nonzero.length / 2)] ?? 0;
  const ratio = median > 0 ? peak / median : 0;
  const showPeak = ratio >= 3 && peakDay !== '';
  // Weekly ticks from the first day, the last day, and the peak when it is called out.
  const ticks = data.filter((d, i) => (i % 7 === 0 && i < data.length - 3) || i === data.length - 1 || (showPeak && d.day === peakDay)).map((d) => d.day);
  const renderTick = (p: XAxisTickContentProps) => (
    <text x={p.x} y={Number(p.y) + 12} textAnchor="middle" fontSize={12} fontFamily="var(--font-mono)" fill={showPeak && p.payload?.value === peakDay ? 'var(--red)' : 'var(--muted)'}>
      {formatDayShort(String(p.payload?.value ?? ''))}
    </text>
  );
  return (
    <div className="chart-box">
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap={3}>
          <CartesianGrid vertical={false} stroke="var(--rule)" />
          <XAxis dataKey="day" tick={renderTick} ticks={ticks} interval={0} axisLine={{ stroke: 'var(--ink)' }} tickLine={false} />
          <YAxis domain={[0, 'auto']} tickFormatter={(v: number) => `$${Math.round(v).toLocaleString('en-US')}`} tick={{ fill: 'var(--muted)', fontSize: 12, fontFamily: 'var(--font-mono)' }} axisLine={false} tickLine={false} width={52} />
          <Tooltip
            cursor={{ fill: 'var(--recessed)' }}
            content={({ active, payload }) => {
              if (!active || !payload || payload.length === 0) return null;
              const row = payload[0]?.payload as StackedBarDatum | undefined;
              if (!row) return null;
              const total = series.reduce((a, k) => a + (row.values[k] ?? 0), 0);
              return (
                <div className="chart-tooltip">
                  <div className="tt-title">{formatDayFull(row.day)}</div>
                  {series
                    .filter((k) => (row.values[k] ?? 0) > 0)
                    .map((k) => (
                      <div className="tt-row" key={k}>
                        <span className="tt-key">
                          <span className="tt-swatch" style={{ background: colorFor(k) }} />
                          {labelFor(k)}
                        </span>
                        <span className="tt-value">{formatUsd(row.values[k] ?? 0)}</span>
                      </div>
                    ))}
                  <div className="tt-total">
                    <span>total</span>
                    <span>{formatUsd(total)}</span>
                  </div>
                </div>
              );
            }}
          />
          {series.map((k) => (
            <Bar key={k} dataKey={(d: StackedBarDatum) => d.values[k] ?? 0} stackId="stack" fill={colorFor(k)} maxBarSize={28} name={labelFor(k)} isAnimationActive={false} />
          ))}
        </BarChart>
      </ResponsiveContainer>
      <div className="chart-foot">
        <span>
          {note}
          {showPeak && (
            <span className="peak-note">
              {' '}
              · peak {formatDayFull(peakDay)} {formatUsd(peak)}, {ratio.toFixed(1)}x the typical day ({formatUsd(median)})
            </span>
          )}
        </span>
        <BasisLabel basis={basis} />
      </div>
    </div>
  );
}
