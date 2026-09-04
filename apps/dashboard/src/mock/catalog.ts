import type { ModelTier, PlanCatalogEntry } from '../types';

/**
 * A representative slice of clai's real pricing catalog (USD per 1M tokens), copied
 * faithfully from `packages/core/src/pricing/catalog.ts` so the mock's numbers match
 * the product's actual price list. The five models named in the mock spec
 * (claude-opus-5, claude-sonnet-5, claude-haiku-4-5, gpt-5-codex, gemini-2.5-flash)
 * carry all of the generated usage; the rest are zero-usage catalog rows so the
 * Pricing reference page has a realistic, browsable list (including a couple of
 * retired models and the verified/unverified split that's true of the real catalog:
 * every Anthropic row is vendor-verified, every OpenAI/Google row here isn't yet).
 */
export interface MockModelPrice {
  provider: string;
  id: string;
  displayName: string;
  tier: ModelTier;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  contextWindow: number;
  maxOutput: number;
  verified: boolean;
  retired: string | null;
}

const A = 'anthropic';
const O = 'openai';
const G = 'google';

export const MODEL_CATALOG: MockModelPrice[] = [
  // Anthropic — active
  { provider: A, id: 'claude-opus-5', displayName: 'Claude Opus 5', tier: 'frontier', input: 5, output: 25, cacheRead: 0.5, cacheWrite5m: 6.25, cacheWrite1h: 10, contextWindow: 1_000_000, maxOutput: 128_000, verified: true, retired: null },
  { provider: A, id: 'claude-sonnet-5', displayName: 'Claude Sonnet 5', tier: 'mid', input: 2, output: 10, cacheRead: 0.2, cacheWrite5m: 2.5, cacheWrite1h: 4, contextWindow: 1_000_000, maxOutput: 128_000, verified: true, retired: null },
  { provider: A, id: 'claude-haiku-4-5', displayName: 'Claude Haiku 4.5', tier: 'small', input: 1, output: 5, cacheRead: 0.1, cacheWrite5m: 1.25, cacheWrite1h: 2, contextWindow: 200_000, maxOutput: 64_000, verified: true, retired: null },
  // Anthropic — retired (still shown for reference; no usage)
  { provider: A, id: 'claude-opus-4-1', displayName: 'Claude Opus 4.1', tier: 'frontier', input: 15, output: 75, cacheRead: 1.5, cacheWrite5m: 18.75, cacheWrite1h: 30, contextWindow: 200_000, maxOutput: 32_000, verified: true, retired: '2026-08-05' },
  { provider: A, id: 'claude-sonnet-4', displayName: 'Claude Sonnet 4', tier: 'mid', input: 3, output: 15, cacheRead: 0.3, cacheWrite5m: 3.75, cacheWrite1h: 6, contextWindow: 200_000, maxOutput: 64_000, verified: true, retired: '2026-09-01' },
  { provider: A, id: 'claude-3-5-haiku', displayName: 'Claude Haiku 3.5', tier: 'small', input: 0.8, output: 4, cacheRead: 0.08, cacheWrite5m: 1, cacheWrite1h: 1.6, contextWindow: 200_000, maxOutput: 8_192, verified: true, retired: '2026-02-19' },
  // OpenAI — active, catalog not yet vendor-verified
  { provider: O, id: 'gpt-5-codex', displayName: 'GPT-5-Codex', tier: 'frontier', input: 1.25, output: 10, cacheRead: 0.125, cacheWrite5m: 1.25, cacheWrite1h: 1.25, contextWindow: 400_000, maxOutput: 128_000, verified: false, retired: null },
  { provider: O, id: 'gpt-5', displayName: 'GPT-5', tier: 'frontier', input: 1.25, output: 10, cacheRead: 0.125, cacheWrite5m: 1.25, cacheWrite1h: 1.25, contextWindow: 400_000, maxOutput: 128_000, verified: false, retired: null },
  { provider: O, id: 'gpt-5-mini', displayName: 'GPT-5 mini', tier: 'mid', input: 0.25, output: 2, cacheRead: 0.025, cacheWrite5m: 0.25, cacheWrite1h: 0.25, contextWindow: 400_000, maxOutput: 128_000, verified: false, retired: null },
  { provider: O, id: 'gpt-4o', displayName: 'GPT-4o', tier: 'mid', input: 2.5, output: 10, cacheRead: 1.25, cacheWrite5m: 2.5, cacheWrite1h: 2.5, contextWindow: 128_000, maxOutput: 16_384, verified: false, retired: null },
  { provider: O, id: 'gpt-4o-mini', displayName: 'GPT-4o mini', tier: 'small', input: 0.15, output: 0.6, cacheRead: 0.075, cacheWrite5m: 0.15, cacheWrite1h: 0.15, contextWindow: 128_000, maxOutput: 16_384, verified: false, retired: null },
  // Google — active, catalog not yet vendor-verified
  { provider: G, id: 'gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', tier: 'mid', input: 0.3, output: 2.5, cacheRead: 0.03, cacheWrite5m: 0.3, cacheWrite1h: 0.3, contextWindow: 1_048_576, maxOutput: 65_536, verified: false, retired: null },
  { provider: G, id: 'gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', tier: 'frontier', input: 1.25, output: 10, cacheRead: 0.31, cacheWrite5m: 1.25, cacheWrite1h: 1.25, contextWindow: 1_048_576, maxOutput: 65_536, verified: false, retired: null },
  { provider: G, id: 'gemini-2.5-flash-lite', displayName: 'Gemini 2.5 Flash-Lite', tier: 'small', input: 0.1, output: 0.4, cacheRead: 0.01, cacheWrite5m: 0.1, cacheWrite1h: 0.1, contextWindow: 1_048_576, maxOutput: 65_536, verified: false, retired: null },
  { provider: G, id: 'gemini-2.0-flash', displayName: 'Gemini 2.0 Flash', tier: 'small', input: 0.1, output: 0.4, cacheRead: 0.025, cacheWrite5m: 0.1, cacheWrite1h: 0.1, contextWindow: 1_048_576, maxOutput: 8_192, verified: false, retired: null },
];

