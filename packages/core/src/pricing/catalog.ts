import researchCatalog from './catalog.research.json' with { type: 'json' };
import type { ModelPrice, NonTokenPrice, PricingCatalog, SubscriptionPlan } from './types.js';

/**
 * Pricing catalog seed. USD per 1M tokens.
 *
 * `verified: true` entries were checked against the vendor's official pricing page
 * (Anthropic values: platform.claude.com/docs/en/pricing, as cached 2026-06-24 in the
 * Claude API reference). Entries marked `verified: false` are best-effort seeds and are
 * flagged in the UI until the catalog refresh (`clai pricing update`) confirms them.
 */

const A = 'anthropic' as const;
const O = 'openai' as const;
const G = 'google' as const;

function m(p: Partial<ModelPrice> & Pick<ModelPrice, 'provider' | 'id' | 'displayName' | 'input' | 'output'>): ModelPrice {
  return {
    aliases: [],
    family: p.id,
    tier: 'mid',
    cacheRead: null,
    cacheWrite5m: null,
    cacheWrite1h: null,
    batchMultiplier: 0.5,
    longContext: null,
    contextWindow: null,
    maxOutput: null,
    verified: false,
    ...p,
  };
}

const ANTHROPIC_SRC = 'https://platform.claude.com/docs/en/about-claude/pricing';
const PLATFORM_RETIRED = 'Retired on the first-party Claude API; still billable at these rates on Amazon Bedrock / Google Cloud.';
/** Sonnet 4/4.5 1M-context beta: requests above 200K input tokens bill 2x input / 1.5x output (still listed on Vertex partner pricing). */
const SONNET_LONG = { threshold: 200_000, input: 6, output: 22.5, cacheRead: 0.6, cacheWrite5m: 7.5, cacheWrite1h: 12 };

