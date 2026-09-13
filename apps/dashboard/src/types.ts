/**
 * Shapes mirrored from `docs/dashboard-api.md`. Kept local to the dashboard so it has
 * no build-time dependency on `@claii/core` — the SPA only ever sees these over HTTP
 * (or from the in-browser mock), so a plain structural copy is the right boundary.
 */

export type ProviderId = string;
export type SourceId = string;
export type Surface = 'api' | 'cli-agent' | 'ide' | 'chat' | 'batch' | 'unknown';
export type BillingMode = 'api' | 'subscription' | 'unknown';
export type CostConfidence = 'billed' | 'computed' | 'estimated' | 'none';
export type ModelTier = 'frontier' | 'mid' | 'small' | 'embedding' | 'other';

export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  reasoning?: number;
  requests: number;
  webSearches?: number;
  webFetches?: number;
}

export interface Breakdown {
  key: string;
  usd: number;
  computedUsd: number;
  billedUsd: number | null;
  events: number;
  usage: TokenUsage;
  share: number;
}

export interface Forecast {
  month: string;
  daysElapsed: number;
  daysInMonth: number;
  mtdUsd: number;
  projectedUsd: number;
  avgDailyUsd: number;
  lastMonthUsd: number | null;
  deltaVsLastMonth: number | null;
  method: 'weekday-weighted' | 'run-rate' | 'insufficient-data';
  confidence: 'low' | 'medium' | 'high';
}

export type InsightSeverity = 'info' | 'opportunity' | 'warning' | 'critical';

export interface Insight {
  id: string;
  kind: string;
  severity: InsightSeverity;
  title: string;
  detail: string;
  impactUsdPerMonth?: number;
  action?: string;
  evidence: Record<string, unknown>;
}

export interface DeclaredSubscription {
  id: string;
  provider: ProviderId;
  plan: string;
  label?: string;
  priceMonthly: number;
  seats?: number;
  appliesTo?: { sources?: SourceId[]; actorKeys?: string[] };
}

export interface Budget {
  id: string;
  name: string;
  amountUsd: number;
  period: 'month';
  scope?: { provider?: ProviderId; source?: SourceId; project?: string; actorKey?: string };
}

export interface Seat {
  actorKey: string;
  label?: string;
  provider: ProviderId;
  plan: string;
  priceMonthly: number;
}

export interface Session {
  sessionId: string;
  started: string;
  ended: string;
  project: string | null;
  source: SourceId;
  provider: ProviderId;
  models: string[];
  usd: number;
  events: number;
  usage: TokenUsage;
  maxContext: number;
}

export interface UsageEvent {
  id: string;
  ts: string;
  source: SourceId;
  provider: ProviderId;
  model: string;
  modelKey: string | null;
  surface: Surface;
  billing: BillingMode;
  plan?: string;
  granularity: string;
  actor: Record<string, string>;
  context: Record<string, unknown>;
  usage: TokenUsage;
  cost: { billedUsd: number | null; computedUsd: number | null; currency: 'USD'; confidence: CostConfidence };
}

export interface ModelCatalogEntry {
  key: string;
  displayName: string;
  provider: ProviderId;
  tier: ModelTier;
  input: number;
  output: number;
  cacheRead: number | null;
  cacheWrite5m: number | null;
  cacheWrite1h: number | null;
  contextWindow: number | null;
  verified: boolean;
  retired: string | null;
  usd: number;
  events: number;
  usage: TokenUsage;
}

export interface HealthResponse {
  ok: boolean;
  version: string;
  mode: 'local' | 'team';
  timeZone: string;
  /** Omitted by the team server: `/api/health` is public there and reveals no database stats without auth. */
  db?: { events: number; first: string | null; last: string | null };
  pricingVersion: string;
  authRequired: boolean;
  /** Hosted extensions (mock only via `?hosted=1`; see docs/dashboard-api.md). */
  auth?: { kind: 'token' | 'supabase' };
}

