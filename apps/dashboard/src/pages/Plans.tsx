import { useState, type FormEvent } from 'react';
import { addBudget, addSeat, addSubscription, deleteBudget, deleteSeat, deleteSubscription, getSettings, scan } from '../api';
import { formatDateTime, formatUsd, titleCase } from '../format';
import { useAsync } from '../useAsync';
import type { HealthResponse, PlanCatalogEntry } from '../types';

interface Props {
  health: HealthResponse;
}

export function Plans({ health }: Props) {
  const [tick, setTick] = useState(0);
  const state = useAsync(() => getSettings(), [tick]);
  const [scanResult, setScanResult] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  function reload(): void {
    setTick((t) => t + 1);
  }

  async function runScan(): Promise<void> {
    setScanning(true);
    setScanResult(null);
    try {
      const res = await scan();
      const added = res.results.reduce((a, r) => a + r.inserted, 0);
      setScanResult(`Scanned ${res.results.length} source${res.results.length === 1 ? '' : 's'} · ${added} new event${added === 1 ? '' : 's'}.`);
      reload();
    } catch (e) {
      setScanResult(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
    }
  }

  if (state.error) {
    return (
      <div className="page">
        <div className="page-header">
          <h1>Plans &amp; Budgets</h1>
        </div>
        <div className="error-note">{state.error}</div>
      </div>
    );
  }
  if (!state.data) {
    return (
      <div className="page">
        <div className="page-header">
          <h1>Plans &amp; Budgets</h1>
        </div>
        <div className="loading-note">Loading…</div>
      </div>
    );
  }

  const s = state.data;

  return (
    <div className="page">
      <div className="page-header">
        <h1>Plans &amp; Budgets</h1>
      </div>

      <div className="card">
        <div className="card-header">
          <h2>Environment</h2>
        </div>
        <div className="settings-meta">
          <span>
            Timezone: <strong>{s.timeZone}</strong>
          </span>
          <span>
            Pricing catalog: <strong>{s.pricingVersion}</strong>
          </span>
          <span>
            Mode: <strong>{s.mode}</strong>
          </span>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h2>Sources &amp; last scan</h2>
          {health.mode === 'local' && (
            <button type="button" className="btn btn-primary btn-sm" onClick={runScan} disabled={scanning}>
              {scanning ? 'Scanning…' : 'Scan now'}
            </button>
          )}
        </div>
        {scanResult && (
          <p className="muted" style={{ marginTop: 0 }}>
            {scanResult}
          </p>
        )}
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Source</th>
                <th className="num">Events</th>
                <th>First seen</th>
                <th>Last seen</th>
                <th>Last run</th>
              </tr>
            </thead>
            <tbody>
              {s.sources.map((src) => {
                const run = s.lastRuns.find((r) => r.source === src.source);
                return (
                  <tr key={src.source}>
                    <td>{titleCase(src.source)}</td>
                    <td className="num tabular">{src.events}</td>
                    <td className="tabular">{src.first ? formatDateTime(src.first, s.timeZone) : '—'}</td>
                    <td className="tabular">{src.last ? formatDateTime(src.last, s.timeZone) : '—'}</td>
                    <td>{run ? (run.ok ? <span className="badge badge-good">ok</span> : <span className="badge badge-critical">error</span>) : <span className="mute2">never scanned</span>}</td>
                  </tr>
                );
              })}
              {s.sources.length === 0 && (
                <tr>
                  <td colSpan={5} className="no-data">
                    No sources connected yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h2>Subscriptions</h2>
        </div>
        {s.subscriptions.length === 0 && <p className="muted">No subscriptions declared yet.</p>}
        {s.subscriptions.map((sub) => (
          <div className="list-row" key={sub.id}>
            <div className="list-row-main">
              <span className="list-row-title">{sub.label ?? `${sub.provider} ${sub.plan}`}</span>
              <span className="list-row-sub">
                {sub.provider} · {sub.plan} · {formatUsd(sub.priceMonthly)}/mo{sub.seats ? ` · ${sub.seats} seats` : ''}
              </span>
            </div>
            <div className="list-row-actions">
              <button
                type="button"
                className="btn btn-danger btn-sm"
                onClick={async () => {
                  await deleteSubscription(sub.id);
                  reload();
                }}
              >
                Remove
              </button>
            </div>
          </div>
        ))}
        <SubscriptionForm plans={s.plans} onAdded={reload} />
      </div>

      <div className="card">
        <div className="card-header">
          <h2>Budgets</h2>
        </div>
        {s.budgets.length === 0 && <p className="muted">No budgets set yet.</p>}
        {s.budgets.map((b) => (
          <div className="list-row" key={b.id}>
            <div className="list-row-main">
              <span className="list-row-title">{b.name}</span>
              <span className="list-row-sub">
                {formatUsd(b.amountUsd)} / {b.period}
                {b.scope?.project ? ` · project: ${b.scope.project}` : ''}
              </span>
            </div>
            <div className="list-row-actions">
              <button
                type="button"
                className="btn btn-danger btn-sm"
                onClick={async () => {
                  await deleteBudget(b.id);
                  reload();
                }}
              >
                Remove
              </button>
            </div>
          </div>
        ))}
        <BudgetForm onAdded={reload} />
      </div>

      <div className="card">
        <div className="card-header">
          <h2>Seats</h2>
        </div>
        {s.seats.length === 0 && <p className="muted">No seats declared yet.</p>}
        {s.seats.map((seat) => (
          <div className="list-row" key={seat.actorKey}>
            <div className="list-row-main">
              <span className="list-row-title">{seat.label ?? seat.actorKey}</span>
              <span className="list-row-sub">
                {seat.actorKey} · {seat.provider} · {seat.plan} · {formatUsd(seat.priceMonthly)}/mo
              </span>
            </div>
            <div className="list-row-actions">
              <button
                type="button"
                className="btn btn-danger btn-sm"
                onClick={async () => {
                  await deleteSeat(seat.actorKey);
                  reload();
                }}
              >
                Remove
              </button>
            </div>
          </div>
        ))}
        <SeatForm plans={s.plans} onAdded={reload} />
      </div>
    </div>
  );
}

// -------------------------------------------------------------- sub-forms

function SubscriptionForm({ plans, onAdded }: { plans: PlanCatalogEntry[]; onAdded: () => void }) {
  const providers = [...new Set(plans.map((p) => p.provider))];
  const [provider, setProvider] = useState(providers[0] ?? 'anthropic');
  const plansForProvider = plans.filter((p) => p.provider === provider);
  const [plan, setPlan] = useState(plansForProvider[0]?.plan ?? '');
  const effectivePlan = plansForProvider.find((p) => p.plan === plan) ?? plansForProvider[0];
  const [label, setLabel] = useState('');
  const [price, setPrice] = useState<number | ''>('');
  const [seats, setSeats] = useState<number | ''>('');
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!effectivePlan) return;
    setSaving(true);
    try {
      await addSubscription({
        provider,
        plan: effectivePlan.plan,
        label: label || undefined,
        priceMonthly: price === '' ? (effectivePlan.priceMonthly ?? 0) : price,
        seats: seats === '' ? undefined : seats,
      });
      setLabel('');
      setPrice('');
      setSeats('');
      onAdded();
    } finally {
      setSaving(false);
    }
  }

  if (plans.length === 0) return null;

  return (
    <form className="form-grid" style={{ marginTop: 12 }} onSubmit={submit}>
      <div className="form-field">
        <label htmlFor="sub-provider">Provider</label>
        <select
          id="sub-provider"
          value={provider}
          onChange={(e) => {
            setProvider(e.target.value);
            const first = plans.find((p) => p.provider === e.target.value);
            setPlan(first?.plan ?? '');
          }}
        >
          {providers.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>
      <div className="form-field">
        <label htmlFor="sub-plan">Plan</label>
        <select id="sub-plan" value={plan} onChange={(e) => setPlan(e.target.value)}>
          {plansForProvider.map((p) => (
            <option key={p.plan} value={p.plan}>
              {p.display}
            </option>
          ))}
        </select>
      </div>
      <div className="form-field">
        <label htmlFor="sub-label">Label</label>
        <input id="sub-label" type="text" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={effectivePlan?.display ?? ''} />
      </div>
      <div className="form-field">
        <label htmlFor="sub-price">Price / mo</label>
        <input id="sub-price" type="number" min={0} step="0.01" value={price} onChange={(e) => setPrice(e.target.value === '' ? '' : Number(e.target.value))} placeholder={String(effectivePlan?.priceMonthly ?? 0)} />
      </div>
      <div className="form-field">
        <label htmlFor="sub-seats">Seats</label>
        <input id="sub-seats" type="number" min={1} step="1" value={seats} onChange={(e) => setSeats(e.target.value === '' ? '' : Number(e.target.value))} placeholder="1" />
      </div>
      <button type="submit" className="btn btn-primary" disabled={saving || !effectivePlan}>
        {saving ? 'Adding…' : 'Add subscription'}
      </button>
    </form>
  );
}

function BudgetForm({ onAdded }: { onAdded: () => void }) {
  const [name, setName] = useState('');
  const [amount, setAmount] = useState<number | ''>('');
  const [project, setProject] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!name || amount === '') return;
    setSaving(true);
    try {
      await addBudget({ name, amountUsd: Number(amount), scope: project ? { project } : undefined });
      setName('');
      setAmount('');
      setProject('');
      onAdded();
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="form-grid" style={{ marginTop: 12 }} onSubmit={submit}>
      <div className="form-field">
        <label htmlFor="bud-name">Name</label>
        <input id="bud-name" type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Overall monthly cap" required />
      </div>
      <div className="form-field">
        <label htmlFor="bud-amount">Amount / mo</label>
        <input id="bud-amount" type="number" min={0} step="1" value={amount} onChange={(e) => setAmount(e.target.value === '' ? '' : Number(e.target.value))} placeholder="500" required />
      </div>
      <div className="form-field">
        <label htmlFor="bud-project">Scope: project (optional)</label>
        <input id="bud-project" type="text" value={project} onChange={(e) => setProject(e.target.value)} placeholder="all projects" />
      </div>
      <button type="submit" className="btn btn-primary" disabled={saving}>
        {saving ? 'Adding…' : 'Add budget'}
      </button>
    </form>
  );
}

function SeatForm({ plans, onAdded }: { plans: PlanCatalogEntry[]; onAdded: () => void }) {
  const seatPlans = plans.filter((p) => p.seatBased);
  const providers = [...new Set(seatPlans.map((p) => p.provider))];
  const [actorKey, setActorKey] = useState('');
  const [provider, setProvider] = useState(providers[0] ?? '');
  const plansForProvider = seatPlans.filter((p) => p.provider === provider);
  const [plan, setPlan] = useState(plansForProvider[0]?.plan ?? '');
  const effectivePlan = plansForProvider.find((p) => p.plan === plan) ?? plansForProvider[0];
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!actorKey || !effectivePlan) return;
    setSaving(true);
    try {
      await addSeat({ actorKey, provider, plan: effectivePlan.plan, priceMonthly: effectivePlan.priceMonthly ?? 0, label: actorKey });
      setActorKey('');
      onAdded();
    } finally {
      setSaving(false);
    }
  }

  if (seatPlans.length === 0) return null;

  return (
    <form className="form-grid" style={{ marginTop: 12 }} onSubmit={submit}>
      <div className="form-field">
        <label htmlFor="seat-actor">Actor key (email)</label>
        <input id="seat-actor" type="text" value={actorKey} onChange={(e) => setActorKey(e.target.value)} placeholder="name@company.com" required />
      </div>
      <div className="form-field">
        <label htmlFor="seat-provider">Provider</label>
        <select
          id="seat-provider"
          value={provider}
          onChange={(e) => {
            setProvider(e.target.value);
            const first = seatPlans.find((p) => p.provider === e.target.value);
            setPlan(first?.plan ?? '');
          }}
        >
          {providers.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>
      <div className="form-field">
        <label htmlFor="seat-plan">Plan</label>
        <select id="seat-plan" value={plan} onChange={(e) => setPlan(e.target.value)}>
          {plansForProvider.map((p) => (
            <option key={p.plan} value={p.plan}>
              {p.display}
            </option>
          ))}
        </select>
      </div>
      <button type="submit" className="btn btn-primary" disabled={saving}>
        {saving ? 'Adding…' : 'Add seat'}
      </button>
    </form>
  );
}
