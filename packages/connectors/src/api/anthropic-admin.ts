import type { RawUsageEvent } from '@claii/core';
import { emptyUsage } from '@claii/core';
import type { ApiConnector, ConnectorContext, PullOptions } from '../types.js';
import { num, str } from '../util/files.js';
import { type CursorPage, compact, compactTags, describeAuthError, markPulled, paginateCursor, requestJson, resolveWindow } from './http.js';
import { pullAnalyticsCost, pullAnalyticsUsage, verifyAnalyticsKey } from './anthropic-analytics.js';

/**
 * Anthropic Admin API connectors: `usage_report/messages` + `cost_report` (Claude Console /
 * Platform orgs, source https://platform.claude.com/docs/en/manage-claude/usage-cost-api) and
 * `usage_report/claude_code` (per-user Claude Code Analytics API, source
 * https://platform.claude.com/docs/en/manage-claude/claude-code-analytics-api).
 *
 * Response shapes for §1.2/§1.3 are reconstructed (the Console-org docs page shows curl requests
 * but not a full example body) from the field names the guide's prose names explicitly, cross-
 * confirmed against the byte-for-byte-identical Enterprise Analytics sibling endpoints (§5.3,
 * see `anthropic-analytics.ts`). Treat exact field names here as high-confidence, not verbatim —
 * `mapUsageResult`/`mapCostResult` below read every numeric field through `num()` (defaults to 0)
 * so an unexpectedly-missing field degrades gracefully instead of throwing.
 *
 * IMPORTANT — usage events vs. cost events are kept SEPARATE, on purpose: `usage_report/messages`
 * gives token counts with no dollar figure, while `cost_report` gives billed USD with zeroed-out
 * token counts (grouped by workspace_id + description, not by the same dimensions as the usage
 * report, so the two cannot be merged row-for-row). Both are emitted as distinct `RawUsageEvent`s
 * with different `naturalKey` prefixes (`'usage'` vs `'cost'`). A downstream store/aggregator that
 * wants "billed-if-known-else-computed" per cell should prefer the cost-report row's `billedUsd`
 * over the usage-report row's computed price only when both fall in the same bucket/workspace —
 * that reconciliation is out of scope for this connector, which just reports both facts as given.
 *
 * Claude Enterprise orgs (claude.ai) use a *different* API family (`/v1/organizations/analytics/*`,
 * a separate "Analytics API key") instead of this Console-org Admin API — see `anthropic-analytics.ts`.
 * Since `SourceId` has no separate id for it, those events are emitted with `source: 'anthropic-admin'`
 * too, tagged `meta.api = 'enterprise-analytics'`. Because `registerConnector` dedups by connector
 * `id` (first registration wins) there can only be ONE registered connector object for id
 * `anthropic-admin` — so this single connector's `credentials` list offers both `adminKey` (Console
 * org) and `analyticsKey` (Enterprise org), and `verify()`/`pull()` dispatch on whichever is set
 * (an org realistically only ever has one, per Anthropic's docs: "the key types are not
 * interchangeable").
 */

const ADMIN_BASE = 'https://api.anthropic.com/v1/organizations';
const ANTHROPIC_VERSION = '2023-06-01';

export function anthropicHeaders(apiKey: string, extra?: Record<string, string>): Record<string, string> {
  return { 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VERSION, ...extra };
}

/** One `results[]` entry of `usage_report/messages` (Console) or `analytics/usage_report` (Enterprise). */
export interface AnthropicUsageResult {
  uncached_input_tokens?: number;
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number };
  cache_read_input_tokens?: number;
  output_tokens?: number;
  model?: string;
  service_tier?: string;
  context_window?: string;
  inference_geo?: string;
  api_key_id?: string | null;
  workspace_id?: string | null;
  server_tool_use?: { web_search_requests?: number };
  requests?: number;
  speed?: string;
  // Enterprise Analytics-only extra dimensions (UNVERIFIED shape, read defensively):
  product?: string;
  rbac_group_id?: string;
  slack_channel_id?: string;
}

/** One `results[]` entry of `cost_report` (Console) or `analytics/cost_report` (Enterprise). */
export interface AnthropicCostResult {
  amount?: string;
  currency?: string;
  cost_type?: string;
  model?: string;
  context_window?: string;
  service_tier?: string;
  token_type?: string;
  workspace_id?: string | null;
  description?: string;
}

