import type { ReactNode } from 'react';
import type { CommonFilters } from '../types';
import { providerLabel } from '../colors';

const RANGE_PRESETS: { value: string; label: string }[] = [
  { value: '7d', label: 'last 7 days' },
  { value: '30d', label: 'last 30 days' },
  { value: '90d', label: 'last 90 days' },
  { value: 'month', label: 'this month' },
  { value: 'all', label: 'all time' },
];
const PROVIDERS = ['anthropic', 'openai', 'google', 'cursor', 'github', 'xai', 'mistral'];
const BILLING: { value: string; label: string }[] = [
  { value: 'api', label: 'billed (API)' },
  { value: 'subscription', label: 'subscription (API-equivalent)' },
  { value: 'unknown', label: 'unknown' },
];

interface Props {
  filters: CommonFilters;
  onChange: (next: CommonFilters) => void;
  projects: string[];
  mock: boolean;
  timeZone?: string;
}

function Field({ id, name, value, onChange, children }: { id: string; name: string; value: string; onChange: (v: string) => void; children: ReactNode }) {
  return (
    <label className="filter-field" htmlFor={id}>
      <span className="filter-key">{name} ·</span>
      <select id={id} className="filter-select" value={value} onChange={(e) => onChange(e.target.value)}>
        {children}
      </select>
    </label>
  );
}

/** One row of 40px selects above everything it scopes; the slice lives in the URL hash. */
export function FilterBar({ filters, onChange, projects, mock, timeZone }: Props) {
  return (
    <div className="filterbar">
      <Field id="f-range" name="range" value={filters.since ?? '30d'} onChange={(v) => onChange({ ...filters, since: v })}>
        {RANGE_PRESETS.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
      </Field>
      <Field id="f-provider" name="provider" value={filters.provider ?? ''} onChange={(v) => onChange({ ...filters, provider: v || undefined })}>
        <option value="">all</option>
        {PROVIDERS.map((p) => (
          <option key={p} value={p}>
            {providerLabel(p)}
          </option>
        ))}
      </Field>
      <Field id="f-project" name="project" value={filters.project ?? ''} onChange={(v) => onChange({ ...filters, project: v || undefined })}>
        <option value="">all</option>
        {projects.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </Field>
      <Field id="f-billing" name="billing" value={filters.billing ?? ''} onChange={(v) => onChange({ ...filters, billing: v || undefined })}>
        <option value="">all</option>
        {BILLING.map((b) => (
          <option key={b.value} value={b.value}>
            {b.label}
          </option>
        ))}
      </Field>
      {mock && <span className="mock-note">mock data · append &amp;empty=1 for the onboarding state or &amp;team=1 for team mode</span>}
      {timeZone && <span className="filter-note">{timeZone}</span>}
    </div>
  );
}
