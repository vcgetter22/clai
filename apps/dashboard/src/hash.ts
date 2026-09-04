/** Hash-based routing. No router dependency: `#/<page>?<query>`. */

export const PAGES = ['overview', 'models', 'projects', 'people', 'insights', 'plans', 'pricing', 'events'] as const;
export type PageId = (typeof PAGES)[number];

export const PAGE_LABELS: Record<PageId, string> = {
  overview: 'Overview',
  models: 'Models',
  projects: 'Projects & Sessions',
  people: 'People',
  insights: 'Insights',
  plans: 'Plans & Budgets',
  pricing: 'Pricing',
  events: 'Events',
};

export interface Route {
  page: PageId;
  query: URLSearchParams;
}

export function isPageId(s: string): s is PageId {
  return (PAGES as readonly string[]).includes(s);
}

export function parseHash(hash: string): Route {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  const qIdx = raw.indexOf('?');
  const pathPart = (qIdx === -1 ? raw : raw.slice(0, qIdx)).replace(/^\//, '');
  const queryPart = qIdx === -1 ? '' : raw.slice(qIdx + 1);
  const page = isPageId(pathPart) ? pathPart : 'overview';
  return { page, query: new URLSearchParams(queryPart) };
}

export function buildHash(page: PageId, query: URLSearchParams): string {
  // Keep the hash tidy: drop empty values before serializing.
  const clean = new URLSearchParams();
  for (const [k, v] of query.entries()) {
    if (v !== '' && v !== undefined && v !== null) clean.set(k, v);
  }
  const qs = clean.toString();
  return `#/${page}${qs ? `?${qs}` : ''}`;
}

export function navigateTo(page: PageId, query: URLSearchParams): void {
  const next = buildHash(page, query);
  if (`${window.location.hash}` !== next) {
    window.location.hash = next;
  }
}

export function currentRoute(): Route {
  return parseHash(window.location.hash);
}