export interface AnthropicBucket<R> {
  starting_at: string;
  ending_at: string;
  results?: R[];
}

export interface AnthropicBucketPage<R> {
  data?: AnthropicBucket<R>[];
  has_more?: boolean;
  next_page?: string | null;
}

export function flattenBuckets<R>(page: AnthropicBucketPage<R>): { bucketStart: string; bucketEnd: string; result: R }[] {
  const out: { bucketStart: string; bucketEnd: string; result: R }[] = [];
  for (const b of page.data ?? []) {
    for (const r of b.results ?? []) out.push({ bucketStart: b.starting_at, bucketEnd: b.ending_at, result: r });
  }
  return out;
}

export interface MapUsageOpts {
  granularity: 'hour' | 'day';
  apiKeyNames?: Map<string, string>;
  workspaceNames?: Map<string, string>;
  sourceMeta?: Record<string, unknown>;
}

export function mapUsageResult(bucketStart: string, bucketEnd: string, r: AnthropicUsageResult, opts: MapUsageOpts): RawUsageEvent {
  const apiKeyId = str(r.api_key_id ?? undefined);
  const workspaceId = str(r.workspace_id ?? undefined);
  const model = str(r.model) ?? 'unknown';
  const serviceTier = str(r.service_tier);
  return {
    ts: bucketStart,
    periodEnd: bucketEnd,
    source: 'anthropic-admin',
    provider: 'anthropic',
    model,
    surface: serviceTier === 'batch' ? 'batch' : 'api',
    billing: 'api',
    granularity: opts.granularity,
    actor: {
      apiKeyId,
      apiKeyName: apiKeyId ? opts.apiKeyNames?.get(apiKeyId) : undefined,
      workspaceId,
      workspaceName: workspaceId ? opts.workspaceNames?.get(workspaceId) : undefined,
    },
    context: { serviceTier },
    usage: {
      input: num(r.uncached_input_tokens),
      output: num(r.output_tokens),
      cacheRead: num(r.cache_read_input_tokens),
      cacheWrite5m: num(r.cache_creation?.ephemeral_5m_input_tokens),
      cacheWrite1h: num(r.cache_creation?.ephemeral_1h_input_tokens),
      requests: num(r.requests),
      webSearches: num(r.server_tool_use?.web_search_requests),
    },
    meta: compact({ contextWindow: r.context_window, speed: r.speed, inferenceGeo: r.inference_geo, ...opts.sourceMeta }),
    naturalKey: ['usage', bucketStart, model, serviceTier ?? '', apiKeyId ?? '', workspaceId ?? '', r.context_window ?? ''],
  };
}

export interface MapCostOpts {
  workspaceNames?: Map<string, string>;
  sourceMeta?: Record<string, unknown>;
}

/** `cost_report` groups by description; a structured `model` field is present on the row when known. */
export function mapCostResult(bucketStart: string, bucketEnd: string, r: AnthropicCostResult, opts: MapCostOpts = {}): RawUsageEvent {
  const workspaceId = str(r.workspace_id ?? undefined);
  const description = str(r.description) ?? '';
  const amountCents = Number(r.amount ?? '0');
  return {
    ts: bucketStart,
    periodEnd: bucketEnd,
    source: 'anthropic-admin',
    provider: 'anthropic',
    model: str(r.model) ?? 'unknown',
    surface: r.service_tier === 'batch' ? 'batch' : 'api',
    billing: 'api',
    granularity: 'day',
    actor: { workspaceId, workspaceName: workspaceId ? opts.workspaceNames?.get(workspaceId) : undefined },
    context: { serviceTier: str(r.service_tier) },
    usage: emptyUsage(),
    cost: { billedUsd: Number.isFinite(amountCents) ? amountCents / 100 : null, currency: 'USD', confidence: 'billed' },
    meta: compact({ costType: r.cost_type, tokenType: r.token_type, description, contextWindow: r.context_window, ...opts.sourceMeta }),
    // Extra disambiguators (token_type/cost_type/context_window) beyond the spec's 4-part key are
    // needed for idempotency: cost_report can return several rows per bucket+workspace+description
    // (one per token_type), which would otherwise collide onto the same natural key and clobber
    // each other in the store.
    naturalKey: ['cost', bucketStart, workspaceId ?? '', description, r.token_type ?? '', r.cost_type ?? ''],
  };
}

