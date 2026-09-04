/**
 * Typed API client. Talks to the real `/api/*` endpoints (same-origin — the CLI and
 * team server both serve the SPA and the API from one origin, and the dev proxy in
 * `vite.config.ts` forwards `/api` to the local server) or, in mock mode, to the
 * in-browser generator under `src/mock/`. Every exported function has the same
 * signature regardless of which backend answers it, so pages never branch on mode.
 */
import type {
  ActorsResponse, Breakdown, Budget, CommonFilters, DeclaredSubscription, EventsResponse, HealthResponse,
  InsightsResponse, ModelsResponse, ScanResponse, Seat, SessionsResponse, SettingsResponse, SummaryResponse, WhoamiResponse,
} from './types';
import { isMock, isMockTeam } from './mock/flags';
import * as mock from './mock/engine';
import { triggerUnauthorized } from './authGate';

export { isMock, isMockTeam, isMockEmpty } from './mock/flags';

const TOKEN_KEY = 'clai_token';

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
export function setToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* ignore: localStorage may be unavailable (private mode, etc). Token just won't persist. */
  }
}
export function clearToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

type Params = Record<string, string | number | undefined>;

function toQuery(params: Params): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

async function realRequest<T>(path: string, params: Params = {}, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (init.body !== undefined && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const res = await fetch(`/api${path}${toQuery(params)}`, { ...init, headers });
  if (!res.ok) {
    let message = res.statusText || `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body && typeof body.error === 'string') message = body.error;
    } catch {
      /* body wasn't JSON; keep the status text */
    }
    if (res.status === 401) triggerUnauthorized();
    throw new ApiError(res.status, message);
  }
  return (await res.json()) as T;
}

/** Team-mode mock requires a token, exactly like the real team server (its auth middleware gates every route, including /health). */
function mockGate(): void {
  if (isMockTeam() && !getToken()) {
    triggerUnauthorized();
    throw new ApiError(401, 'Unauthorized: provide a clai token as Authorization: Bearer <token>');
  }
}

function filterParams(f: CommonFilters): Params {
  return { since: f.since, until: f.until, provider: f.provider, source: f.source, project: f.project, actor: f.actor, billing: f.billing, model: f.model };
}

export async function getHealth(): Promise<HealthResponse> {
  if (isMock()) {
    mockGate();
    return mock.health();
  }
  return realRequest<HealthResponse>('/health');
}

export async function getWhoami(): Promise<WhoamiResponse> {
  if (isMock()) {
    mockGate();
    return mock.whoami();
  }
  return realRequest<WhoamiResponse>('/whoami');
}

export async function getSummary(filters: CommonFilters): Promise<SummaryResponse> {
  if (isMock()) {
    mockGate();
    return mock.summary(filters);
  }
  return realRequest<SummaryResponse>('/summary', filterParams(filters));
}

export async function getBreakdown(dim: string, filters: CommonFilters, limit = 50): Promise<{ dim: string; rows: Breakdown[] }> {
  if (isMock()) {
    mockGate();
    return mock.breakdown(dim, filters, limit);
  }
  return realRequest('/breakdown', { ...filterParams(filters), dim, limit });
}

export async function getSessions(filters: CommonFilters, limit = 50): Promise<SessionsResponse> {
  if (isMock()) {
    mockGate();
    return mock.sessions(filters, limit);
  }
  return realRequest<SessionsResponse>('/sessions', { ...filterParams(filters), limit });
}

export async function getInsights(filters: CommonFilters): Promise<InsightsResponse> {
  if (isMock()) {
    mockGate();
    return mock.insights(filters);
  }
  return realRequest<InsightsResponse>('/insights', filterParams(filters));
}

export async function getEvents(filters: CommonFilters, limit = 100): Promise<EventsResponse> {
  if (isMock()) {
    mockGate();
    return mock.events(filters, limit);
  }
  return realRequest<EventsResponse>('/events', { ...filterParams(filters), limit });
}

export async function getModels(filters: CommonFilters): Promise<ModelsResponse> {
  if (isMock()) {
    mockGate();
    return mock.models(filters);
  }
  return realRequest<ModelsResponse>('/models', filterParams(filters));
}

export async function getSettings(): Promise<SettingsResponse> {
  if (isMock()) {
    mockGate();
    return mock.settings();
  }
  return realRequest<SettingsResponse>('/settings');
}

export async function getActors(filters: CommonFilters): Promise<ActorsResponse> {
  if (isMock()) {
    mockGate();
    return mock.actors(filters);
  }
  return realRequest<ActorsResponse>('/actors', filterParams(filters));
}

export async function addSubscription(body: Partial<DeclaredSubscription>): Promise<{ subscriptions: DeclaredSubscription[] }> {
  if (isMock()) {
    mockGate();
    return mock.addSubscription(body);
  }
  return realRequest('/settings/subscriptions', {}, { method: 'POST', body: JSON.stringify(body) });
}
export async function deleteSubscription(id: string): Promise<{ subscriptions: DeclaredSubscription[] }> {
  if (isMock()) {
    mockGate();
    return mock.removeSubscription(id);
  }
  return realRequest(`/settings/subscriptions/${encodeURIComponent(id)}`, {}, { method: 'DELETE' });
}
export async function addBudget(body: Partial<Budget>): Promise<{ budgets: Budget[] }> {
  if (isMock()) {
    mockGate();
    return mock.addBudget(body);
  }
  return realRequest('/settings/budgets', {}, { method: 'POST', body: JSON.stringify(body) });
}
export async function deleteBudget(id: string): Promise<{ budgets: Budget[] }> {
  if (isMock()) {
    mockGate();
    return mock.removeBudget(id);
  }
  return realRequest(`/settings/budgets/${encodeURIComponent(id)}`, {}, { method: 'DELETE' });
}
export async function addSeat(body: Partial<Seat>): Promise<{ seats: Seat[] }> {
  if (isMock()) {
    mockGate();
    return mock.addSeat(body);
  }
  return realRequest('/settings/seats', {}, { method: 'POST', body: JSON.stringify(body) });
}
export async function deleteSeat(actorKey: string): Promise<{ seats: Seat[] }> {
  if (isMock()) {
    mockGate();
    return mock.removeSeat(actorKey);
  }
  return realRequest(`/settings/seats/${encodeURIComponent(actorKey)}`, {}, { method: 'DELETE' });
}

export async function scan(): Promise<ScanResponse> {
  if (isMock()) {
    mockGate();
    return mock.scan();
  }
  return realRequest('/scan', {}, { method: 'POST' });
}
