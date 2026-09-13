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

/** Routes outside the main nav: entered from an emailed link or a URL `clai login` opens, never from in-app navigation. */
export const SPECIAL_ROUTES = ['auth/confirm', 'device'] as const;
export type SpecialRouteId = (typeof SPECIAL_ROUTES)[number];
export type RouteId = PageId | SpecialRouteId;

export interface Route {
  page: RouteId;
  query: URLSearchParams;
}

export function isPageId(s: string): s is PageId {
  return (PAGES as readonly string[]).includes(s);
}

export function isSpecialRoute(s: string): s is SpecialRouteId {
  return (SPECIAL_ROUTES as readonly string[]).includes(s);
}

export function parseHash(hash: string): Route {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  const qIdx = raw.indexOf('?');
  const pathPart = (qIdx === -1 ? raw : raw.slice(0, qIdx)).replace(/^\//, '');
  const queryPart = qIdx === -1 ? '' : raw.slice(qIdx + 1);
  const page: RouteId = isPageId(pathPart) ? pathPart : isSpecialRoute(pathPart) ? pathPart : 'overview';
  return { page, query: new URLSearchParams(queryPart) };
}

export function buildHash(page: RouteId, query: URLSearchParams): string {
  // Keep the hash tidy: drop empty values before serializing.
  const clean = new URLSearchParams();
  for (const [k, v] of query.entries()) {
    if (v !== '' && v !== undefined && v !== null) clean.set(k, v);
  }
  const qs = clean.toString();
  return `#/${page}${qs ? `?${qs}` : ''}`;
}

export function navigateTo(page: RouteId, query: URLSearchParams): void {
  const next = buildHash(page, query);
  if (`${window.location.hash}` !== next) {
    window.location.hash = next;
  }
}

/** After `#/auth/confirm` finishes: drop straight to the overview with no leftover query string. */
export function navigateToRoot(): void {
  window.location.hash = '#/';
}

export function currentRoute(): Route {
  return parseHash(window.location.hash);
}
