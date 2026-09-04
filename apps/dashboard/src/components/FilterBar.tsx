import type { CommonFilters } from '../types';
import { providerLabel } from '../colors';

const RANGE_PRESETS: { value: string; label: string }[] = [
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: 'month', label: 'This month' },
  { value: 'all', label: 'All time' },
];
const PROVIDERS = ['anthropic', 'openai', 'google', 'cursor', 'github', 'xai', 'mistral'];
const BILLING: { value: string; label: string }[] = [
  { value: 'api', label: 'API' },
  { value: 'subscription', label: 'Subscription' },
  { value: 'unknown', label: 'Unknown' },
];

interface Props {
  filters: CommonFilters;
  onChange: (next: CommonFilters) => void;
  projects: string[];
  mock: boolean;
}

/** One row, above everything it scopes. Every page re-renders against the same slice. Lives in the URL hash query. */
export function FilterBar({ filters, onChange, projects, mock }: Props) {
  return (
    <div className="filterbar">
      <div className="filter-field">
        <label htmlFor="f-range">Range</label>
        <select id="f-range" value={filters.since ?? '30d'} onChange={(e) => onChange({ ...filters, since: e.target.value })}>
          {RANGE_PRESETS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </div>
      <div className="filter-field">
        <label htmlFor="f-provider">Provider</label>
        <select id="f-provider" value={filters.provider ?? ''} onChange={(e) => onChange({ ...filters, provider: e.target.value || undefined })}>
          <option value="">All providers</option>
          {PROVIDERS.map((p) => (
            <option key={p} value={p}>
              {providerLabel(p)}
            </option>
          ))}
        </select>
      </div>
      <div className="filter-field">
        <label htmlFor="f-project">Project</label>
        <select id="f-project" value={filters.project ?? ''} onChange={(e) => onChange({ ...filters, project: e.target.value || undefined })}>
          <option value="">All projects</option>
          {projects.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>
      <div className="filter-field">
        <label htmlFor="f-billing">Billing</label>
        <select id="f-billing" value={filters.billing ?? ''} onChange={(e) => onChange({ ...filters, billing: e.target.value || undefined })}>
          <option value="">All billing</option>
          {BILLING.map((b) => (
            <option key={b.value} value={b.value}>
              {b.label}
            </option>
          ))}
        </select>
      </div>
      {mock && <span className="mock-note">Mock data · append &amp;empty=1 for the onboarding state or &amp;team=1 for team mode</span>}
    </div>
  );
}