async function loadIdNameMap(ctx: ConnectorContext, headers: Record<string, string>, url: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  let afterId: string | undefined;
  let guard = 0;
  for (;;) {
    let res;
    try {
      res = await requestJson<{ data?: Array<{ id?: string; name?: string }>; has_more?: boolean; last_id?: string | null }>(ctx, url, {
        headers,
        query: { limit: 1000, after_id: afterId },
        retries: 2,
      });
    } catch (err) {
      ctx.log.warn(`anthropic-admin: failed to load id/name map from ${url}: ${(err as Error).message}`);
      break;
    }
    for (const item of res.body.data ?? []) {
      if (item?.id) map.set(item.id, item.name ?? item.id);
    }
    guard++;
    if (!res.body.has_more || !res.body.last_id || guard > 50) break;
    afterId = res.body.last_id;
  }
  return map;
}

function bucketWidthFor(since: string, until: string): { bucketWidth: '1h' | '1d'; limit: number; granularity: 'hour' | 'day' } {
  const spanDays = (Date.parse(until) - Date.parse(since)) / 86_400_000;
  return spanDays <= 7 ? { bucketWidth: '1h', limit: 168, granularity: 'hour' } : { bucketWidth: '1d', limit: 31, granularity: 'day' };
}

const USAGE_GROUP_BY = ['api_key_id', 'workspace_id', 'model', 'service_tier', 'context_window'];
const COST_GROUP_BY = ['workspace_id', 'description'];

async function* pullConsoleUsage(ctx: ConnectorContext, adminKey: string, since: string, until: string, apiKeyNames: Map<string, string>, workspaceNames: Map<string, string>): AsyncGenerator<RawUsageEvent> {
  const { bucketWidth, limit, granularity } = bucketWidthFor(since, until);
  const headers = anthropicHeaders(adminKey);
  const fetchPage = async (page: string | undefined): Promise<CursorPage<{ bucketStart: string; bucketEnd: string; result: AnthropicUsageResult }>> => {
    const res = await requestJson<AnthropicBucketPage<AnthropicUsageResult>>(ctx, `${ADMIN_BASE}/usage_report/messages`, {
      headers,
      query: { starting_at: since, ending_at: until, bucket_width: bucketWidth, limit, page, group_by: USAGE_GROUP_BY },
    });
    return { items: flattenBuckets(res.body), hasMore: res.body.has_more, nextPage: res.body.next_page };
  };
  for await (const { bucketStart, bucketEnd, result } of paginateCursor(fetchPage)) {
    yield mapUsageResult(bucketStart, bucketEnd, result, { granularity, apiKeyNames, workspaceNames });
  }
}

async function* pullConsoleCost(ctx: ConnectorContext, adminKey: string, since: string, until: string, workspaceNames: Map<string, string>): AsyncGenerator<RawUsageEvent> {
  const headers = anthropicHeaders(adminKey);
  const fetchPage = async (page: string | undefined): Promise<CursorPage<{ bucketStart: string; bucketEnd: string; result: AnthropicCostResult }>> => {
    const res = await requestJson<AnthropicBucketPage<AnthropicCostResult>>(ctx, `${ADMIN_BASE}/cost_report`, {
      headers,
      query: { starting_at: since, ending_at: until, bucket_width: '1d', limit: 31, page, group_by: COST_GROUP_BY },
    });
    return { items: flattenBuckets(res.body), hasMore: res.body.has_more, nextPage: res.body.next_page };
  };
  for await (const { bucketStart, bucketEnd, result } of paginateCursor(fetchPage)) {
    yield mapCostResult(bucketStart, bucketEnd, result, { workspaceNames });
  }
}