export interface SummaryResponse {
  range: { since: string | null; until: string | null; timeZone: string };
  totals: { usd: number; computedUsd: number; billedUsd: number | null; events: number; usage: TokenUsage };
  today: { usd: number; events: number };
  thisMonth: { usd: number; events: number };
  lastMonth: { usd: number; events: number };
  forecast: Forecast;
  byProvider: Breakdown[];
  byModel: Breakdown[];
  bySource: Breakdown[];
  byProject: Breakdown[];
  bySurface: Breakdown[];
  byBilling: Breakdown[];
  daily: { day: string; usd: number; events: number; byProvider: Record<string, number> }[];
  subscriptions: { subscription: DeclaredSubscription; mtdUsd: number; projectedUsd: number; lastMonthUsd: number; multiple: number }[];
  budgets: { budget: Budget; mtdUsd: number; projectedUsd: number; usedPct: number; projectedPct: number }[];
}

export interface BreakdownResponse {
  dim: string;
  rows: Breakdown[];
}

export interface SessionsResponse {
  sessions: Session[];
}

export interface InsightsResponse {
  insights: Insight[];
  generatedAt: string;
}

export interface EventsResponse {
  events: UsageEvent[];
}

export interface ModelsResponse {
  models: ModelCatalogEntry[];
}

export interface SourceInfo {
  source: SourceId;
  events: number;
  first: string | null;
  last: string | null;
}

export interface LastRun {
  source: SourceId;
  started_at: string;
  finished_at: string;
  events_seen: number;
  events_inserted: number;
  events_updated: number;
  unpriced: number;
  ok: number;
  error: string | null;
}

export interface PlanCatalogEntry {
  provider: ProviderId;
  plan: string;
  display: string;
  priceMonthly: number | null;
  seatBased: boolean;
}

export interface SettingsResponse {
  mode: 'local' | 'team';
  timeZone: string;
  pricingVersion: string;
  subscriptions: DeclaredSubscription[];
  budgets: Budget[];
  seats: Seat[];
  sources: SourceInfo[];
  lastRuns: LastRun[];
  plans: PlanCatalogEntry[];
}

export interface ActorsResponse {
  actors: {
    actorKey: string;
    actor: Record<string, unknown>;
    firstDay: string | null;
    lastDay: string | null;
    usd: number;
    events: number;
    usage: TokenUsage;
    seat: Seat | null;
  }[];
}

export interface WhoamiResponse {
  actorKey: string;
  role: 'admin' | 'member';
  label?: string;
  // Hosted extensions (served for real by a self-hosted clai-server too, with inert defaults;
  // mock via `?hosted=1`; see docs/dashboard-api.md "Hosted extensions").
  email?: string | null;
  orgId?: string | null;
  orgs?: { id: string; name: string }[];
  plan?: 'free' | 'plus' | 'team' | 'business' | 'self-hosted';
  billingStatus?: 'active' | 'past_due' | 'canceled' | null;
  upgradeUrl?: string | null;
  portalUrl?: string | null;
  tosAccepted?: boolean;
}

// ------------------------------------------------------- hosted auth (mock via `?mock=1&hosted=1`)

export interface AuthLinkResponse {
  sent: boolean;
}

export interface AuthVerifyResponse {
  token: string;
  refreshToken: string;
}

export interface DeviceApproveResponse {
  approved: boolean;
}

export interface MachineTokenResponse {
  token: string;
  actorKey: string;
  role: 'admin' | 'member';
}

export interface ScanResult {
  source: SourceId;
  seen: number;
  inserted: number;
  updated: number;
  unpriced: number;
  error: string | null;
}

export interface ScanResponse {
  results: ScanResult[];
}

/** Common list/detail query filters shared by most endpoints. */
export interface CommonFilters {
  since?: string;
  until?: string;
  provider?: string;
  source?: string;
  project?: string;
  actor?: string;
  billing?: string;
  model?: string;
}
