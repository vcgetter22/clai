import { useMemo, useState } from 'react';
import { getModels } from '../api';
import { providerLabel } from '../colors';
import { RetiredBadge, TierBadge, VerifiedBadge } from '../components/Badge';
import { SortHeader } from '../components/SortHeader';
import { formatInt, formatUsd } from '../format';
import { useAsync } from '../useAsync';
import { useSort } from '../useSort';
import type { ModelCatalogEntry } from '../types';

function perMtok(n: number | null): string {
  return n === null ? '—' : formatUsd(n);
}

/** Reference catalog — deliberately not scoped by the global range/provider filter bar, since "what does this model cost" doesn't depend on a date range. Filterable locally by provider instead. */
export function Pricing() {
  const state = useAsync(() => getModels({}), []);
  const [provider, setProvider] = useState('');
  const rows = state.data?.models ?? [];
  const providers = useMemo(() => [...new Set(rows.map((r) => r.provider))].sort(), [rows]);
  const filtered = provider ? rows.filter((r) => r.provider === provider) : rows;

  const accessors = useMemo(
    () => ({
      model: (r: ModelCatalogEntry) => r.displayName,
      provider: (r: ModelCatalogEntry) => r.provider,
      input: (r: ModelCatalogEntry) => r.input,
      output: (r: ModelCatalogEntry) => r.output,
      context: (r: ModelCatalogEntry) => r.contextWindow ?? 0,
    }),
    [],
  );
  const { sorted, sortKey, dir, toggle } = useSort(filtered, 'provider', 'asc', accessors);

  return (
    <div className="page">
      <div className="page-header">
        <h1>Pricing</h1>
        <span className="subtitle">catalog reference — not scoped by the range filter above</span>
      </div>
      <div className="card">
        <div className="card-header">
          <h2>Model price list</h2>
          <div className="filter-field">
            <label htmlFor="pricing-provider">Provider</label>
            <select id="pricing-provider" value={provider} onChange={(e) => setProvider(e.target.value)}>
              <option value="">All providers</option>
              {providers.map((p) => (
                <option key={p} value={p}>
                  {providerLabel(p)}
                </option>
              ))}
            </select>
          </div>
        </div>
        {state.error ? (
          <div className="error-note">{state.error}</div>
        ) : !state.data ? (
          <div className="loading-note">Loading…</div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <SortHeader label="Provider" sortKeyName="provider" activeKey={sortKey} dir={dir} onSort={toggle} />
                  <SortHeader label="Model" sortKeyName="model" activeKey={sortKey} dir={dir} onSort={toggle} />
                  <SortHeader label="Input /1M" sortKeyName="input" activeKey={sortKey} dir={dir} onSort={toggle} numeric />
                  <th className="num">Cache read /1M</th>
                  <th className="num">Cache write 5m /1M</th>
                  <th className="num">Cache write 1h /1M</th>
                  <SortHeader label="Output /1M" sortKeyName="output" activeKey={sortKey} dir={dir} onSort={toggle} numeric />
                  <SortHeader label="Context window" sortKeyName="context" activeKey={sortKey} dir={dir} onSort={toggle} numeric />
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((m) => (
                  <tr key={m.key}>
                    <td>{providerLabel(m.provider)}</td>
                    <td>
                      <div className="flex gap-2">
                        <span>{m.displayName}</span>
                        <TierBadge tier={m.tier} />
                      </div>
                    </td>
                    <td className="num tabular">{perMtok(m.input)}</td>
                    <td className="num tabular">{perMtok(m.cacheRead)}</td>
                    <td className="num tabular">{perMtok(m.cacheWrite5m)}</td>
                    <td className="num tabular">{perMtok(m.cacheWrite1h)}</td>
                    <td className="num tabular">{perMtok(m.output)}</td>
                    <td className="num tabular">{m.contextWindow ? formatInt(m.contextWindow) : '—'}</td>
                    <td>
                      <div className="flex gap-2">
                        {m.verified && !m.retired && <span className="badge badge-good">Verified</span>}
                        <VerifiedBadge verified={m.verified} />
                        <RetiredBadge retired={m.retired} />
                      </div>
                    </td>
                  </tr>
                ))}
                {sorted.length === 0 && (
                  <tr>
                    <td colSpan={9} className="no-data">
                      No models match this filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