export const anthropicAdminConnector: ApiConnector = {
  kind: 'api',
  id: 'anthropic-admin',
  displayName: 'Anthropic Admin API',
  credentials: [
    {
      key: 'adminKey',
      label: 'Admin API key',
      secret: true,
      envVar: 'ANTHROPIC_ADMIN_KEY',
      help: 'Claude Console → Settings → Admin keys (sk-ant-admin01-...). For Claude Console/Platform (pay-as-you-go API) orgs. Must not be workspace-scoped.',
    },
    {
      key: 'analyticsKey',
      label: 'Analytics API key',
      secret: true,
      optional: true,
      envVar: 'ANTHROPIC_ANALYTICS_KEY',
      help: 'claude.ai → Organization settings → API (read:analytics scope, primary owner only). For Claude Enterprise orgs instead of an Admin key — the two key types are not interchangeable.',
    },
  ],

  async verify(ctx, creds) {
    const adminKey = str(creds['adminKey']);
    const analyticsKey = str(creds['analyticsKey']);
    if (!adminKey && !analyticsKey) {
      return { ok: false, message: 'Provide an Admin API key (Console/Platform orgs) or an Analytics API key (Claude Enterprise orgs).' };
    }
    if (adminKey) {
      try {
        const res = await requestJson<{ data?: unknown[] }>(ctx, `${ADMIN_BASE}/api_keys`, { headers: anthropicHeaders(adminKey), query: { limit: 1 }, retries: 1 });
        const n = res.body.data?.length ?? 0;
        return { ok: true, message: `Connected with Admin API key (organization has API keys visible: ${n > 0 ? 'yes' : 'none returned for limit=1'}).` };
      } catch (err) {
        return {
          ok: false,
          message: describeAuthError(err, {
            unauthorized: 'Admin API key rejected — use a Console org Admin key (sk-ant-admin01-...) from Settings → Admin keys, not a regular or workspace-scoped API key',
            forbidden: 'Admin API key lacks access — an organization must exist in Console → Settings → Organization and the key must be org-scoped',
          }),
        };
      }
    }
    return verifyAnalyticsKey(ctx, analyticsKey!);
  },

  async *pull(ctx, creds, opts) {
    const adminKey = str(creds['adminKey']);
    const analyticsKey = str(creds['analyticsKey']);
    if (!adminKey && !analyticsKey) {
      ctx.log.warn('anthropic-admin: no adminKey or analyticsKey credential set, skipping pull');
      return;
    }

    if (adminKey) {
      const headers = anthropicHeaders(adminKey);
      const [apiKeyNames, workspaceNames] = await Promise.all([loadIdNameMap(ctx, headers, `${ADMIN_BASE}/api_keys`), loadIdNameMap(ctx, headers, `${ADMIN_BASE}/workspaces`)]);

      const usageWindow = resolveWindow(ctx, opts, 'anthropic-admin:usage:last_pull', 90);
      ctx.log.debug(`anthropic-admin: pulling usage_report/messages ${usageWindow.since}..${usageWindow.until}`);
      for await (const ev of pullConsoleUsage(ctx, adminKey, usageWindow.since, usageWindow.until, apiKeyNames, workspaceNames)) yield ev;
      markPulled(ctx, 'anthropic-admin:usage:last_pull', usageWindow.until);

      const costWindow = resolveWindow(ctx, opts, 'anthropic-admin:cost:last_pull', 90);
      ctx.log.debug(`anthropic-admin: pulling cost_report ${costWindow.since}..${costWindow.until}`);
      for await (const ev of pullConsoleCost(ctx, adminKey, costWindow.since, costWindow.until, workspaceNames)) yield ev;
      markPulled(ctx, 'anthropic-admin:cost:last_pull', costWindow.until);
      return;
    }

    // Enterprise Analytics API path.
    const usageWindow = resolveWindow(ctx, opts, 'anthropic-admin:analytics-usage:last_pull', 90);
    ctx.log.debug(`anthropic-admin: pulling analytics/usage_report ${usageWindow.since}..${usageWindow.until}`);
    for await (const ev of pullAnalyticsUsage(ctx, analyticsKey!, usageWindow.since, usageWindow.until)) yield ev;
    markPulled(ctx, 'anthropic-admin:analytics-usage:last_pull', usageWindow.until);

    const costWindow = resolveWindow(ctx, opts, 'anthropic-admin:analytics-cost:last_pull', 90);
    ctx.log.debug(`anthropic-admin: pulling analytics/cost_report ${costWindow.since}..${costWindow.until}`);
    for await (const ev of pullAnalyticsCost(ctx, analyticsKey!, costWindow.since, costWindow.until)) yield ev;
    markPulled(ctx, 'anthropic-admin:analytics-cost:last_pull', costWindow.until);
  },
};

