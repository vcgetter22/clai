import { useState } from 'react';
import { approveDevice } from '../api';
import type { WhoamiResponse } from '../types';

interface Props {
  userCode: string | null;
  whoami: WhoamiResponse;
}

type Status = 'idle' | 'approving' | 'approved' | 'denied';

/** `#/device?code=...`: where `clai login`'s device flow sends a signed-in browser to approve a new machine. */
export function DeviceApprove({ userCode, whoami }: Props) {
  const orgs = whoami.orgs ?? [];
  const [orgId, setOrgId] = useState(whoami.orgId ?? orgs[0]?.id ?? '');
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);

  if (!userCode) {
    return (
      <div className="token-screen">
        <div className="token-card">
          <h1>Connect a machine</h1>
          <p>This link is missing its code. Go back to the terminal and copy the URL clai printed, or run `clai login` again.</p>
        </div>
      </div>
    );
  }

  async function approve(): Promise<void> {
    setStatus('approving');
    setError(null);
    try {
      await approveDevice(userCode!, orgId);
      setStatus('approved');
    } catch (e) {
      setStatus('denied');
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="token-screen">
      <div className="token-card">
        <h1>Connect a machine</h1>
        {status === 'approved' && <p>Machine approved. You can close this tab — <code>clai sync</code> will start working on that machine.</p>}
        {status === 'denied' && (
          <>
            <p className="token-error">{error ?? 'This code was not approved. It may have expired or already been used.'}</p>
            <p className="muted">Run `clai login` again on that machine to get a fresh code.</p>
          </>
        )}
        {(status === 'idle' || status === 'approving') && (
          <>
            <p>A clai CLI is waiting to sign in with the code below.</p>
            <div className="code-block" style={{ textAlign: 'center', fontSize: 'var(--text-20)', letterSpacing: '0.08em' }}>
              {userCode}
            </div>
            {orgs.length > 1 && (
              <div className="form-field">
                <label htmlFor="device-org">Organization</label>
                <select id="device-org" value={orgId} onChange={(e) => setOrgId(e.target.value)}>
                  {orgs.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <button type="button" className="btn btn-primary" onClick={() => void approve()} disabled={status === 'approving'}>
              {status === 'approving' ? 'Approving…' : 'Approve this machine'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