export const MODELS: ModelPrice[] = [
  // ---------------------------------------------------------------- Anthropic
  m({ provider: A, id: 'claude-fable-5-1', displayName: 'Claude Fable 5.1', family: 'fable', tier: 'frontier', input: 10, output: 50, cacheRead: 0.25, cacheWrite5m: 12.5, cacheWrite1h: 20, contextWindow: 1_000_000, maxOutput: 128_000, verified: true, source: ANTHROPIC_SRC, note: 'Cache reads $0.25/MTok (0.025x).' }),
  m({ provider: A, id: 'claude-mythos-5-1', displayName: 'Claude Mythos 5.1', family: 'fable', tier: 'frontier', input: 10, output: 50, cacheRead: 0.25, cacheWrite5m: 12.5, cacheWrite1h: 20, contextWindow: 1_000_000, maxOutput: 128_000, verified: true, source: ANTHROPIC_SRC, note: 'Project Glasswing only; same pricing as Fable 5.1.' }),
  m({ provider: A, id: 'claude-fable-5', displayName: 'Claude Fable 5', family: 'fable', tier: 'frontier', input: 10, output: 50, cacheRead: 1, cacheWrite5m: 12.5, cacheWrite1h: 20, contextWindow: 1_000_000, maxOutput: 128_000, verified: true, source: ANTHROPIC_SRC, aliases: ['claude-mythos-5', 'claude-mythos-preview'] }),
  m({ provider: A, id: 'claude-opus-5', displayName: 'Claude Opus 5', family: 'opus', tier: 'frontier', input: 5, output: 25, cacheRead: 0.5, cacheWrite5m: 6.25, cacheWrite1h: 10, contextWindow: 1_000_000, maxOutput: 128_000, verified: true, source: ANTHROPIC_SRC }),
  m({ provider: A, id: 'claude-opus-4-8', displayName: 'Claude Opus 4.8', family: 'opus', tier: 'frontier', input: 5, output: 25, cacheRead: 0.5, cacheWrite5m: 6.25, cacheWrite1h: 10, contextWindow: 1_000_000, maxOutput: 128_000, verified: true, source: ANTHROPIC_SRC }),
  m({ provider: A, id: 'claude-opus-4-7', displayName: 'Claude Opus 4.7', family: 'opus', tier: 'frontier', input: 5, output: 25, cacheRead: 0.5, cacheWrite5m: 6.25, cacheWrite1h: 10, contextWindow: 1_000_000, maxOutput: 128_000, verified: true, source: ANTHROPIC_SRC }),
  m({ provider: A, id: 'claude-opus-4-6', displayName: 'Claude Opus 4.6', family: 'opus', tier: 'frontier', input: 5, output: 25, cacheRead: 0.5, cacheWrite5m: 6.25, cacheWrite1h: 10, contextWindow: 1_000_000, maxOutput: 128_000, verified: true, source: ANTHROPIC_SRC }),
  m({ provider: A, id: 'claude-opus-4-5', displayName: 'Claude Opus 4.5', family: 'opus', tier: 'frontier', input: 5, output: 25, cacheRead: 0.5, cacheWrite5m: 6.25, cacheWrite1h: 10, contextWindow: 200_000, maxOutput: 64_000, verified: true, source: ANTHROPIC_SRC, aliases: ['claude-opus-4-5-20251101'] }),
  m({ provider: A, id: 'claude-opus-4-1', displayName: 'Claude Opus 4.1', family: 'opus', tier: 'frontier', input: 15, output: 75, cacheRead: 1.5, cacheWrite5m: 18.75, cacheWrite1h: 30, contextWindow: 200_000, maxOutput: 32_000, verified: true, source: ANTHROPIC_SRC, aliases: ['claude-opus-4-1-20250805'], deprecated: '2026-02-05', retired: '2026-08-05', note: PLATFORM_RETIRED }),
  m({ provider: A, id: 'claude-opus-4', displayName: 'Claude Opus 4', family: 'opus', tier: 'frontier', input: 15, output: 75, cacheRead: 1.5, cacheWrite5m: 18.75, cacheWrite1h: 30, contextWindow: 200_000, maxOutput: 32_000, verified: true, source: ANTHROPIC_SRC, aliases: ['claude-opus-4-20250514', 'claude-opus-4-0'], deprecated: '2026-01-01', retired: '2026-09-01', note: PLATFORM_RETIRED }),
  m({ provider: A, id: 'claude-sonnet-5', displayName: 'Claude Sonnet 5', family: 'sonnet', tier: 'mid', input: 2, output: 10, cacheRead: 0.2, cacheWrite5m: 2.5, cacheWrite1h: 4, contextWindow: 1_000_000, maxOutput: 128_000, verified: true, source: ANTHROPIC_SRC, note: 'Introductory $2/$10 pricing made permanent on 2026-09-01.' }),
  m({ provider: A, id: 'claude-sonnet-4-6', displayName: 'Claude Sonnet 4.6', family: 'sonnet', tier: 'mid', input: 3, output: 15, cacheRead: 0.3, cacheWrite5m: 3.75, cacheWrite1h: 6, contextWindow: 1_000_000, maxOutput: 128_000, verified: true, source: ANTHROPIC_SRC }),
  m({ provider: A, id: 'claude-sonnet-4-5', displayName: 'Claude Sonnet 4.5', family: 'sonnet', tier: 'mid', input: 3, output: 15, cacheRead: 0.3, cacheWrite5m: 3.75, cacheWrite1h: 6, contextWindow: 200_000, maxOutput: 64_000, longContext: SONNET_LONG, verified: true, source: ANTHROPIC_SRC, aliases: ['claude-sonnet-4-5-20250929'], note: '200K context by default; the 1M beta bills >200K requests at 2x input / 1.5x output (confirmed on Vertex partner pricing).' }),
  m({ provider: A, id: 'claude-sonnet-4', displayName: 'Claude Sonnet 4', family: 'sonnet', tier: 'mid', input: 3, output: 15, cacheRead: 0.3, cacheWrite5m: 3.75, cacheWrite1h: 6, contextWindow: 200_000, maxOutput: 64_000, longContext: SONNET_LONG, verified: true, source: ANTHROPIC_SRC, aliases: ['claude-sonnet-4-20250514', 'claude-sonnet-4-0'], deprecated: '2026-01-01', retired: '2026-09-01', note: PLATFORM_RETIRED }),
  m({ provider: A, id: 'claude-3-7-sonnet', displayName: 'Claude Sonnet 3.7', family: 'sonnet', tier: 'mid', input: 3, output: 15, cacheRead: 0.3, cacheWrite5m: 3.75, cacheWrite1h: 6, contextWindow: 200_000, maxOutput: 64_000, verified: true, source: ANTHROPIC_SRC, aliases: ['claude-3-7-sonnet-20250219', 'claude-3-7-sonnet-latest'], retired: '2026-02-19' }),
  m({ provider: A, id: 'claude-haiku-4-5', displayName: 'Claude Haiku 4.5', family: 'haiku', tier: 'small', input: 1, output: 5, cacheRead: 0.1, cacheWrite5m: 1.25, cacheWrite1h: 2, contextWindow: 200_000, maxOutput: 64_000, verified: true, source: ANTHROPIC_SRC, aliases: ['claude-haiku-4-5-20251001'] }),
  m({ provider: A, id: 'claude-3-5-haiku', displayName: 'Claude Haiku 3.5', family: 'haiku', tier: 'small', input: 0.8, output: 4, cacheRead: 0.08, cacheWrite5m: 1, cacheWrite1h: 1.6, contextWindow: 200_000, maxOutput: 8_192, verified: true, source: ANTHROPIC_SRC, aliases: ['claude-3-5-haiku-20241022', 'claude-3-5-haiku-latest'], retired: '2026-02-19', note: PLATFORM_RETIRED }),
  m({ provider: A, id: 'claude-3-haiku', displayName: 'Claude Haiku 3', family: 'haiku', tier: 'small', input: 0.25, output: 1.25, cacheRead: 0.03, cacheWrite5m: 0.3, cacheWrite1h: 0.5, contextWindow: 200_000, maxOutput: 4_096, verified: true, source: ANTHROPIC_SRC, aliases: ['claude-3-haiku-20240307'], deprecated: '2025-10-01', retired: '2026-04-19' }),
  m({ provider: A, id: 'claude-3-5-sonnet', displayName: 'Claude Sonnet 3.5', family: 'sonnet', tier: 'mid', input: 3, output: 15, cacheRead: 0.3, cacheWrite5m: 3.75, cacheWrite1h: 6, contextWindow: 200_000, maxOutput: 8_192, verified: true, source: ANTHROPIC_SRC, aliases: ['claude-3-5-sonnet-20241022', 'claude-3-5-sonnet-20240620', 'claude-3-5-sonnet-latest'], retired: '2025-10-28' }),
  m({ provider: A, id: 'claude-3-opus', displayName: 'Claude Opus 3', family: 'opus', tier: 'frontier', input: 15, output: 75, cacheRead: 1.5, cacheWrite5m: 18.75, cacheWrite1h: 30, contextWindow: 200_000, maxOutput: 4_096, verified: true, source: ANTHROPIC_SRC, aliases: ['claude-3-opus-20240229', 'claude-3-opus-latest'], retired: '2026-01-05' }),

  // ------------------------------------------------------------------ OpenAI
  m({ provider: O, id: 'gpt-5', displayName: 'GPT-5', family: 'gpt-5', tier: 'frontier', input: 1.25, output: 10, cacheRead: 0.125, contextWindow: 400_000, maxOutput: 128_000, aliases: ['gpt-5-2025-08-07', 'gpt-5-chat-latest'] }),
  m({ provider: O, id: 'gpt-5-mini', displayName: 'GPT-5 mini', family: 'gpt-5', tier: 'mid', input: 0.25, output: 2, cacheRead: 0.025, contextWindow: 400_000, maxOutput: 128_000, aliases: ['gpt-5-mini-2025-08-07'] }),
  m({ provider: O, id: 'gpt-5-nano', displayName: 'GPT-5 nano', family: 'gpt-5', tier: 'small', input: 0.05, output: 0.4, cacheRead: 0.005, contextWindow: 400_000, maxOutput: 128_000, aliases: ['gpt-5-nano-2025-08-07'] }),
  m({ provider: O, id: 'gpt-5-pro', displayName: 'GPT-5 pro', family: 'gpt-5', tier: 'frontier', input: 15, output: 120, cacheRead: null, batchMultiplier: 0.5, contextWindow: 400_000, maxOutput: 272_000, aliases: ['gpt-5-pro-2025-10-06'] }),
  m({ provider: O, id: 'gpt-5-codex', displayName: 'GPT-5-Codex', family: 'gpt-5', tier: 'frontier', input: 1.25, output: 10, cacheRead: 0.125, contextWindow: 400_000, maxOutput: 128_000 }),
  m({ provider: O, id: 'gpt-5.1', displayName: 'GPT-5.1', family: 'gpt-5', tier: 'frontier', input: 1.25, output: 10, cacheRead: 0.125, contextWindow: 400_000, maxOutput: 128_000, aliases: ['gpt-5.1-2025-11-13', 'gpt-5.1-codex', 'gpt-5.1-chat-latest', 'gpt-5.1-codex-max'] }),
  m({ provider: O, id: 'gpt-5.1-codex-mini', displayName: 'GPT-5.1-Codex-mini', family: 'gpt-5', tier: 'mid', input: 0.25, output: 2, cacheRead: 0.025, contextWindow: 400_000, maxOutput: 128_000 }),
  m({ provider: O, id: 'gpt-5.2', displayName: 'GPT-5.2', family: 'gpt-5', tier: 'frontier', input: 1.75, output: 14, cacheRead: 0.175, contextWindow: 400_000, maxOutput: 128_000, aliases: ['gpt-5.2-2025-12-11', 'gpt-5.2-codex', 'gpt-5.2-chat-latest'] }),
  m({ provider: O, id: 'gpt-5.2-pro', displayName: 'GPT-5.2 pro', family: 'gpt-5', tier: 'frontier', input: 21, output: 168, cacheRead: null, contextWindow: 400_000, maxOutput: 128_000 }),
  m({ provider: O, id: 'gpt-4.1', displayName: 'GPT-4.1', family: 'gpt-4.1', tier: 'mid', input: 2, output: 8, cacheRead: 0.5, contextWindow: 1_047_576, maxOutput: 32_768, aliases: ['gpt-4.1-2025-04-14'] }),
  m({ provider: O, id: 'gpt-4.1-mini', displayName: 'GPT-4.1 mini', family: 'gpt-4.1', tier: 'small', input: 0.4, output: 1.6, cacheRead: 0.1, contextWindow: 1_047_576, maxOutput: 32_768, aliases: ['gpt-4.1-mini-2025-04-14'] }),
  m({ provider: O, id: 'gpt-4.1-nano', displayName: 'GPT-4.1 nano', family: 'gpt-4.1', tier: 'small', input: 0.1, output: 0.4, cacheRead: 0.025, contextWindow: 1_047_576, maxOutput: 32_768, aliases: ['gpt-4.1-nano-2025-04-14'] }),
  m({ provider: O, id: 'gpt-4o', displayName: 'GPT-4o', family: 'gpt-4o', tier: 'mid', input: 2.5, output: 10, cacheRead: 1.25, contextWindow: 128_000, maxOutput: 16_384, aliases: ['gpt-4o-2024-08-06', 'gpt-4o-2024-11-20', 'gpt-4o-2024-05-13'] }),
  m({ provider: O, id: 'chatgpt-4o-latest', displayName: 'ChatGPT-4o latest', family: 'gpt-4o', tier: 'mid', input: 5, output: 15, cacheRead: null, batchMultiplier: null, contextWindow: 128_000, maxOutput: 16_384 }),
  m({ provider: O, id: 'gpt-4o-mini', displayName: 'GPT-4o mini', family: 'gpt-4o', tier: 'small', input: 0.15, output: 0.6, cacheRead: 0.075, contextWindow: 128_000, maxOutput: 16_384, aliases: ['gpt-4o-mini-2024-07-18'] }),
  m({ provider: O, id: 'o3', displayName: 'o3', family: 'o-series', tier: 'frontier', input: 2, output: 8, cacheRead: 0.5, contextWindow: 200_000, maxOutput: 100_000, aliases: ['o3-2025-04-16'] }),
  m({ provider: O, id: 'o3-pro', displayName: 'o3-pro', family: 'o-series', tier: 'frontier', input: 20, output: 80, cacheRead: null, contextWindow: 200_000, maxOutput: 100_000, aliases: ['o3-pro-2025-06-10'] }),
  m({ provider: O, id: 'o3-mini', displayName: 'o3-mini', family: 'o-series', tier: 'mid', input: 1.1, output: 4.4, cacheRead: 0.55, contextWindow: 200_000, maxOutput: 100_000, aliases: ['o3-mini-2025-01-31'] }),
  m({ provider: O, id: 'o4-mini', displayName: 'o4-mini', family: 'o-series', tier: 'mid', input: 1.1, output: 4.4, cacheRead: 0.275, contextWindow: 200_000, maxOutput: 100_000, aliases: ['o4-mini-2025-04-16'] }),
  m({ provider: O, id: 'o1', displayName: 'o1', family: 'o-series', tier: 'frontier', input: 15, output: 60, cacheRead: 7.5, contextWindow: 200_000, maxOutput: 100_000, aliases: ['o1-2024-12-17', 'o1-preview'] }),
  m({ provider: O, id: 'o1-pro', displayName: 'o1-pro', family: 'o-series', tier: 'frontier', input: 150, output: 600, cacheRead: null, contextWindow: 200_000, maxOutput: 100_000 }),
  m({ provider: O, id: 'o1-mini', displayName: 'o1-mini', family: 'o-series', tier: 'mid', input: 1.1, output: 4.4, cacheRead: 0.55, contextWindow: 128_000, maxOutput: 65_536 }),
  m({ provider: O, id: 'codex-mini-latest', displayName: 'codex-mini', family: 'o-series', tier: 'mid', input: 1.5, output: 6, cacheRead: 0.375, contextWindow: 200_000, maxOutput: 100_000 }),
  m({ provider: O, id: 'computer-use-preview', displayName: 'computer-use-preview', family: 'gpt-4o', tier: 'mid', input: 3, output: 12, cacheRead: null, contextWindow: 8_192, maxOutput: 1_024 }),
  m({ provider: O, id: 'gpt-image-1', displayName: 'GPT Image 1', family: 'image', tier: 'other', input: 5, output: 40, cacheRead: 1.25, batchMultiplier: null, note: 'Text input $5/MTok, image input $10/MTok, image output $40/MTok; per-image prices vary by quality.' }),
  m({ provider: O, id: 'gpt-realtime', displayName: 'gpt-realtime', family: 'realtime', tier: 'mid', input: 4, output: 16, cacheRead: 0.4, batchMultiplier: null, note: 'Text tokens only; audio tokens $32/$64 per MTok.' }),
  m({ provider: O, id: 'text-embedding-3-small', displayName: 'text-embedding-3-small', family: 'embedding', tier: 'embedding', input: 0.02, output: 0, cacheRead: null }),
  m({ provider: O, id: 'text-embedding-3-large', displayName: 'text-embedding-3-large', family: 'embedding', tier: 'embedding', input: 0.13, output: 0, cacheRead: null }),
  m({ provider: O, id: 'text-embedding-ada-002', displayName: 'text-embedding-ada-002', family: 'embedding', tier: 'embedding', input: 0.1, output: 0, cacheRead: null }),
  m({ provider: O, id: 'gpt-4-turbo', displayName: 'GPT-4 Turbo', family: 'gpt-4', tier: 'mid', input: 10, output: 30, cacheRead: null, contextWindow: 128_000, maxOutput: 4_096, aliases: ['gpt-4-turbo-2024-04-09', 'gpt-4-1106-preview', 'gpt-4-0125-preview'] }),
  m({ provider: O, id: 'gpt-4', displayName: 'GPT-4', family: 'gpt-4', tier: 'mid', input: 30, output: 60, cacheRead: null, contextWindow: 8_192, maxOutput: 8_192, aliases: ['gpt-4-0613'] }),
  m({ provider: O, id: 'gpt-3.5-turbo', displayName: 'GPT-3.5 Turbo', family: 'gpt-3.5', tier: 'small', input: 0.5, output: 1.5, cacheRead: null, contextWindow: 16_385, maxOutput: 4_096, aliases: ['gpt-3.5-turbo-0125', 'gpt-3.5-turbo-1106'] }),

  // ------------------------------------------------------------------ Google
  m({ provider: G, id: 'gemini-3-pro', displayName: 'Gemini 3 Pro', family: 'gemini-3', tier: 'frontier', input: 2, output: 12, cacheRead: 0.2, longContext: { threshold: 200_000, input: 4, output: 18, cacheRead: 0.4 }, contextWindow: 1_048_576, maxOutput: 65_536, aliases: ['gemini-3-pro-preview'] }),
  m({ provider: G, id: 'gemini-3-flash', displayName: 'Gemini 3 Flash', family: 'gemini-3', tier: 'mid', input: 0.5, output: 3, cacheRead: 0.05, contextWindow: 1_048_576, maxOutput: 65_536, aliases: ['gemini-3-flash-preview'] }),
  m({ provider: G, id: 'gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', family: 'gemini-2.5', tier: 'frontier', input: 1.25, output: 10, cacheRead: 0.31, longContext: { threshold: 200_000, input: 2.5, output: 15, cacheRead: 0.625 }, contextWindow: 1_048_576, maxOutput: 65_536, aliases: ['gemini-2.5-pro-preview-06-05', 'gemini-2.5-pro-preview-05-06', 'gemini-2.5-pro-exp-03-25'] }),
  m({ provider: G, id: 'gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', family: 'gemini-2.5', tier: 'mid', input: 0.3, output: 2.5, cacheRead: 0.03, contextWindow: 1_048_576, maxOutput: 65_536, aliases: ['gemini-2.5-flash-preview-05-20', 'gemini-2.5-flash-preview-04-17'] }),
  m({ provider: G, id: 'gemini-2.5-flash-lite', displayName: 'Gemini 2.5 Flash-Lite', family: 'gemini-2.5', tier: 'small', input: 0.1, output: 0.4, cacheRead: 0.01, contextWindow: 1_048_576, maxOutput: 65_536, aliases: ['gemini-2.5-flash-lite-preview-06-17'] }),
  m({ provider: G, id: 'gemini-2.0-flash', displayName: 'Gemini 2.0 Flash', family: 'gemini-2.0', tier: 'small', input: 0.1, output: 0.4, cacheRead: 0.025, contextWindow: 1_048_576, maxOutput: 8_192, aliases: ['gemini-2.0-flash-001', 'gemini-2.0-flash-exp'] }),
  m({ provider: G, id: 'gemini-2.0-flash-lite', displayName: 'Gemini 2.0 Flash-Lite', family: 'gemini-2.0', tier: 'small', input: 0.075, output: 0.3, cacheRead: null, contextWindow: 1_048_576, maxOutput: 8_192, aliases: ['gemini-2.0-flash-lite-001'] }),
  m({ provider: G, id: 'gemini-1.5-pro', displayName: 'Gemini 1.5 Pro', family: 'gemini-1.5', tier: 'mid', input: 1.25, output: 5, cacheRead: 0.3125, longContext: { threshold: 128_000, input: 2.5, output: 10, cacheRead: 0.625 }, contextWindow: 2_097_152, maxOutput: 8_192, aliases: ['gemini-1.5-pro-002', 'gemini-1.5-pro-001'], retired: '2025-09-24' }),
  m({ provider: G, id: 'gemini-1.5-flash', displayName: 'Gemini 1.5 Flash', family: 'gemini-1.5', tier: 'small', input: 0.075, output: 0.3, cacheRead: 0.01875, longContext: { threshold: 128_000, input: 0.15, output: 0.6, cacheRead: 0.0375 }, contextWindow: 1_048_576, maxOutput: 8_192, aliases: ['gemini-1.5-flash-002', 'gemini-1.5-flash-001'], retired: '2025-09-24' }),
  m({ provider: G, id: 'gemini-embedding-001', displayName: 'Gemini Embedding', family: 'embedding', tier: 'embedding', input: 0.15, output: 0, cacheRead: null }),
  m({ provider: G, id: 'text-embedding-004', displayName: 'text-embedding-004', family: 'embedding', tier: 'embedding', input: 0, output: 0, cacheRead: null }),

  // ------------------------------------------------------------------- xAI
  m({ provider: 'xai', id: 'grok-4', displayName: 'Grok 4', family: 'grok-4', tier: 'frontier', input: 3, output: 15, cacheRead: 0.75, batchMultiplier: null, longContext: { threshold: 128_000, input: 6, output: 30, cacheRead: 1.5 }, contextWindow: 256_000, aliases: ['grok-4-0709', 'grok-4-latest'] }),
  m({ provider: 'xai', id: 'grok-4-fast', displayName: 'Grok 4 Fast', family: 'grok-4', tier: 'mid', input: 0.2, output: 0.5, cacheRead: 0.05, batchMultiplier: null, longContext: { threshold: 128_000, input: 0.4, output: 1, cacheRead: 0.1 }, contextWindow: 2_000_000, aliases: ['grok-4-fast-reasoning', 'grok-4-fast-non-reasoning', 'grok-4-1-fast', 'grok-4-1-fast-reasoning', 'grok-4-1-fast-non-reasoning'] }),
  m({ provider: 'xai', id: 'grok-code-fast-1', displayName: 'Grok Code Fast 1', family: 'grok-code', tier: 'small', input: 0.2, output: 1.5, cacheRead: 0.02, batchMultiplier: null, contextWindow: 256_000 }),
  m({ provider: 'xai', id: 'grok-3', displayName: 'Grok 3', family: 'grok-3', tier: 'mid', input: 3, output: 15, cacheRead: 0.75, batchMultiplier: null, contextWindow: 131_072, aliases: ['grok-3-latest', 'grok-3-beta'] }),
  m({ provider: 'xai', id: 'grok-3-mini', displayName: 'Grok 3 Mini', family: 'grok-3', tier: 'small', input: 0.3, output: 0.5, cacheRead: 0.075, batchMultiplier: null, contextWindow: 131_072, aliases: ['grok-3-mini-latest', 'grok-3-mini-beta'] }),

  // --------------------------------------------------------------- Mistral
  m({ provider: 'mistral', id: 'mistral-large-latest', displayName: 'Mistral Large', family: 'mistral-large', tier: 'frontier', input: 2, output: 6, cacheRead: null, batchMultiplier: 0.5, contextWindow: 128_000, aliases: ['mistral-large-2411', 'mistral-large-2407', 'mistral-large-2512', 'mistral-large-3'] }),
  m({ provider: 'mistral', id: 'mistral-medium-latest', displayName: 'Mistral Medium 3', family: 'mistral-medium', tier: 'mid', input: 0.4, output: 2, cacheRead: null, batchMultiplier: 0.5, contextWindow: 128_000, aliases: ['mistral-medium-2505', 'mistral-medium-2508'] }),
  m({ provider: 'mistral', id: 'mistral-small-latest', displayName: 'Mistral Small 3', family: 'mistral-small', tier: 'small', input: 0.1, output: 0.3, cacheRead: null, batchMultiplier: 0.5, contextWindow: 128_000, aliases: ['mistral-small-2503', 'mistral-small-2506', 'mistral-small-2501'] }),
  m({ provider: 'mistral', id: 'codestral-latest', displayName: 'Codestral', family: 'codestral', tier: 'small', input: 0.3, output: 0.9, cacheRead: null, batchMultiplier: 0.5, contextWindow: 256_000, aliases: ['codestral-2508', 'codestral-2501'] }),
  m({ provider: 'mistral', id: 'devstral-medium-latest', displayName: 'Devstral Medium', family: 'devstral', tier: 'mid', input: 0.4, output: 2, cacheRead: null, batchMultiplier: 0.5, contextWindow: 128_000, aliases: ['devstral-medium-2507'] }),
  m({ provider: 'mistral', id: 'devstral-small-latest', displayName: 'Devstral Small', family: 'devstral', tier: 'small', input: 0.1, output: 0.3, cacheRead: null, batchMultiplier: 0.5, contextWindow: 128_000, aliases: ['devstral-small-2507', 'devstral-small-2505'] }),
  m({ provider: 'mistral', id: 'magistral-medium-latest', displayName: 'Magistral Medium', family: 'magistral', tier: 'mid', input: 2, output: 5, cacheRead: null, batchMultiplier: 0.5, contextWindow: 128_000, aliases: ['magistral-medium-2507', 'magistral-medium-2509'] }),
  m({ provider: 'mistral', id: 'magistral-small-latest', displayName: 'Magistral Small', family: 'magistral', tier: 'small', input: 0.5, output: 1.5, cacheRead: null, batchMultiplier: 0.5, contextWindow: 128_000, aliases: ['magistral-small-2507', 'magistral-small-2509'] }),

  // -------------------------------------------------------------- DeepSeek
  m({ provider: 'deepseek', id: 'deepseek-chat', displayName: 'DeepSeek V3.x (chat)', family: 'deepseek-v3', tier: 'mid', input: 0.28, output: 0.42, cacheRead: 0.028, batchMultiplier: null, contextWindow: 128_000, aliases: ['deepseek-v3', 'deepseek-v3.1', 'deepseek-v3.2', 'deepseek-v3.2-exp'] }),
  m({ provider: 'deepseek', id: 'deepseek-reasoner', displayName: 'DeepSeek Reasoner', family: 'deepseek-r', tier: 'mid', input: 0.28, output: 0.42, cacheRead: 0.028, batchMultiplier: null, contextWindow: 128_000, aliases: ['deepseek-r1', 'deepseek-r1-0528'] }),

  // ---------------------------------------------------------------- Cohere
  m({ provider: 'cohere', id: 'command-a', displayName: 'Command A', family: 'command', tier: 'frontier', input: 2.5, output: 10, cacheRead: null, batchMultiplier: null, contextWindow: 256_000, aliases: ['command-a-03-2025'] }),
  m({ provider: 'cohere', id: 'command-r-plus', displayName: 'Command R+', family: 'command', tier: 'mid', input: 2.5, output: 10, cacheRead: null, batchMultiplier: null, contextWindow: 128_000, aliases: ['command-r-plus-08-2024'] }),
  m({ provider: 'cohere', id: 'command-r', displayName: 'Command R', family: 'command', tier: 'small', input: 0.15, output: 0.6, cacheRead: null, batchMultiplier: null, contextWindow: 128_000, aliases: ['command-r-08-2024'] }),
  m({ provider: 'cohere', id: 'embed-v4.0', displayName: 'Embed v4', family: 'embedding', tier: 'embedding', input: 0.12, output: 0, cacheRead: null, batchMultiplier: null, aliases: ['embed-english-v3.0', 'embed-multilingual-v3.0'] }),

  // ------------------------------------------------------------ Perplexity
  m({ provider: 'perplexity', id: 'sonar', displayName: 'Sonar', family: 'sonar', tier: 'small', input: 1, output: 1, cacheRead: null, batchMultiplier: null, note: 'Plus per-request search fees ($5-12 per 1k requests).' }),
  m({ provider: 'perplexity', id: 'sonar-pro', displayName: 'Sonar Pro', family: 'sonar', tier: 'mid', input: 3, output: 15, cacheRead: null, batchMultiplier: null }),
  m({ provider: 'perplexity', id: 'sonar-reasoning', displayName: 'Sonar Reasoning', family: 'sonar', tier: 'mid', input: 1, output: 5, cacheRead: null, batchMultiplier: null }),
  m({ provider: 'perplexity', id: 'sonar-reasoning-pro', displayName: 'Sonar Reasoning Pro', family: 'sonar', tier: 'mid', input: 2, output: 8, cacheRead: null, batchMultiplier: null }),
  m({ provider: 'perplexity', id: 'sonar-deep-research', displayName: 'Sonar Deep Research', family: 'sonar', tier: 'frontier', input: 2, output: 8, cacheRead: null, batchMultiplier: null, note: 'Plus $2/MTok citation tokens, $5/1k searches, $3/MTok reasoning.' }),

  // ------------------------------------------------------- Meta / Amazon (Bedrock)
  m({ provider: 'meta', id: 'llama-4-maverick', displayName: 'Llama 4 Maverick', family: 'llama-4', tier: 'mid', input: 0.24, output: 0.97, cacheRead: null, batchMultiplier: 0.5, aliases: ['llama4-maverick-17b-instruct-v1', 'llama-4-maverick-17b-128e-instruct'] }),
  m({ provider: 'meta', id: 'llama-4-scout', displayName: 'Llama 4 Scout', family: 'llama-4', tier: 'small', input: 0.17, output: 0.66, cacheRead: null, batchMultiplier: 0.5, aliases: ['llama4-scout-17b-instruct-v1', 'llama-4-scout-17b-16e-instruct'] }),
  m({ provider: 'meta', id: 'llama-3.3-70b', displayName: 'Llama 3.3 70B', family: 'llama-3', tier: 'mid', input: 0.72, output: 0.72, cacheRead: null, batchMultiplier: 0.5, aliases: ['llama3-3-70b-instruct-v1', 'llama-3.3-70b-instruct'] }),
  m({ provider: 'amazon', id: 'nova-micro', displayName: 'Amazon Nova Micro', family: 'nova', tier: 'small', input: 0.035, output: 0.14, cacheRead: null, batchMultiplier: 0.5, aliases: ['nova-micro-v1'] }),
  m({ provider: 'amazon', id: 'nova-lite', displayName: 'Amazon Nova Lite', family: 'nova', tier: 'small', input: 0.06, output: 0.24, cacheRead: null, batchMultiplier: 0.5, aliases: ['nova-lite-v1'] }),
  m({ provider: 'amazon', id: 'nova-pro', displayName: 'Amazon Nova Pro', family: 'nova', tier: 'mid', input: 0.8, output: 3.2, cacheRead: null, batchMultiplier: 0.5, aliases: ['nova-pro-v1'] }),
  m({ provider: 'amazon', id: 'nova-premier', displayName: 'Amazon Nova Premier', family: 'nova', tier: 'frontier', input: 2.5, output: 12.5, cacheRead: null, batchMultiplier: 0.5, aliases: ['nova-premier-v1'] }),
];

