import { useEffect, useMemo, useState } from 'react';
import { ApiError, getBreakdown, getHealth, getWhoami, isMock } from './api';
import { onUnauthorized } from './authGate';
import { buildHash, currentRoute, isPageId, navigateTo, navigateToRoot, PAGE_LABELS, PAGES, type PageId, type Route } from './hash';
import type { CommonFilters, HealthResponse, WhoamiResponse } from './types';
import { AccountBar } from './components/AccountBar';
import { AuthConfirm } from './components/AuthConfirm';
import { DeviceApprove } from './components/DeviceApprove';
import { FilterBar } from './components/FilterBar';
import { SignIn } from './components/SignIn';
import { TokenPrompt } from './components/TokenPrompt';
import { Overview } from './pages/Overview';
import { Models } from './pages/Models';
import { Projects } from './pages/Projects';
import { People } from './pages/People';
import { Insights } from './pages/Insights';
import { Plans } from './pages/Plans';
import { Pricing } from './pages/Pricing';
import { Events } from './pages/Events';

function routeToFilters(query: URLSearchParams): CommonFilters {
  const f: CommonFilters = {};
  const since = query.get('since');
  if (since) f.since = since;
  const provider = query.get('provider');
  if (provider) f.provider = provider;
  const project = query.get('project');
  if (project) f.project = project;
  const billing = query.get('billing');
  if (billing) f.billing = billing;
  return f;
}

function filtersToQuery(f: CommonFilters): URLSearchParams {
  const q = new URLSearchParams();
  if (f.since) q.set('since', f.since);
  if (f.provider) q.set('provider', f.provider);
  if (f.project) q.set('project', f.project);
  if (f.billing) q.set('billing', f.billing);
  return q;
}

