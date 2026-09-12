import type {
  AggRow,
  BillingMode,
  Budget,
  DeclaredSubscription,
  PricingCatalog,
  ProviderId,
  Seat,
  SourceId,
  Surface,
  TokenUsage,
  UsageEvent,
} from '@claii/core';

export interface EventFilter {
  /** ISO lower bound (inclusive) on ts. */
  since?: string | null;
  /** ISO upper bound (exclusive) on ts. */
  until?: string | null;
  /** Local day key lower bound (inclusive). Prefer over `since` for calendar reports. */
  fromDay?: string;
  toDay?: string;
  provider?: ProviderId | ProviderId[];
  source?: SourceId | SourceId[];
  project?: string;
  actorKey?: string;
  sessionId?: string;
  billing?: BillingMode;
  surface?: Surface;
  model?: string;
}

export interface StoreOptions {
  timeZone?: string;
  readonly?: boolean;
}

export interface UpsertResult {
  inserted: number;
  updated: number;
  unchanged: number;
  /** Dropped for exceeding a retention window. Additive; always 0 for `SqliteEventStore`. */
  dropped: number;
}

/** A scalar value out of a backing SQL row, without pulling in a driver-specific type. */
export type SqlValue = string | number | null;

export type Role = 'admin' | 'member';

export interface TokenInfo {
  actorKey: string;
  role: Role;
  label: string | null;
  expiresAt: string | null;
  lastUsedAt: string | null;
}

export interface InsertTokenInput {
  tokenHash: string;
  actorKey: string;
  role: Role;
  label?: string | null;
  expiresAt?: string | null;
}

export interface TokenListItem {
  tokenHash: string;
  actorKey: string;
  role: Role;
  label: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  expiresAt: string | null;
}

export interface MemberInfo {
  actorKey: string;
  displayName: string | null;
  team: string | null;
  role: Role;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertMemberInput {
  actorKey: string;
  displayName?: string | null;
  team?: string | null;
  role: Role;
}

export interface TotalsRow {
  key: string;
  usage: TokenUsage;
  computedUsd: number;
  billedUsd: number | null;
  usd: number;
  events: number;
  maxContext: number;
}

export interface TotalRow {
  usage: TokenUsage;
  computedUsd: number;
  billedUsd: number | null;
  usd: number;
  events: number;
}

export interface SessionRow {
  sessionId: string;
  started: string;
  ended: string;
  project: string | null;
  source: SourceId;
  provider: ProviderId;
  models: string[];
  usage: TokenUsage;
  usd: number;
  events: number;
  maxContext: number;
}

export interface SourceRow {
  source: SourceId;
  events: number;
  first: string;
  last: string;
}

export interface ActorRow {
  actorKey: string;
  actor: UsageEvent['actor'];
  firstDay: string;
  lastDay: string;
  usage: TokenUsage;
  usd: number;
  events: number;
}

/**
 * The one storage abstraction every clai surface (CLI, local dashboard, team server, hosted
 * service) talks to. Every method is async so a Postgres-backed implementation (the hosted
 * service) is a drop-in: a `T | Promise<T>` signature would compile against SQLite and only
 * fail, silently, against a backend that actually awaits. `timeZone` is the one exception: a
 * synchronous property fixed at construction (SQLite reads it from `settings` once; the hosted
 * adapter receives it per request). There is no `db` here — that stays a `SqliteEventStore`-only
 * field for `clai ask`, which is local-only by decision.
 */
export interface EventStore {
  readonly timeZone: string;

  close(): Promise<void>;

  // ------------------------------------------------------------ meta/settings
  getSetting(key: string): Promise<string | undefined>;
  setSetting(key: string, value: string): Promise<void>;
  getJsonSetting<T>(key: string): Promise<T | undefined>;
  setJsonSetting(key: string, value: unknown): Promise<void>;
  allSettings(): Promise<Record<string, string>>;

  // ----------------------------------------------------------- source state
  getState(source: string, key: string): Promise<string | undefined>;
  setState(source: string, key: string, value: string): Promise<void>;
  clearState(source: string): Promise<void>;
  /** Snapshot of every stored key for a source, read once so a scan/pull can use a synchronous `StateStore`. */
  loadState(source: string): Promise<Map<string, string>>;
  /** Persist changed keys from a `loadState` snapshot in one call. */
  saveState(source: string, values: Record<string, string>): Promise<void>;

  // ------------------------------------------------------------------ events
  upsertEvents(events: Iterable<UsageEvent>, origin?: string): Promise<UpsertResult>;
  countEvents(filter?: EventFilter): Promise<number>;
  /** Earliest and latest event timestamps. */
  span(filter?: EventFilter): Promise<{ first: string | null; last: string | null }>;
  /** The aggregate rows consumed by the insights engine and reports. */
  rows(filter?: EventFilter, opts?: { bySession?: boolean }): Promise<AggRow[]>;
  /** Totals grouped by one dimension. */
  totalsBy(
    dim: 'day' | 'month' | 'provider' | 'model' | 'source' | 'project' | 'actor_key' | 'surface' | 'billing' | 'plan' | 'session_id',
    filter?: EventFilter,
    limit?: number,
  ): Promise<TotalsRow[]>;
  /** Grand total for a filter. */
  total(filter?: EventFilter): Promise<TotalRow>;
  /** Session list with cost, ordered by cost. */
  sessions(filter?: EventFilter, limit?: number): Promise<SessionRow[]>;
  /** Raw events (most recent first). */
  listEvents(filter?: EventFilter, limit?: number): Promise<UsageEvent[]>;
  iterateEvents(filter?: EventFilter): AsyncGenerator<UsageEvent>;
  /** Recompute computed costs with a new catalog (after `clai pricing update`). Returns number of changed rows. */
  repriceAll(catalog: PricingCatalog): Promise<number>;
  /** Recompute the local `day` column after a timezone change. */
  recomputeDays(timeZone: string): Promise<void>;
  deleteSource(source: SourceId): Promise<number>;

  // ---------------------------------------------------- subscriptions etc.
  listSubscriptions(): Promise<DeclaredSubscription[]>;
  putSubscription(sub: DeclaredSubscription): Promise<void>;
  deleteSubscription(id: string): Promise<boolean>;
  listBudgets(): Promise<Budget[]>;
  putBudget(b: Budget): Promise<void>;
  deleteBudget(id: string): Promise<boolean>;
  listSeats(): Promise<Seat[]>;
  putSeat(s: Seat): Promise<void>;
  deleteSeat(actorKey: string): Promise<boolean>;

  // ------------------------------------------------------------ ingest runs
  startRun(source: string): Promise<number>;
  finishRun(id: number, stats: { seen: number; inserted: number; updated: number; unpriced: number; error?: string }): Promise<void>;
  lastRuns(limit?: number): Promise<Record<string, SqlValue>[]>;
  /** Distinct sources with counts and last event time. */
  sources(): Promise<SourceRow[]>;
  /** Distinct actors with last activity (team views). */
  actors(filter?: EventFilter): Promise<ActorRow[]>;

  // --------------------------------------------------------- team: tokens/members
  countActiveTokens(): Promise<number>;
  lookupToken(tokenHash: string): Promise<TokenInfo | null>;
  /** Bump `lastUsedAt`, throttled to at most one write per 5 minutes per token. */
  touchToken(tokenHash: string): Promise<void>;
  insertToken(input: InsertTokenInput): Promise<void>;
  listTokens(): Promise<TokenListItem[]>;
  revokeToken(tokenHash: string): Promise<void>;
  listMembers(): Promise<MemberInfo[]>;
  upsertMember(input: UpsertMemberInput): Promise<void>;
}
