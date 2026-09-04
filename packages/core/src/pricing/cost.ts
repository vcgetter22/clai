import type { ProviderId, TokenUsage } from '../types.js';
import type { ModelPrice, PricingCatalog } from './types.js';

export interface CostOptions {
  /** Batch API request (50% off on Anthropic/OpenAI/Google). */
  batch?: boolean;
  /** Force long-context pricing regardless of token counts (e.g. provider bucket says context_window > 200k). */
  longContext?: boolean;
  /** For `request`-granularity events we can detect long context from the token counts themselves. Default true. */
  detectLongContext?: boolean;
  /** OpenRouter `:free` variants etc. */
  free?: boolean;
  /** Service tier hints: 'priority' | 'flex' | 'standard' | 'batch' */
  serviceTier?: string;
}

export interface CostBreakdown {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  webSearches: number;
  webFetches: number;
  multiplier: number;
  longContextApplied: boolean;
  total: number;
}

const DEFAULT_RULES: Record<string, { w5: number; w1h: number; read: number }> = {
  anthropic: { w5: 1.25, w1h: 2.0, read: 0.1 },
  openai: { w5: 1, w1h: 1, read: 0.1 },
  google: { w5: 1, w1h: 1, read: 0.25 },
  xai: { w5: 1, w1h: 1, read: 0.25 },
  deepseek: { w5: 1, w1h: 1, read: 0.1 },
  default: { w5: 1, w1h: 1, read: 0.1 },
};

function rulesFor(catalog: PricingCatalog, provider: ProviderId) {
  const r = catalog.rules[provider];
  const d = DEFAULT_RULES[provider] ?? DEFAULT_RULES['default']!;
  return {
    w5: r?.cacheWrite5mMultiplier ?? d.w5,
    w1h: r?.cacheWrite1hMultiplier ?? d.w1h,
    read: r?.cacheReadMultiplier ?? d.read,
  };
}

/** Compute the USD cost of a usage record against a catalog price. */
export function computeCost(catalog: PricingCatalog, price: ModelPrice, usage: TokenUsage, opts: CostOptions = {}): CostBreakdown {
  const rules = rulesFor(catalog, price.provider);
  const M = 1_000_000;
  const ctx = usage.input + usage.cacheRead + usage.cacheWrite5m + usage.cacheWrite1h;
  const longCtx =
    !!price.longContext && (opts.longContext === true || (opts.detectLongContext !== false && ctx > price.longContext.threshold));

  const inPrice = longCtx ? price.longContext!.input : price.input;
  const outPrice = longCtx ? price.longContext!.output : price.output;
  const readPrice = longCtx ? (price.longContext!.cacheRead ?? inPrice * rules.read) : (price.cacheRead ?? price.input * rules.read);
  const w5Price = longCtx ? (price.longContext!.cacheWrite5m ?? inPrice * rules.w5) : (price.cacheWrite5m ?? price.input * rules.w5);
  const w1hPrice = longCtx ? (price.longContext!.cacheWrite1h ?? inPrice * rules.w1h) : (price.cacheWrite1h ?? price.input * rules.w1h);

  let multiplier = 1;
  if (opts.free) multiplier = 0;
  else if ((opts.batch || opts.serviceTier === 'batch') && price.batchMultiplier) multiplier = price.batchMultiplier;

  const input = (usage.input / M) * inPrice * multiplier;
  const output = (usage.output / M) * outPrice * multiplier;
  const cacheRead = (usage.cacheRead / M) * readPrice * multiplier;
  const cacheWrite5m = (usage.cacheWrite5m / M) * w5Price * multiplier;
  const cacheWrite1h = (usage.cacheWrite1h / M) * w1hPrice * multiplier;

  const webSearchPrice = catalog.nonToken.find((n) => n.provider === price.provider && n.item === 'web_search');
  const webFetchPrice = catalog.nonToken.find((n) => n.provider === price.provider && n.item === 'web_fetch');
  const webSearches = webSearchPrice ? ((usage.webSearches ?? 0) / 1000) * webSearchPrice.price : 0;
  const webFetches = webFetchPrice ? ((usage.webFetches ?? 0) / 1000) * webFetchPrice.price : 0;

  const total = input + output + cacheRead + cacheWrite5m + cacheWrite1h + webSearches + webFetches;
  return {
    input,
    output,
    cacheRead,
    cacheWrite5m,
    cacheWrite1h,
    webSearches,
    webFetches,
    multiplier,
    longContextApplied: longCtx,
    total: round6(total),
  };
}

export function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Cost of the same usage if it had run on another model (for what-if insights). */
export function whatIfCost(
  catalog: PricingCatalog,
  from: ModelPrice,
  to: ModelPrice,
  usage: TokenUsage,
  opts: CostOptions = {},
): { fromUsd: number; toUsd: number; savingsUsd: number } {
  const a = computeCost(catalog, from, usage, opts).total;
  const b = computeCost(catalog, to, usage, opts).total;
  return { fromUsd: a, toUsd: b, savingsUsd: round6(a - b) };
}
