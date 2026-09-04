import type { ProviderId } from '../types.js';
import type { ModelPrice, PricingCatalog } from './types.js';

export type MatchType = 'exact' | 'alias' | 'normalized' | 'prefix' | 'synthetic' | 'none';

export interface ResolvedModel {
  price: ModelPrice | null;
  match: MatchType;
  /** The normalized id that was matched against. */
  normalized: string;
  /** Provider inferred from the raw id (e.g. OpenRouter `anthropic/...` prefix). */
  providerHint?: ProviderId;
  /** True if the raw id had a `:free` suffix (OpenRouter) => zero cost. */
  free?: boolean;
}

const VENDOR_PREFIXES: Record<string, ProviderId> = {
  anthropic: 'anthropic',
  openai: 'openai',
  google: 'google',
  'x-ai': 'xai',
  xai: 'xai',
  mistralai: 'mistral',
  mistral: 'mistral',
  deepseek: 'deepseek',
  cohere: 'cohere',
  perplexity: 'perplexity',
  'meta-llama': 'meta',
  meta: 'meta',
  amazon: 'amazon',
};

/**
 * Normalize a raw model id from any source into a comparable key.
 * Handles Bedrock (`us.anthropic.claude-...-v1:0`), Vertex (`claude-opus-4-5@20251101`),
 * Google (`models/gemini-2.5-pro`), OpenRouter (`anthropic/claude-sonnet-4.5:beta`),
 * and mixed case.
 */
export function normalizeModelId(raw: string): { key: string; providerHint?: ProviderId; free: boolean } {
  let s = raw.trim().toLowerCase();
  let providerHint: ProviderId | undefined;
  let free = false;

  if (s.startsWith('models/')) s = s.slice(7);
  const vertex = /^publishers\/([^/]+)\/models\/(.+)$/.exec(s);
  if (vertex) {
    providerHint = VENDOR_PREFIXES[vertex[1]!];
    s = vertex[2]!;
  }
  // OpenRouter / gateway style `vendor/model[:variant]`
  const slash = s.indexOf('/');
  if (slash > 0) {
    const vendor = s.slice(0, slash);
    const rest = s.slice(slash + 1);
    if (VENDOR_PREFIXES[vendor]) {
      providerHint = VENDOR_PREFIXES[vendor];
      s = rest;
    }
  }
  // Bedrock: region prefixes, vendor prefix, version suffix
  s = s.replace(/^(us|eu|apac|global|jp|au|ca|sa)\./, '');
  const vendorDot = /^(anthropic|amazon|meta|mistral|cohere|deepseek|ai21|stability|openai)\./.exec(s);
  if (vendorDot) {
    providerHint = providerHint ?? VENDOR_PREFIXES[vendorDot[1]!];
    s = s.slice(vendorDot[0].length);
  }
  // OpenRouter variant suffixes (`:free`, `:beta`, `:thinking`, `:online`, `:nitro`) and Bedrock `-v1:0`
  const bedrockVersion = /-v\d+:\d+$/.exec(s);
  if (bedrockVersion) s = s.slice(0, bedrockVersion.index);
  const colon = s.indexOf(':');
  if (colon > 0) {
    const variant = s.slice(colon + 1);
    if (variant === 'free') free = true;
    s = s.slice(0, colon);
  }
  // Vertex `@date` -> `-date`
  s = s.replace(/@(\d{8})$/, '-$1');
  // OpenRouter uses dots in Claude versions (claude-sonnet-4.5) while Anthropic uses dashes (claude-sonnet-4-5)
  if (s.startsWith('claude')) s = s.replace(/(\d)\.(\d)/g, '$1-$2');
  s = s.replace(/\s+/g, '');
  return { key: s, providerHint, free };
}

interface Index {
  exact: Map<string, ModelPrice>;
  byProvider: Map<ProviderId, ModelPrice[]>;
  all: ModelPrice[];
}

const indexCache = new WeakMap<PricingCatalog, Index>();

