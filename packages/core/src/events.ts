import { stableId } from './ids.js';
import { computeCost } from './pricing/cost.js';
import { inferProvider, resolveModel } from './pricing/resolve.js';
import type { PricingCatalog } from './pricing/types.js';
import type { ProviderId, RawUsageEvent, UsageEvent } from './types.js';

export interface FinalizeResult {
  event: UsageEvent;
  /** True when the model could not be priced (event stored with computedUsd null). */
  unpriced: boolean;
}

/**
 * Turn a connector's raw event into a stored event: derive a stable id, resolve the model
 * against the pricing catalog, infer the provider for gateways, and compute cost.
 */
export function finalizeEvent(raw: RawUsageEvent, catalog: PricingCatalog): FinalizeResult {
  const naturalKey = raw.naturalKey ?? [
    raw.ts,
    raw.model,
    raw.granularity,
    raw.actor.email ?? raw.actor.userId ?? raw.actor.apiKeyId ?? '',
    raw.context.sessionId ?? '',
    raw.usage.input,
    raw.usage.output,
    raw.usage.cacheRead,
    raw.usage.cacheWrite5m + raw.usage.cacheWrite1h,
  ];
  const id = raw.id ?? stableId([raw.source, ...naturalKey]);

  const gateway = raw.provider === 'openrouter' || raw.provider === 'other';
  const resolved = resolveModel(catalog, raw.model, gateway ? undefined : raw.provider);
  let provider: ProviderId = raw.provider;
  if (gateway) provider = resolved.price?.provider ?? inferProvider(catalog, raw.model) ?? raw.provider;

  const billedUsd = raw.cost?.billedUsd ?? null;
  let computedUsd: number | null = null;
  let confidence: UsageEvent['cost']['confidence'] = 'none';
  if (resolved.price) {
    const isBatch = raw.surface === 'batch' || raw.context.serviceTier === 'batch';
    computedUsd = computeCost(catalog, resolved.price, raw.usage, {
      batch: isBatch,
      free: resolved.free,
      detectLongContext: raw.granularity === 'request' || raw.granularity === 'message',
      serviceTier: raw.context.serviceTier,
    }).total;
    confidence = 'computed';
  } else if (resolved.match === 'synthetic') {
    computedUsd = 0;
    confidence = 'computed';
  }
  if (raw.cost?.computedUsd !== undefined && raw.cost.computedUsd !== null && computedUsd === null) {
    // Source supplied its own estimate (e.g. OpenCode cost field) and we could not price it ourselves.
    computedUsd = raw.cost.computedUsd;
    confidence = 'estimated';
  }
  // Token counts that were themselves estimated (data exports) never become "computed".
  if (raw.cost?.confidence === 'estimated' && confidence === 'computed') confidence = 'estimated';
  if (billedUsd !== null) confidence = 'billed';

  // Normalize usage so stored and in-memory events compare equal.
  const usage: UsageEvent['usage'] = {
    input: raw.usage.input,
    output: raw.usage.output,
    cacheRead: raw.usage.cacheRead,
    cacheWrite5m: raw.usage.cacheWrite5m,
    cacheWrite1h: raw.usage.cacheWrite1h,
    ...(raw.usage.reasoning === undefined ? {} : { reasoning: raw.usage.reasoning }),
    requests: raw.usage.requests,
    webSearches: raw.usage.webSearches ?? 0,
    webFetches: raw.usage.webFetches ?? 0,
  };
  const event: UsageEvent = {
    id,
    ts: raw.ts,
    source: raw.source,
    provider,
    model: raw.model,
    modelKey: resolved.price?.id ?? (resolved.match === 'synthetic' ? 'synthetic' : null),
    surface: raw.surface,
    billing: raw.billing,
    ...(raw.plan === undefined ? {} : { plan: raw.plan }),
    granularity: raw.granularity,
    ...(raw.periodEnd === undefined ? {} : { periodEnd: raw.periodEnd }),
    actor: raw.actor,
    context: raw.context,
    usage,
    cost: { billedUsd, computedUsd, currency: 'USD', confidence, pricingVersion: catalog.version },
    ...(raw.meta === undefined ? {} : { meta: raw.meta }),
  };
  return { event, unpriced: resolved.price === null && resolved.match !== 'synthetic' };
}

/** Recompute `computedUsd` for an existing event with a (newer) catalog. */
export function repriceEvent(event: UsageEvent, catalog: PricingCatalog): UsageEvent {
  const { event: e } = finalizeEvent({ ...event, cost: { billedUsd: event.cost.billedUsd } }, catalog);
  return { ...e, id: event.id };
}

/** The cost we should display: billed when known, else computed. */
export function effectiveCost(e: Pick<UsageEvent, 'cost'>): number {
  return e.cost.billedUsd ?? e.cost.computedUsd ?? 0;
}
