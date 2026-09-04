import type { ProviderId } from '../types.js';

/** Prices are USD per 1,000,000 tokens unless stated otherwise. */
export interface LongContextPrice {
  /** Requests whose total input context exceeds this many tokens are billed at these rates. */
  threshold: number;
  input: number;
  output: number;
  cacheRead?: number | null;
  cacheWrite5m?: number | null;
  cacheWrite1h?: number | null;
}

export type ModelTier = 'frontier' | 'mid' | 'small' | 'embedding' | 'other';

export interface ModelPrice {
  provider: ProviderId;
  /** Canonical id, e.g. `claude-opus-5`, `gpt-5`, `gemini-2.5-pro`. */
  id: string;
  aliases: string[];
  displayName: string;
  family: string;
  /** Tier label used by insights. */
  tier: ModelTier;
  input: number;
  output: number;
  /** Cache read / cached-input price. null => derive via provider rule. */
  cacheRead: number | null;
  cacheWrite5m: number | null;
  cacheWrite1h: number | null;
  batchMultiplier: number | null;
  longContext: LongContextPrice | null;
  contextWindow: number | null;
  maxOutput: number | null;
  released?: string | null;
  deprecated?: string | null;
  retired?: string | null;
  verified: boolean;
  source?: string;
  note?: string;
}

export interface NonTokenPrice {
  provider: ProviderId;
  item: 'web_search' | 'web_fetch' | 'code_execution' | 'file_search' | 'image_generation' | string;
  unit: 'per_1000_requests' | 'per_1000_calls' | 'per_container_hour' | 'per_image' | 'per_gb_day' | string;
  price: number;
  source?: string;
}

export interface SubscriptionPlan {
  provider: ProviderId;
  /** Plan key, e.g. `pro`, `max_5x`, `max_20x`, `team_standard`, `plus`, `business`, `teams`. */
  plan: string;
  display: string;
  priceMonthly: number | null;
  priceAnnualMonthlyEquiv?: number | null;
  seatBased: boolean;
  minSeats?: number | null;
  /** Which surfaces the plan covers (informational). */
  includes: string[];
  limitsNote?: string;
  source?: string;
  verified: boolean;
}

export interface ProviderRules {
  cacheWrite5mMultiplier?: number;
  cacheWrite1hMultiplier?: number;
  cacheReadMultiplier?: number;
  batchDiscount?: number;
  notes?: string;
}

export interface PricingCatalog {
  version: string;
  generatedAt: string;
  models: ModelPrice[];
  nonToken: NonTokenPrice[];
  subscriptions: SubscriptionPlan[];
  rules: Partial<Record<ProviderId, ProviderRules>>;
}
