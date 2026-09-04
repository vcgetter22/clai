import { useState } from 'react';
import { setToken } from '../api';

interface Props {
  onSubmit: () => void;
  error?: string | null;
}

/** Blocking full-screen gate shown whenever the API answers 401 — team mode requires a bearer token. */
export function TokenPrompt({ onSubmit, error }: Props) {
  const [value, setValue] = useState('');

  return (
    <div className="token-screen">
      <form
        className="token-card"
        onSubmit={(e) => {
          e.preventDefault();
          const v = value.trim();
          if (!v) return;
          setToken(v);
          onSubmit();
        }}
      >
        <h1>Sign in to clai</h1>
        <p>
          This dashboard is running in team mode. Paste the access token your admin gave you — it&apos;s stored only in this browser&apos;s local storage and sent as{' '}
          <code>Authorization: Bearer …</code>.
        </p>
        <div className="form-field">
          <label htmlFor="clai-token">Access token</label>
          {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
          <input id="clai-token" type="text" autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder="clai_mem_…" autoComplete="off" spellCheck={false} />
        </div>
        {error && <div className="token-error">{error}</div>}
        <button type="submit" className="btn btn-primary" disabled={!value.trim()}>
          Continue
        </button>
      </form>
    </div>
  );
}