function buildIndex(catalog: PricingCatalog): Index {
  const cached = indexCache.get(catalog);
  if (cached) return cached;
  const exact = new Map<string, ModelPrice>();
  const byProvider = new Map<ProviderId, ModelPrice[]>();
  for (const m of catalog.models) {
    exact.set(m.id.toLowerCase(), m);
    for (const a of m.aliases) {
      const n = normalizeModelId(a).key;
      if (!exact.has(n)) exact.set(n, m);
      if (!exact.has(a.toLowerCase())) exact.set(a.toLowerCase(), m);
    }
    const list = byProvider.get(m.provider) ?? [];
    list.push(m);
    byProvider.set(m.provider, list);
  }
  for (const list of byProvider.values()) list.sort((a, b) => b.id.length - a.id.length);
  const idx = { exact, byProvider, all: [...catalog.models].sort((a, b) => b.id.length - a.id.length) };
  indexCache.set(catalog, idx);
  return idx;
}

export const SYNTHETIC_MODELS = new Set(['<synthetic>', 'synthetic', 'unknown', 'none', '']);

/** Resolve a raw model id to a catalog price entry. */
export function resolveModel(catalog: PricingCatalog, raw: string, providerHint?: ProviderId): ResolvedModel {
  const rawLower = (raw ?? '').trim().toLowerCase();
  if (SYNTHETIC_MODELS.has(rawLower)) {
    return { price: null, match: 'synthetic', normalized: rawLower };
  }
  const idx = buildIndex(catalog);
  const norm = normalizeModelId(raw);
  const hint = norm.providerHint ?? providerHint;
  const ok = (m: ModelPrice) => !hint || m.provider === hint || hint === 'openrouter' || hint === 'other';

  const direct = idx.exact.get(rawLower);
  if (direct && ok(direct)) {
    return { price: direct, match: direct.id === rawLower ? 'exact' : 'alias', normalized: norm.key, providerHint: hint, free: norm.free };
  }
  const normalized = idx.exact.get(norm.key);
  if (normalized && ok(normalized)) {
    return { price: normalized, match: 'normalized', normalized: norm.key, providerHint: hint, free: norm.free };
  }
  // Strip a trailing date snapshot / `-latest` and retry (claude-opus-5-20260601 -> claude-opus-5)
  const noDate = norm.key
    .replace(/-\d{8}$/, '')
    .replace(/-\d{4}-\d{2}-\d{2}$/, '')
    .replace(/-latest$/, '');
  const dated = idx.exact.get(noDate);
  if (dated && ok(dated)) {
    return { price: dated, match: 'normalized', normalized: noDate, providerHint: hint, free: norm.free };
  }
  // Longest-prefix match within provider (or all providers when unknown)
  const candidates = hint && hint !== 'openrouter' && hint !== 'other' ? (idx.byProvider.get(hint) ?? []) : idx.all;
  for (const m of candidates) {
    const id = m.id.toLowerCase();
    if (norm.key.startsWith(id + '-') || norm.key.startsWith(id + '.')) {
      return { price: m, match: 'prefix', normalized: norm.key, providerHint: hint, free: norm.free };
    }
  }
  return { price: null, match: 'none', normalized: norm.key, providerHint: hint, free: norm.free };
}

/** Infer the provider from a raw model id when a source does not say (e.g. OpenRouter, gateways). */
export function inferProvider(catalog: PricingCatalog, raw: string): ProviderId | null {
  const r = resolveModel(catalog, raw);
  if (r.price) return r.price.provider;
  const k = r.normalized;
  if (k.startsWith('claude')) return 'anthropic';
  if (/^(gpt|o\d|chatgpt|codex|text-embedding|davinci|whisper|tts)/.test(k)) return 'openai';
  if (k.startsWith('gemini') || k.startsWith('gemma') || k.startsWith('text-embedding-00')) return 'google';
  if (k.startsWith('grok')) return 'xai';
  if (/^(mistral|codestral|devstral|magistral|pixtral|ministral)/.test(k)) return 'mistral';
  if (k.startsWith('deepseek')) return 'deepseek';
  if (k.startsWith('command') || k.startsWith('embed-')) return 'cohere';
  if (k.startsWith('sonar')) return 'perplexity';
  if (k.startsWith('llama')) return 'meta';
  if (k.startsWith('nova') || k.startsWith('titan')) return 'amazon';
  return r.providerHint ?? null;
}
