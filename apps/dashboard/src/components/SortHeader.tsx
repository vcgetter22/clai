interface SortHeaderProps {
  label: string;
  sortKeyName: string;
  activeKey: string;
  dir: 'asc' | 'desc';
  onSort: (key: string) => void;
  numeric?: boolean;
}

/** A clickable, keyboard-accessible `<th>` for sortable tables. */
export function SortHeader({ label, sortKeyName, activeKey, dir, onSort, numeric }: SortHeaderProps) {
  const active = sortKeyName === activeKey;
  return (
    <th className={numeric ? 'num' : undefined} aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className="sort-btn" onClick={() => onSort(sortKeyName)}>
        {label}
        {active && <span className="sort-arrow">{dir === 'asc' ? '▲' : '▼'}</span>}
      </button>
    </th>
  );
}
