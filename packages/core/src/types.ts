/**
 * clai core types. Every connector normalizes its data into `UsageEvent`.
 *
 * Token accounting convention (IMPORTANT for connector authors):
 *  - `input`        = billable UNCACHED input tokens (full input price)
 *  - `cacheRead`    = input tokens served from a prompt cache (discounted)
 *  - `cacheWrite5m` = tokens written to a 5-minute cache (Anthropic: 1.25x)
 *  - `cacheWrite1h` = tokens written to a 1-hour cache (Anthropic: 2x)
 *  - `output`       = all output tokens INCLUDING reasoning/thinking tokens
 *  - `reasoning`    = the reasoning subset of `output` (informational only)
 *
 * Providers differ: Anthropic's `input_tokens` already excludes cache tokens,
 * while OpenAI's `prompt_tokens`/`input_tokens` INCLUDE `cached_tokens` and
 * Google's `promptTokenCount` INCLUDES `cachedContentTokenCount`. Connectors
 * must subtract the cached part before filling `input`.
 */

export type ProviderId =
  | 'anthropic'
  | 'openai'
  | 'google'
  | 'xai'
  | 'mistral'
  | 'deepseek'
  | 'cohere'
  | 'perplexity'
  | 'meta'
  | 'amazon'
  | 'openrouter'
  | 'cursor'
  | 'github'
  | 'microsoft'
  | 'other';

export const PROVIDERS: ProviderId[] = [
  'anthropic',
  'openai',
  'google',
  'xai',
  'mistral',
  'deepseek',
  'cohere',
  'perplexity',
  'meta',
  'amazon',
  'openrouter',
  'cursor',
  'github',
  'microsoft',
  'other',
];

export type SourceId =
  | 'claude-code'
  | 'codex-cli'
  | 'gemini-cli'
  | 'opencode'
  | 'cline'
  | 'aider'
  | 'anthropic-admin'
  | 'anthropic-claude-code'
  | 'openai-admin'
  | 'openrouter'
  | 'cursor-admin'
  | 'github-copilot'
  | 'claude-export'
  | 'chatgpt-export'
  | 'otel'
  | 'csv'
  | 'manual'
  | 'litellm'
  | 'helicone';

/** Where the usage happened, from the user's perspective. */
export type Surface = 'api' | 'cli-agent' | 'ide' | 'chat' | 'batch' | 'unknown';

/** How the usage is paid for. */
export type BillingMode = 'api' | 'subscription' | 'unknown';

/** What one event represents. `request`/`message` are exact; `hour`/`day` are provider buckets. */
export type Granularity = 'request' | 'message' | 'session' | 'hour' | 'day';

export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  reasoning?: number;
  /** Number of API requests represented (1 for request-level events). */
  requests: number;
  webSearches?: number;
  webFetches?: number;
}

export interface Actor {
  userId?: string;
  email?: string;
  name?: string;
  apiKeyId?: string;
  apiKeyName?: string;
  workspaceId?: string;
  workspaceName?: string;
  projectId?: string;
  projectName?: string;
  orgId?: string;
}

export interface EventContext {
  sessionId?: string;
  /** Working directory (local agents). */
  cwd?: string;
  /** Human-friendly project label, e.g. the last path segment of cwd or a provider project name. */
  project?: string;
  gitRepo?: string;
  gitBranch?: string;
  agentId?: string;
  device?: string;
  appVersion?: string;
  serviceTier?: string;
  speed?: string;
  effort?: string;
  tags?: Record<string, string>;
}

export type CostConfidence = 'billed' | 'computed' | 'estimated' | 'none';

export interface EventCost {
  /** Amount the provider actually billed (from a cost report), if known. */
  billedUsd: number | null;
  /** Amount computed by clai from tokens x pricing catalog (API-equivalent value). */
  computedUsd: number | null;
  currency: 'USD';
  confidence: CostConfidence;
  pricingVersion?: string;
}

export interface UsageEvent {
  /** Stable, content-derived id used for idempotent upserts. */
  id: string;
  /** ISO-8601 UTC timestamp of the request (or bucket start). */
  ts: string;
  source: SourceId;
  provider: ProviderId;
  /** Raw model id as reported by the source. */
  model: string;
  /** Canonical catalog id after resolution, or null if unknown. */
  modelKey: string | null;
  surface: Surface;
  billing: BillingMode;
  /** Subscription plan key (e.g. `max_20x`, `plus`, `teams`) when known/declared. */
  plan?: string;
  granularity: Granularity;
  /** For bucketed events: ISO end of the bucket. */
  periodEnd?: string;
  actor: Actor;
  context: EventContext;
  usage: TokenUsage;
  cost: EventCost;
  /** Small, non-sensitive extra fields (never prompt content). */
  meta?: Record<string, unknown>;
}

/** A partially built event from a connector; core fills id/modelKey/cost. */
export type RawUsageEvent = Omit<UsageEvent, 'id' | 'modelKey' | 'cost'> & {
  id?: string;
  /** Natural key parts used to derive a stable id (e.g. message id + request id). */
  naturalKey?: string[];
  cost?: Partial<EventCost>;
};

export const emptyUsage = (): TokenUsage => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite5m: 0,
  cacheWrite1h: 0,
  requests: 0,
});

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite5m: a.cacheWrite5m + b.cacheWrite5m,
    cacheWrite1h: a.cacheWrite1h + b.cacheWrite1h,
    reasoning: (a.reasoning ?? 0) + (b.reasoning ?? 0),
    requests: a.requests + b.requests,
    webSearches: (a.webSearches ?? 0) + (b.webSearches ?? 0),
    webFetches: (a.webFetches ?? 0) + (b.webFetches ?? 0),
  };
}

/** Total tokens that occupied the context window for a request. */
export function contextTokens(u: TokenUsage): number {
  return u.input + u.cacheRead + u.cacheWrite5m + u.cacheWrite1h;
}

export function totalTokens(u: TokenUsage): number {
  return contextTokens(u) + u.output;
}