export const NON_TOKEN: NonTokenPrice[] = [
  { provider: A, item: 'web_search', unit: 'per_1000_requests', price: 10, source: ANTHROPIC_SRC },
  { provider: A, item: 'web_fetch', unit: 'per_1000_requests', price: 0, source: ANTHROPIC_SRC },
  { provider: A, item: 'code_execution', unit: 'per_container_hour', price: 0.05, source: ANTHROPIC_SRC },
  { provider: O, item: 'web_search', unit: 'per_1000_calls', price: 10 },
  { provider: O, item: 'file_search', unit: 'per_1000_calls', price: 2.5 },
  { provider: O, item: 'code_execution', unit: 'per_session', price: 0.03 },
  { provider: G, item: 'web_search', unit: 'per_1000_requests', price: 35 },
];

export const SUBSCRIPTIONS: SubscriptionPlan[] = [
  { provider: A, plan: 'free', display: 'Claude Free', priceMonthly: 0, seatBased: false, includes: ['claude.ai'], verified: true, source: 'https://claude.com/pricing' },
  { provider: A, plan: 'pro', display: 'Claude Pro', priceMonthly: 20, priceAnnualMonthlyEquiv: 17, seatBased: false, includes: ['claude.ai', 'Claude Code', 'Cowork'], limitsNote: 'Rolling 5-hour session window plus a weekly window, shared across chat, Claude Code and Cowork', verified: true, source: 'https://claude.com/pricing' },
  { provider: A, plan: 'max_5x', display: 'Claude Max 5x', priceMonthly: 100, seatBased: false, includes: ['claude.ai', 'Claude Code', 'Cowork'], limitsNote: '5x Pro usage; 5-hour and weekly windows', verified: true, source: 'https://claude.com/pricing' },
  { provider: A, plan: 'max_20x', display: 'Claude Max 20x', priceMonthly: 200, seatBased: false, includes: ['claude.ai', 'Claude Code', 'Cowork'], limitsNote: '20x Pro usage; 5-hour and weekly windows', verified: true, source: 'https://claude.com/pricing' },
  { provider: A, plan: 'team_standard', display: 'Claude Team (standard seat)', priceMonthly: 25, priceAnnualMonthlyEquiv: 20, seatBased: true, minSeats: 2, includes: ['claude.ai', 'Claude Code'], limitsNote: 'Claude Code included with every seat; per-seat allowance on 5-hour and weekly windows; extra usage billed at API rates', verified: true, source: 'https://claude.com/pricing' },
  { provider: A, plan: 'team_premium', display: 'Claude Team (premium seat)', priceMonthly: 125, priceAnnualMonthlyEquiv: 100, seatBased: true, minSeats: 2, includes: ['claude.ai', 'Claude Code'], limitsNote: 'More Claude Code headroom than a standard seat', verified: true, source: 'https://claude.com/pricing' },
  { provider: A, plan: 'enterprise', display: 'Claude Enterprise', priceMonthly: 20, seatBased: true, minSeats: 20, includes: ['claude.ai', 'Claude Code', 'Cowork'], limitsNote: 'Seat fee (billed annually) covers platform access; all usage billed separately at API rates', verified: false, source: 'https://claude.com/pricing' },
  { provider: O, plan: 'free', display: 'ChatGPT Free', priceMonthly: 0, seatBased: false, includes: ['chatgpt.com'], verified: false },
  { provider: O, plan: 'go', display: 'ChatGPT Go', priceMonthly: 8, seatBased: false, includes: ['chatgpt.com'], verified: false },
  { provider: O, plan: 'plus', display: 'ChatGPT Plus', priceMonthly: 20, seatBased: false, includes: ['chatgpt.com', 'Codex'], verified: false },
  { provider: O, plan: 'pro', display: 'ChatGPT Pro', priceMonthly: 200, seatBased: false, includes: ['chatgpt.com', 'Codex'], verified: false },
  { provider: O, plan: 'business', display: 'ChatGPT Business', priceMonthly: 30, priceAnnualMonthlyEquiv: 25, seatBased: true, minSeats: 2, includes: ['chatgpt.com', 'Codex'], verified: false },
  { provider: O, plan: 'enterprise', display: 'ChatGPT Enterprise', priceMonthly: null, seatBased: true, includes: ['chatgpt.com', 'Codex'], limitsNote: 'Custom pricing (commonly quoted ~$60/seat)', verified: false },
  { provider: G, plan: 'ai_pro', display: 'Google AI Pro', priceMonthly: 19.99, seatBased: false, includes: ['Gemini app', 'Gemini CLI', 'Gemini Code Assist'], verified: false },
  { provider: G, plan: 'ai_ultra', display: 'Google AI Ultra', priceMonthly: 249.99, seatBased: false, includes: ['Gemini app', 'Gemini CLI'], verified: false },
  { provider: 'cursor', plan: 'hobby', display: 'Cursor Hobby', priceMonthly: 0, seatBased: false, includes: ['Cursor'], verified: false },
  { provider: 'cursor', plan: 'pro', display: 'Cursor Pro', priceMonthly: 20, seatBased: false, includes: ['Cursor'], limitsNote: '$20 of included model usage at API prices', verified: false },
  { provider: 'cursor', plan: 'pro_plus', display: 'Cursor Pro+', priceMonthly: 60, seatBased: false, includes: ['Cursor'], verified: false },
  { provider: 'cursor', plan: 'ultra', display: 'Cursor Ultra', priceMonthly: 200, seatBased: false, includes: ['Cursor'], verified: false },
  { provider: 'cursor', plan: 'teams', display: 'Cursor Teams', priceMonthly: 40, seatBased: true, includes: ['Cursor'], verified: false },
  { provider: 'github', plan: 'copilot_free', display: 'GitHub Copilot Free', priceMonthly: 0, seatBased: false, includes: ['Copilot'], verified: false },
  { provider: 'github', plan: 'copilot_pro', display: 'GitHub Copilot Pro', priceMonthly: 10, seatBased: false, includes: ['Copilot'], limitsNote: '300 premium requests/month', verified: false },
  { provider: 'github', plan: 'copilot_pro_plus', display: 'GitHub Copilot Pro+', priceMonthly: 39, seatBased: false, includes: ['Copilot'], limitsNote: '1,500 premium requests/month', verified: false },
  { provider: 'github', plan: 'copilot_business', display: 'GitHub Copilot Business', priceMonthly: 19, seatBased: true, includes: ['Copilot'], limitsNote: '300 premium requests/user/month', verified: false },
  { provider: 'github', plan: 'copilot_enterprise', display: 'GitHub Copilot Enterprise', priceMonthly: 39, seatBased: true, includes: ['Copilot'], limitsNote: '1,000 premium requests/user/month', verified: false },
  { provider: 'microsoft', plan: 'm365_copilot', display: 'Microsoft 365 Copilot', priceMonthly: 30, seatBased: true, includes: ['Microsoft 365 Copilot'], verified: false },
  { provider: 'xai', plan: 'supergrok', display: 'SuperGrok', priceMonthly: 30, seatBased: false, includes: ['Grok'], verified: false },
  { provider: 'xai', plan: 'supergrok_heavy', display: 'SuperGrok Heavy', priceMonthly: 300, seatBased: false, includes: ['Grok'], verified: false },
  { provider: 'perplexity', plan: 'pro', display: 'Perplexity Pro', priceMonthly: 20, seatBased: false, includes: ['Perplexity'], verified: false },
  { provider: 'perplexity', plan: 'max', display: 'Perplexity Max', priceMonthly: 200, seatBased: false, includes: ['Perplexity'], verified: false },
  { provider: 'mistral', plan: 'le_chat_pro', display: 'Le Chat Pro', priceMonthly: 14.99, seatBased: false, includes: ['Le Chat'], verified: false },
  { provider: 'mistral', plan: 'le_chat_team', display: 'Le Chat Team', priceMonthly: 24.99, seatBased: true, includes: ['Le Chat'], verified: false },
];