export default function App() {
  const [route, setRoute] = useState<Route>(() => currentRoute());
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [whoami, setWhoami] = useState<WhoamiResponse | null>(null);
  const [needsToken, setNeedsToken] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  const [authAttempted, setAuthAttempted] = useState(false);
  const [projects, setProjects] = useState<string[]>([]);
  const [bootTick, setBootTick] = useState(0);

  useEffect(() => {
    function onHash(): void {
      setRoute(currentRoute());
    }
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => onUnauthorized(() => setNeedsToken(true)), []);

  useEffect(() => {
    let cancelled = false;
    setBootError(null);
    // `/health` and `/whoami` are fetched independently, not via Promise.all: `/health` is always
    // public (even in team/hosted mode) and its `auth.kind` decides whether an unauthenticated
    // caller sees the plain TokenPrompt or the hosted SignIn screen, so it must be captured even
    // when `/whoami` 401s.
    getHealth()
      .then((h) => {
        if (cancelled) return;
        setHealth(h);
        return getWhoami()
          .then((w) => {
            if (cancelled) return;
            setWhoami(w);
            setNeedsToken(false);
          })
          .catch((e: unknown) => {
            if (cancelled) return;
            if (e instanceof ApiError && e.status === 401) setNeedsToken(true);
            else setBootError(e instanceof Error ? e.message : String(e));
          });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setBootError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [bootTick]);

  useEffect(() => {
    if (!health) return;
    let cancelled = false;
    getBreakdown('project', { since: 'all' }, 200)
      .then((r) => {
        if (cancelled) return;
        setProjects(r.rows.map((x) => x.key).filter((k) => k !== '(none)'));
      })
      .catch(() => {
        /* project list is a filter convenience, not critical */
      });
    return () => {
      cancelled = true;
    };
  }, [health]);

  const filters = useMemo(() => routeToFilters(route.query), [route.query]);

  function updateFilters(next: CommonFilters): void {
    const q = filtersToQuery(next);
    navigateTo(route.page, q);
    setRoute({ page: route.page, query: q });
  }

  function handleTokenSubmit(): void {
    setAuthAttempted(true);
    setBootTick((t) => t + 1);
  }

  // The magic-link landing page runs regardless of auth state — establishing it is its whole job.
  if (route.page === 'auth/confirm') {
    return (
      <AuthConfirm
        query={route.query}
        onVerified={() => {
          setNeedsToken(false);
          setBootTick((t) => t + 1);
          navigateToRoot();
        }}
      />
    );
  }

  if (needsToken) {
    const tokenError = authAttempted ? 'That token was not accepted. Check it and try again.' : null;
    return health?.auth?.kind === 'supabase' ? <SignIn onTokenSubmit={handleTokenSubmit} tokenError={tokenError} /> : <TokenPrompt error={tokenError} onSubmit={handleTokenSubmit} />;
  }

  if (bootError) {
    return (
      <div className="token-screen">
        <div className="token-card">
          <h1>clai dashboard couldn&apos;t load</h1>
          <p>{bootError}</p>
          <button type="button" className="btn btn-primary" onClick={() => setBootTick((t) => t + 1)}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!health) {
    return <div className="loading-note" style={{ padding: 24 }}>Loading clai…</div>;
  }

  // `clai login`'s device flow sends a signed-in browser here to approve a new machine.
  if (route.page === 'device' && health.auth?.kind === 'supabase') {
    if (!whoami) return <div className="loading-note" style={{ padding: 24 }}>Loading clai…</div>;
    return <DeviceApprove userCode={route.query.get('code')} whoami={whoami} />;
  }

  // Team mode's /api/health is public and carries no db stats (no auth => no counts leaked);
  // without them we can't tell an empty server from a full one, so don't claim it's empty.
  const emptyDb = health.db ? health.db.events === 0 : false;
  const pageForRender: PageId = isPageId(route.page) ? route.page : 'overview';

  return (
    <div className="shell">
      <header className="topbar">
        <a className="brand" href="#/overview" aria-label="clai overview">
          <span className="wordmark">clai</span>
          <svg className="tally" width="14" height="16" viewBox="0 0 36 40" aria-hidden="true">
            <line x1="5" y1="6" x2="5" y2="34" />
            <line x1="13" y1="6" x2="13" y2="34" />
            <line x1="21" y1="6" x2="21" y2="34" />
            <line x1="29" y1="6" x2="29" y2="34" />
            <line x1="1" y1="32" x2="34" y2="8" />
          </svg>
        </a>
        <nav className="nav" aria-label="Primary">
          {PAGES.map((p) => (
            <a key={p} href={buildHash(p, route.query)} className={`nav-link${route.page === p ? ' active' : ''}`} aria-current={route.page === p ? 'page' : undefined}>
              {PAGE_LABELS[p]}
            </a>
          ))}
        </nav>
        <div className="topbar-right">
          <span className="privacy-line">{health.mode === 'team' ? 'team · usage metadata only leaves this machine' : 'local · nothing leaves this machine'}</span>
          {whoami && (health.auth?.kind === 'supabase' ? <AccountBar whoami={whoami} /> : health.mode === 'team' && <span className="whoami">{whoami.label || whoami.actorKey}</span>)}
        </div>
      </header>

      <FilterBar filters={filters} onChange={updateFilters} projects={projects} mock={isMock()} timeZone={health.timeZone} />

      <main className="page-outlet">{renderPage(pageForRender, filters, health, emptyDb, filtersToQuery)}</main>
    </div>
  );
}

function renderPage(page: PageId, filters: CommonFilters, health: HealthResponse, emptyDb: boolean, filtersToQuery: (f: CommonFilters) => URLSearchParams) {
  switch (page) {
    case 'overview':
      return <Overview filters={filters} health={health} emptyDb={emptyDb} filtersToQuery={filtersToQuery} />;
    case 'models':
      return <Models filters={filters} emptyDb={emptyDb} />;
    case 'projects':
      return <Projects filters={filters} health={health} emptyDb={emptyDb} />;
    case 'people':
      return <People filters={filters} health={health} emptyDb={emptyDb} />;
    case 'insights':
      return <Insights filters={filters} emptyDb={emptyDb} />;
    case 'plans':
      return <Plans health={health} />;
    case 'pricing':
      return <Pricing />;
    case 'events':
      return <Events filters={filters} health={health} emptyDb={emptyDb} />;
    default:
      return <Overview filters={filters} health={health} emptyDb={emptyDb} filtersToQuery={filtersToQuery} />;
  }
}
