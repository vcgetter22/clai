import { useMemo, useState } from 'react';

type Accessor<T> = (row: T) => number | string;

/** Generic client-side table sort. `accessors` maps a sort key name to a value getter. */
export function useSort<T>(rows: T[], defaultKey: string, defaultDir: 'asc' | 'desc', accessors: Record<string, Accessor<T>>) {
  const [sortKey, setSortKey] = useState(defaultKey);
  const [dir, setDir] = useState<'asc' | 'desc'>(defaultDir);

  const sorted = useMemo(() => {
    const acc = accessors[sortKey];
    if (!acc) return rows;
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = acc(a);
      const bv = acc(b);
      const cmp = typeof av === 'string' ? av.localeCompare(String(bv)) : (av as number) - (bv as number);
      return dir === 'asc' ? cmp : -cmp;
    });
    return copy;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sortKey, dir]);

  function toggle(key: string): void {
    if (key === sortKey) setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setDir('desc');
    }
  }

  return { sorted, sortKey, dir, toggle };
}