/** Hand-curated seed (Anthropic entries verified against the official pricing page). */
export const SEED_CATALOG: PricingCatalog = {
  version: '2026-09-03',
  generatedAt: '2026-09-03T00:00:00.000Z',
  models: MODELS,
  nonToken: NON_TOKEN,
  subscriptions: SUBSCRIPTIONS,
  rules: {
    anthropic: { cacheWrite5mMultiplier: 1.25, cacheWrite1hMultiplier: 2.0, cacheReadMultiplier: 0.1, batchDiscount: 0.5, notes: 'Long-context (>200K) premium applies to the Sonnet 4/4.5 1M beta only; 4.6+ models bill the full 1M window at one rate.' },
    openai: { cacheReadMultiplier: 0.1, batchDiscount: 0.5, notes: 'Cached input priced per model; flex tier 50% off; priority/fast 2x.' },
    google: { cacheReadMultiplier: 0.1, batchDiscount: 0.5, notes: 'Context caching storage billed per token-hour separately.' },
    xai: { cacheReadMultiplier: 0.25 },
    deepseek: { cacheReadMultiplier: 0.1 },
  },
};

/**
 * Researched catalog (generated by scripts/merge-pricing.mjs from vendor pricing pages, 2026-09-03).
 * Non-Anthropic entries override the seed; Anthropic entries stay hand-curated. Seed-only ids are kept.
 */
