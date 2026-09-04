export type Basis = 'billed' | 'computed' | 'estimated';

const TEXT: Record<Basis, string> = {
  billed: 'billed',
  computed: 'computed (API-equivalent)',
  estimated: 'estimated',
};

/** Every figure carries its basis. A figure without one is a bug. */
export function BasisLabel({ basis }: { basis: Basis }) {
  return <span className={`basis-label${basis === 'estimated' ? ' estimated' : ''}`}>{TEXT[basis]}</span>;
}
