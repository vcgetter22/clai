import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatDayFull, formatDayShort, formatUsd } from '../format';

export interface StackedBarDatum {
  day: string;
  values: Record<string, number>;
}

interface Props {
  data: StackedBarDatum[];
  series: string[];
  colorFor: (key: string) => string;
  labelFor: (key: string) => string;
  height?: number;
}

/** Part-to-whole over time: a stacked bar chart, categorical color by entity, one shared tooltip per day. */
export function StackedBarChart({ data, series, colorFor, labelFor, height = 260 }: Props) {
  if (data.length === 0 || series.length === 0) return <div className="no-data">No usage in this range.</div>;
  return (
    <div>
      <div className="chart-legend">
        {series.map((k) => (
          <span className="legend-item" key={k}>
            <span className="legend-swatch" style={{ background: colorFor(k) }} />
            {labelFor(k)}
          </span>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--grid-line)" />
          <XAxis dataKey="day" tickFormatter={(d: string) => formatDayShort(d)} tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={{ stroke: 'var(--axis-line)' }} tickLine={false} minTickGap={28} />
          <YAxis tickFormatter={(v: number) => formatUsd(v)} tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} width={60} />
          <Tooltip
            cursor={{ fill: 'var(--surface-3)' }}
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
                    <span>Total</span>
                    <span>{formatUsd(total)}</span>
                  </div>
                </div>
              );
            }}
          />
          {series.map((k) => (
            <Bar key={k} dataKey={(d: StackedBarDatum) => d.values[k] ?? 0} stackId="stack" fill={colorFor(k)} maxBarSize={24} name={labelFor(k)} isAnimationActive={false} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
