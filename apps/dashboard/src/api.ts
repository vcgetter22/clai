/**
 * Typed API client. Talks to the real `/api/*` endpoints (same-origin — the CLI and
 * team server both serve the SPA and the API from one origin, and the dev proxy in
 * `vite.config.ts` forwards `/api` to the local server) or, in mock mode, to the
 * in-browser generator under `src/mock/`. Every exported function has the same
 * signature regardless of which backend answers it, so pages never branch on mode.
 */
import type {
  ActorsResponse, AuthLinkResponse, AuthVerifyResponse, Breakdown, Budget, CommonFilters, DeclaredSubscription, DeviceApproveResponse,
  EventsResponse, HealthResponse, InsightsResponse, MachineTokenResponse, ModelsResponse, ScanResponse, Seat, SessionsResponse,
  SettingsResponse, SummaryResponse, WhoamiResponse,
} from './types';
import { isMock, isMockHosted, isMockTeam } from './mock/flags';
import * as mock from './mock/engine';
import { triggerUnauthorized } from './authGate';

export { isMock, isMockTeam, isMockEmpty, isMockHosted } from './mock/flags';

const TOKEN_KEY = 'clai_token';
const REFRESH_KEY = 'clai_refresh';
const ORG_KEY = 'clai_org';

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore: localStorage may be unavailable (private mode, etc). Value just won't persist. */
  }
}
function removeStorage(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function getToken(): string | null {
  return readStorage(TOKEN_KEY);
}
export function setToken(token: string): void {
  writeStorage(TOKEN_KEY, token);
}
export function clearToken(): void {
  removeStorage(TOKEN_KEY);
}

export function getRefreshToken(): string | null {
  return readStorage(REFRESH_KEY);
}
export function setRefreshToken(token: string): void {
  writeStorage(REFRESH_KEY, token);
}
export function clearRefreshToken(): void {
  removeStorage(REFRESH_KEY);
}

/** Selected org id, sent as `x-clai-org`. Unset (or a single-org account) means "my default org". */
export function getOrg(): string | null {
  return readStorage(ORG_KEY);
}
export function setOrg(orgId: string): void {
  writeStorage(ORG_KEY, orgId);
}
export function clearOrg(): void {
  removeStorage(ORG_KEY);
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

async function realRequest<T>(path: string, params: Params = {}, init: RequestInit = {}, isRetry = false): Promise<T> {
  const token = getToken();
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const org = getOrg();
  if (org) headers.set('x-clai-org', org);
  if (init.body !== undefined && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const res = await fetch(`/api${path}${toQuery(params)}`, { ...init, headers });
  if (!res.ok) {
    // Hosted mode only: an expired access token is worth one silent refresh-and-retry before
    // giving up. `isRetry` caps this at one attempt even if the retry also comes back 401.
    if (res.status === 401 && !isRetry) {
      const refreshToken = getRefreshToken();
      if (refreshToken) {
        const refreshed = await tryRefresh(refreshToken);
        if (refreshed) return realRequest<T>(path, params, init, true);
      }
    }
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

/** Best-effort: true and the new tokens stored on success, false on any failure (network, non-200, bad body). */
async function tryRefresh(refreshToken: string): Promise<boolean> {
  try {
    const res = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as AuthVerifyResponse;
    setToken(body.token);
    setRefreshToken(body.refreshToken);
    return true;
  } catch {
    return false;
  }
}

/** Team and hosted mocks require a token, exactly like the real servers (whose auth middleware gates every route, including /health). */
function mockGate(): void {
  if ((isMockTeam() || isMockHosted()) && !getToken()) {
    triggerUnauthorized();
    throw new ApiError(401, 'Unauthorized: provide a clai token as Authorization: Bearer <token>');
  }
}

function filterParams(f: CommonFilters): Params {
  return { since: f.since, until: f.until, provider: f.provider, source: f.source, project: f.project, actor: f.actor, billing: f.billing, model: f.model };
}

export async function getHealth(): Promise<HealthResponse> {
  // /health is always public, even in team/hosted mode (real server and mock alike) — no mockGate:
  // it's how an unauthenticated caller learns whether to show the token prompt or the sign-in screen.
  if (isMock()) return mock.health();
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

// ------------------------------------------------------- hosted auth (docs/dashboard-api.md)
// These calls never go through `mockGate`: signing in is precisely what a caller without a
// token yet needs to do. `createMachineToken`/`approveDevice` do need one, like the real API.

/** Sign-in screen: "Send sign-in link". */
export async function sendSignInLink(email: string, tosAccepted: boolean): Promise<AuthLinkResponse> {
  if (isMock()) return mock.authLink(email, tosAccepted);
  return realRequest('/auth/link', {}, { method: 'POST', body: JSON.stringify({ email, tosAccepted }) });
}

/** `#/auth/confirm`: exchange the magic-link's `token_hash`/`type` for a session. */
export async function verifyAuthHash(tokenHash: string, type: string): Promise<AuthVerifyResponse> {
  if (isMock()) return mock.authVerify(tokenHash, type);
  return realRequest('/auth/verify', {}, { method: 'POST', body: JSON.stringify({ tokenHash, type }) });
}

/** `#/device`: "Approve this machine" for the CLI's device-code login. */
export async function approveDevice(userCode: string, orgId: string): Promise<DeviceApproveResponse> {
  if (isMock()) {
    mockGate();
    return mock.deviceApprove(userCode, orgId);
  }
  return realRequest('/auth/device/approve', {}, { method: 'POST', body: JSON.stringify({ userCode, orgId }) });
}

/** Header "Connect a machine" panel: mint a member token without going through the device flow. */
export async function createMachineToken(label: string): Promise<MachineTokenResponse> {
  if (isMock()) {
    mockGate();
    return mock.mintMachineToken(label);
  }
  return realRequest('/me/tokens', {}, { method: 'POST', body: JSON.stringify({ label }) });
}

/** Header "Sign out". Best-effort server call (revokes the refresh token); local state is always cleared. */
export async function logout(): Promise<void> {
  if (!isMock()) {
    try {
      await realRequest('/auth/logout', {}, { method: 'POST' });
    } catch {
      /* still clear local state below even if the network call failed */
    }
  }
  clearToken();
  clearRefreshToken();
  clearOrg();
}
