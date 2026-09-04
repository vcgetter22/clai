import { useEffect, useRef, useState } from 'react';

interface AsyncState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  refetching: boolean;
}

/**
 * Minimal data-fetch hook. On refetch, keeps the previous `data` in place and just
 * flags `refetching` instead of clearing it — callers hold the prior render at
 * reduced opacity instead of flashing a skeleton (see dataviz interaction rules).
 */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refetching, setRefetching] = useState(false);
  const hadData = useRef(false);

  useEffect(() => {
    let cancelled = false;
    if (hadData.current) setRefetching(true);
    else setLoading(true);
    setError(null);
    fn()
      .then((res) => {
        if (cancelled) return;
        setData(res);
        hadData.current = true;
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
        setRefetching(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, error, loading, refetching };
}