// ---------------------------------------------------------------------------------------------
// Claude Code Analytics API (usage_report/claude_code) — per-user, per-day, one request per day.
// ---------------------------------------------------------------------------------------------

interface ClaudeCodeActor {
  type?: string;
  email_address?: string;
  api_key_name?: string;
  api_key_id?: string;
}

interface ClaudeCodeModelBreakdown {
  model?: string;
  tokens?: { input?: number; output?: number; cache_read?: number; cache_creation?: number };
  estimated_cost?: { currency?: string; amount?: number };
}

interface ClaudeCodeToolCounts {
  accepted?: number;
  rejected?: number;
}

interface ClaudeCodeDay {
  date?: string;
  actor?: ClaudeCodeActor;
  organization_id?: string;
  customer_type?: string;
  terminal_type?: string;
  core_metrics?: {
    num_sessions?: number;
    lines_of_code?: { added?: number; removed?: number };
    commits_by_claude_code?: number;
    pull_requests_by_claude_code?: number;
  };
  // §1.4's full quoted example response; not aggregated into `usage`/`cost` (no token/dollar figure
  // of its own) but carried through in `meta.toolActions` since it's part of the documented per-user
  // per-day shape.
  tool_actions?: {
    edit_tool?: ClaudeCodeToolCounts;
    multi_edit_tool?: ClaudeCodeToolCounts;
    write_tool?: ClaudeCodeToolCounts;
    notebook_edit_tool?: ClaudeCodeToolCounts;
  };
  model_breakdown?: ClaudeCodeModelBreakdown[];
}

interface ClaudeCodePage {
  data?: ClaudeCodeDay[];
  has_more?: boolean;
  next_page?: string | null;
}

export function mapClaudeCodeDay(day: ClaudeCodeDay): RawUsageEvent[] {
  const ts = str(day.date) ?? new Date(0).toISOString();
  const actor = day.actor ?? {};
  const email = actor.type === 'user_actor' ? str(actor.email_address) : undefined;
  // Docs confirm api_actor.api_key_name; api_key_id is UNVERIFIED (not shown in the example) but
  // read defensively in case it is present, falling back to the name as the id when it is not.
  const apiKeyName = actor.type === 'api_actor' ? str(actor.api_key_name) : undefined;
  const apiKeyId = actor.type === 'api_actor' ? (str(actor.api_key_id) ?? apiKeyName) : undefined;
  const billing = day.customer_type === 'subscription' ? 'subscription' : 'api';
  const identity = email ?? apiKeyId ?? apiKeyName ?? 'unknown';
  const coreMetrics = compact({
    sessions: day.core_metrics?.num_sessions,
    linesAdded: day.core_metrics?.lines_of_code?.added,
    linesRemoved: day.core_metrics?.lines_of_code?.removed,
    commits: day.core_metrics?.commits_by_claude_code,
    pullRequests: day.core_metrics?.pull_requests_by_claude_code,
  });
  const toolCounts = (c: ClaudeCodeToolCounts | undefined) => (c ? compact({ accepted: c.accepted, rejected: c.rejected }) : undefined);
  const toolActions = compact({
    editTool: toolCounts(day.tool_actions?.edit_tool),
    multiEditTool: toolCounts(day.tool_actions?.multi_edit_tool),
    writeTool: toolCounts(day.tool_actions?.write_tool),
    notebookEditTool: toolCounts(day.tool_actions?.notebook_edit_tool),
  });

  const breakdown = day.model_breakdown ?? [];
  return breakdown.map((mb): RawUsageEvent => {
    const model = str(mb.model) ?? 'unknown';
    const amount = mb.estimated_cost?.amount;
    return {
      ts,
      source: 'anthropic-claude-code',
      provider: 'anthropic',
      model,
      surface: 'cli-agent',
      billing,
      granularity: 'day',
      actor: { email, apiKeyId, apiKeyName },
      context: { tags: compactTags({ terminalType: str(day.terminal_type), customerType: str(day.customer_type) }) },
      usage: {
        input: num(mb.tokens?.input),
        output: num(mb.tokens?.output),
        cacheRead: num(mb.tokens?.cache_read),
        cacheWrite5m: num(mb.tokens?.cache_creation),
        cacheWrite1h: 0,
        requests: 0,
      },
      // billedUsd stays null: this is Anthropic's own *estimate*, not a reconciled bill (unlike
      // cost_report's `amount`, §1.3) — clai computes its own cost from the catalog instead, and
      // the provider's figure is kept around for comparison in meta.providerEstimateUsd.
      cost: { billedUsd: null },
      meta: compact({
        organizationId: day.organization_id,
        providerEstimateUsd: typeof amount === 'number' ? amount / 100 : undefined,
        coreMetrics: Object.keys(coreMetrics).length ? coreMetrics : undefined,
        toolActions: Object.keys(toolActions).length ? toolActions : undefined,
      }),
      naturalKey: ['claude-code', ts, identity, model],
    };
  });
}