const RESEARCH = researchCatalog as unknown as Partial<PricingCatalog>;

/** Merge an override (e.g. a downloaded/refreshed catalog) on top of the seed by model id / plan key. */
export function mergeCatalog(base: PricingCatalog, override: Partial<PricingCatalog>): PricingCatalog {
  const models = new Map(base.models.map((x) => [x.id, x]));
  for (const x of override.models ?? []) models.set(x.id, x);
  const subs = new Map(base.subscriptions.map((s) => [`${s.provider}:${s.plan}`, s]));
  for (const s of override.subscriptions ?? []) subs.set(`${s.provider}:${s.plan}`, s);
  const nonTokenMap = new Map(base.nonToken.map((n) => [`${n.provider}:${n.item}`, n]));
  for (const n of override.nonToken ?? []) nonTokenMap.set(`${n.provider}:${n.item}`, n);
  return normalizeCatalog({
    version: override.version ?? base.version,
    generatedAt: override.generatedAt ?? base.generatedAt,
    models: [...models.values()],
    subscriptions: [...subs.values()],
    nonToken: [...nonTokenMap.values()],
    rules: { ...base.rules, ...(override.rules ?? {}) },
  });
}

/** Drop aliases that collide with another model's id or alias (first definition wins). */
export function normalizeCatalog(c: PricingCatalog): PricingCatalog {
  const ids = new Set(c.models.map((m) => m.id.toLowerCase()));
  const seen = new Set<string>();
  const models = c.models.map((m) => {
    const aliases: string[] = [];
    for (const a of m.aliases) {
      const k = a.toLowerCase();
      if (k === m.id.toLowerCase() || ids.has(k) || seen.has(k)) continue;
      seen.add(k);
      aliases.push(a);
    }
    return { ...m, aliases };
  });
  return { ...c, models };
}

export const CATALOG: PricingCatalog = mergeCatalog(SEED_CATALOG, {
  ...RESEARCH,
  models: (RESEARCH.models ?? []).filter((m) => m.provider !== 'anthropic' || !MODELS.some((s) => s.id === m.id)),
  subscriptions: [],
});

/** Default catalog used when no override file is present. */
export function defaultCatalog(): PricingCatalog {
  return CATALOG;
}
