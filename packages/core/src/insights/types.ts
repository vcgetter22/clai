import type { PricingCatalog } from '../pricing/types.js';
import type { ProviderId, SourceId } from '../types.js';

export type InsightKind =
  | 'subscription_value'
  | 'forecast'
  | 'budget'
  | 'anomaly'
  | 'model_mix'
  | 'cache_efficiency'
  | 'context_size'
  | 'concentration'
  | 'expensive_session'
  | 'idle_seat'
  | 'unpriced_model'
  | 'long_context_premium'
  | 'batch_candidate';

export type InsightSeverity = 'info' | 'opportunity' | 'warning' | 'critical';

export interface Insight {
  id: string;
  kind: InsightKind;
  severity: InsightSeverity;
  title: string;
  detail: string;
  /** Estimated monthly USD impact (savings or overrun). Positive = money at stake. */
  impactUsdPerMonth?: number;
  /** Suggested next step, one sentence. */
  action?: string;
  /** Machine-readable evidence for the UI (numbers, keys). */
  evidence: Record<string, unknown>;
}

/** A subscription the user/org pays for, declared via `clai plan set` or the team settings. */
export interface DeclaredSubscription {
  id: string;
  provider: ProviderId;
  plan: string;
  label?: string;
  priceMonthly: number;
  seats?: number;
  /** Which usage counts toward this subscription. Default: same provider, billing=subscription. */
  appliesTo?: {
    sources?: SourceId[];
    actorKeys?: string[];
  };
}

export interface Budget {
  id: string;
  name: string;
  amountUsd: number;
  period: 'month';
  scope?: {
    provider?: ProviderId;
    source?: SourceId;
    project?: string;
    actorKey?: string;
  };
}

export interface Seat {
  actorKey: string;
  label?: string;
  provider: ProviderId;
  plan: string;
  priceMonthly: number;
}

export interface InsightContext {
  now: Date;
  timeZone: string;
  catalog: PricingCatalog;
  subscriptions: DeclaredSubscription[];
  budgets: Budget[];
  seats: Seat[];
}

export interface Forecast {
  month: string;
  daysElapsed: number;
  daysInMonth: number;
  mtdUsd: number;
  projectedUsd: number;
  avgDailyUsd: number;
  lastMonthUsd: number | null;
  /** Relative change vs last month, e.g. 0.12 = +12%. */
  deltaVsLastMonth: number | null;
  method: 'weekday-weighted' | 'run-rate' | 'insufficient-data';
  confidence: 'low' | 'medium' | 'high';
}