export const anthropicClaudeCodeConnector: ApiConnector = {
  kind: 'api',
  id: 'anthropic-claude-code',
  displayName: 'Anthropic Claude Code Analytics',
  credentials: [
    {
      key: 'adminKey',
      label: 'Admin API key',
      secret: true,
      envVar: 'ANTHROPIC_ADMIN_KEY',
      help: 'Same Admin API key as the Anthropic Admin connector (Console → Settings → Admin keys).',
    },
  ],

  async verify(ctx, creds) {
    const adminKey = str(creds['adminKey']);
    if (!adminKey) return { ok: false, message: 'Provide an Admin API key (Console → Settings → Admin keys).' };
    const yesterday = new Date(ctx.now().getTime() - 86_400_000).toISOString().slice(0, 10);
    try {
      await requestJson(ctx, `${ADMIN_BASE}/usage_report/claude_code`, { headers: anthropicHeaders(adminKey), query: { starting_at: yesterday, limit: 1 }, retries: 1 });
      return { ok: true, message: 'Connected to the Claude Code Analytics API.' };
    } catch (err) {
      return {
        ok: false,
        message: describeAuthError(err, {
          unauthorized: 'Admin API key rejected for the Claude Code Analytics API — use a Console org Admin key',
          forbidden: 'Admin API key lacks access to Claude Code Analytics for this organization',
        }),
      };
    }
  },

  async *pull(ctx, creds, opts: PullOptions | undefined) {
    const adminKey = str(creds['adminKey']);
    if (!adminKey) {
      ctx.log.warn('anthropic-claude-code: no adminKey credential set, skipping pull');
      return;
    }
    const headers = anthropicHeaders(adminKey);
    const window = resolveWindow(ctx, opts, 'anthropic-claude-code:last_pull', 90);
    const days: string[] = [];
    {
      // usage_report/claude_code takes a single UTC date per request — enumerate the window.
      let d = new Date(Date.UTC(new Date(window.since).getUTCFullYear(), new Date(window.since).getUTCMonth(), new Date(window.since).getUTCDate()));
      const end = Date.UTC(new Date(window.until).getUTCFullYear(), new Date(window.until).getUTCMonth(), new Date(window.until).getUTCDate());
      let guard = 0;
      while (d.getTime() <= end && guard++ < 400) {
        days.push(d.toISOString().slice(0, 10));
        d = new Date(d.getTime() + 86_400_000);
      }
    }
    for (const day of days) {
      const fetchPage = async (page: string | undefined): Promise<CursorPage<ClaudeCodeDay>> => {
        const res = await requestJson<ClaudeCodePage>(ctx, `${ADMIN_BASE}/usage_report/claude_code`, { headers, query: { starting_at: day, limit: 1000, page } });
        return { items: res.body.data ?? [], hasMore: res.body.has_more, nextPage: res.body.next_page };
      };
      for await (const dayRow of paginateCursor(fetchPage)) {
        for (const ev of mapClaudeCodeDay(dayRow)) yield ev;
      }
    }
    markPulled(ctx, 'anthropic-claude-code:last_pull', window.until);
  },
};