export const ACTIVE_MODEL_KEYS = ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5', 'gpt-5-codex', 'gemini-2.5-flash'];

export function findModel(id: string): MockModelPrice {
  const m = MODEL_CATALOG.find((x) => x.id === id);
  if (!m) throw new Error(`Unknown mock model ${id}`);
  return m;
}

export const PLAN_CATALOG: PlanCatalogEntry[] = [
  { provider: A, plan: 'free', display: 'Claude Free', priceMonthly: 0, seatBased: false },
  { provider: A, plan: 'pro', display: 'Claude Pro', priceMonthly: 20, seatBased: false },
  { provider: A, plan: 'max_5x', display: 'Claude Max 5x', priceMonthly: 100, seatBased: false },
  { provider: A, plan: 'max_20x', display: 'Claude Max 20x', priceMonthly: 200, seatBased: false },
  { provider: A, plan: 'team_standard', display: 'Claude Team (standard seat)', priceMonthly: 25, seatBased: true },
  { provider: A, plan: 'team_premium', display: 'Claude Team (premium seat)', priceMonthly: 125, seatBased: true },
  { provider: O, plan: 'free', display: 'ChatGPT Free', priceMonthly: 0, seatBased: false },
  { provider: O, plan: 'plus', display: 'ChatGPT Plus', priceMonthly: 20, seatBased: false },
  { provider: O, plan: 'pro', display: 'ChatGPT Pro', priceMonthly: 200, seatBased: false },
  { provider: O, plan: 'business', display: 'ChatGPT Business', priceMonthly: 30, seatBased: true },
  { provider: G, plan: 'ai_pro', display: 'Google AI Pro', priceMonthly: 19.99, seatBased: false },
  { provider: G, plan: 'ai_ultra', display: 'Google AI Ultra', priceMonthly: 249.99, seatBased: false },
  { provider: 'cursor', plan: 'pro', display: 'Cursor Pro', priceMonthly: 20, seatBased: false },
  { provider: 'github', plan: 'copilot_pro', display: 'GitHub Copilot Pro', priceMonthly: 10, seatBased: false },
  { provider: 'github', plan: 'copilot_business', display: 'GitHub Copilot Business', priceMonthly: 19, seatBased: true },
];

export const PROJECTS = ['clai-dashboard', 'clai-server', 'marketing-site', 'infra-scripts', 'mobile-app', 'data-pipeline'];

export const SOURCES = ['claude-code', 'codex-cli', 'gemini-cli', 'anthropic-admin'];

export interface MockActor {
  key: string;
  email: string;
  name: string;
}

export const ACTOR_POOL: MockActor[] = [
  { key: 'aria@clai.dev', email: 'aria@clai.dev', name: 'Aria Chen' },
  { key: 'devon@clai.dev', email: 'devon@clai.dev', name: 'Devon Ruiz' },
  { key: 'priya@clai.dev', email: 'priya@clai.dev', name: 'Priya Nair' },
  { key: 'sam@clai.dev', email: 'sam@clai.dev', name: 'Sam Okafor' },
  { key: 'lena@clai.dev', email: 'lena@clai.dev', name: 'Lena Kowalski' },
];

export const LOCAL_ACTOR: MockActor = { key: 'me', email: 'me', name: 'You' };
