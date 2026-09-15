import { useState, type FormEvent } from 'react';
import { sendSignInLink } from '../api';
import { TokenPrompt } from './TokenPrompt';

interface Props {
  /** Same handler App.tsx gives `TokenPrompt`: stash the pasted token, then re-check auth. */
  onTokenSubmit: () => void;
  tokenError?: string | null;
  /** Render just the card (inside the landing page) instead of a full-height centered screen. */
  embedded?: boolean;
}

type Mode = 'email' | 'sent' | 'token';

/** Hosted sign-in screen (`health.auth?.kind === 'supabase'`): email + magic link, replacing the bare token prompt. */
export function SignIn({ onTokenSubmit, tokenError, embedded = false }: Props) {
  const [mode, setMode] = useState<Mode>('email');
  const [email, setEmail] = useState('');
  const [tosAccepted, setTosAccepted] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (mode === 'token') {
    return (
      <TokenPrompt
        onSubmit={onTokenSubmit}
        error={tokenError}
        footer={
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMode('email')}>
            Back to sign in
          </button>
        }
      />
    );
  }

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    const v = email.trim();
    if (!v || !tosAccepted) return;
    setSending(true);
    setError(null);
    try {
      await sendSignInLink(v, true);
      setMode('sent');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  const card = (
      <div className="token-card">
        {!embedded && <h1>Sign in to clai</h1>}
        {mode === 'sent' ? (
          <>
            <p>
              Check your inbox — we sent a sign-in link to <strong>{email}</strong>. It expires in an hour.
            </p>
            <button type="button" className="btn btn-sm" onClick={() => setMode('email')}>
              Use a different email
            </button>
          </>
        ) : (
          <form className="stack" onSubmit={submit}>
            <p className="privacy-note">Hosted in the EU (Frankfurt); only usage metadata ever leaves your machine.</p>
            <div className="form-field">
              <label htmlFor="signin-email">Email</label>
              {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
              <input id="signin-email" type="email" autoFocus required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
            </div>
            <label className="flex gap-2" htmlFor="signin-tos" style={{ alignItems: 'flex-start', fontSize: 'var(--text-12)', color: 'var(--muted)' }}>
              <input id="signin-tos" type="checkbox" checked={tosAccepted} onChange={(e) => setTosAccepted(e.target.checked)} required style={{ marginTop: 3 }} />
              <span>
                I agree to the{' '}
                <a href="/legal/terms.html" target="_blank" rel="noreferrer">
                  Terms
                </a>{' '}
                and{' '}
                <a href="/legal/privacy.html" target="_blank" rel="noreferrer">
                  Privacy Policy
                </a>
                .
              </span>
            </label>
            {error && <div className="token-error">{error}</div>}
            <button type="submit" className="btn btn-primary" disabled={sending || !email.trim() || !tosAccepted}>
              {sending ? 'Sending…' : 'Send sign-in link'}
            </button>
          </form>
        )}
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMode('token')}>
          Have a token?
        </button>
      </div>
  );
  return embedded ? card : <div className="token-screen">{card}</div>;
}
