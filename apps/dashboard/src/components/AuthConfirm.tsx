import { useEffect, useState } from 'react';
import { setRefreshToken, setToken, verifyAuthHash } from '../api';

interface Props {
  query: URLSearchParams;
  /** Called once the session is stored; App.tsx re-checks auth and then navigates to `#/`. */
  onVerified: () => void;
}

/** `#/auth/confirm?token_hash=...&type=...`: the landing page for the emailed sign-in link. */
export function AuthConfirm({ query, onVerified }: Props) {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const tokenHash = query.get('token_hash');
    const type = query.get('type');
    if (!tokenHash || !type) {
      setError('This sign-in link is missing its confirmation code. Copy the full link from the email.');
      return;
    }
    let cancelled = false;
    verifyAuthHash(tokenHash, type)
      .then(({ token, refreshToken }) => {
        if (cancelled) return;
        setToken(token);
        setRefreshToken(refreshToken);
        onVerified();
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
    // Runs once against the link's own params; onVerified is stable enough for a one-shot effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="token-screen">
      <div className="token-card">
        <h1>{error ? 'Sign-in link problem' : 'Signing in…'}</h1>
        {error ? (
          <>
            <p className="token-error">{error}</p>
            <a className="btn btn-primary" href="#/">
              Back to clai
            </a>
          </>
        ) : (
          <p className="muted">Confirming your sign-in link.</p>
        )}
      </div>
    </div>
  );
}
