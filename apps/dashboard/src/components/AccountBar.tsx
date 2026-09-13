import { useState, type FormEvent } from 'react';
import { createMachineToken, getOrg, logout, setOrg } from '../api';
import type { WhoamiResponse } from '../types';

interface Props {
  whoami: WhoamiResponse;
}

/** Header, hosted mode only (`health.auth?.kind === 'supabase'`): identity, org, plan, "Connect a machine", sign out. */
export function AccountBar({ whoami }: Props) {
  const [showConnect, setShowConnect] = useState(false);
  const orgs = whoami.orgs ?? [];
  const plan = whoami.plan ?? 'free';
  const planIsPaid = plan !== 'free' && plan !== 'self-hosted';

  async function handleSignOut(): Promise<void> {
    await logout();
    window.location.reload();
  }

  return (
    <>
      <span className="whoami">{whoami.email ?? whoami.label ?? whoami.actorKey}</span>
      {orgs.length > 1 && (
        <select
          aria-label="Organization"
          className="filter-select"
          value={whoami.orgId ?? getOrg() ?? orgs[0]?.id ?? ''}
          onChange={(e) => {
            setOrg(e.target.value);
            window.location.reload();
          }}
        >
          {orgs.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      )}
      <span className={`badge${planIsPaid ? ' badge-good' : ''}`}>
        {plan}
        {whoami.upgradeUrl && (
          <a href={whoami.upgradeUrl} target="_blank" rel="noreferrer" style={{ color: 'inherit' }}>
            Upgrade
          </a>
        )}
      </span>
      <button type="button" className="btn btn-sm" onClick={() => setShowConnect(true)}>
        Connect a machine
      </button>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => void handleSignOut()}>
        Sign out
      </button>
      {showConnect && <ConnectMachine onClose={() => setShowConnect(false)} />}
    </>
  );
}

function ConnectMachine({ onClose }: { onClose: () => void }) {
  const [label, setLabel] = useState('');
  const [token, setTokenValue] = useState<string | null>(null);
  const [minting, setMinting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setMinting(true);
    setError(null);
    try {
      const r = await createMachineToken(label.trim() || 'New machine');
      setTokenValue(r.token);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setMinting(false);
    }
  }

  return (
    <div className="panel-overlay" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Connect a machine">
        <div className="panel-header">
          <h2>Connect a machine</h2>
          <button type="button" className="panel-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        {token ? (
          <>
            <p className="note">Run this on the other machine. The token is shown once — copy it now.</p>
            <pre className="code-block" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
              clai sync --server {window.location.origin} --token {token}
            </pre>
          </>
        ) : (
          <form className="stack" onSubmit={submit}>
            <p className="note">Mint a sync token for a CLI on another machine or server.</p>
            <div className="form-field">
              <label htmlFor="machine-label">Label</label>
              {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
              <input id="machine-label" type="text" autoFocus value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Jane's laptop" />
            </div>
            {error && <div className="token-error">{error}</div>}
            <button type="submit" className="btn btn-primary" disabled={minting}>
              {minting ? 'Minting…' : 'Create token'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
