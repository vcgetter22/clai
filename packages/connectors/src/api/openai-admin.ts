import type { RawUsageEvent } from '@claii/core';
import { emptyUsage } from '@claii/core';
import type { ApiConnector, ConnectorContext } from '../types.js';
import { num, str } from '../util/files.js';
import { type CursorPage, compact, describeAuthError, markPulled, paginateCursor, requestJson, resolveWindow, unixSeconds } from './http.js';

/**
 * OpenAI Admin API: `/v1/organization/usage/completions` (tokens) + `/v1/organization/costs`
 * (billed USD). Source: https://developers.openai.com/api/docs/guides/admin-apis and
 * https://developers.openai.com/cookbook/examples/completions_usage_api.
 *
 * Auth is `Authorization: Bearer <ADMIN_KEY>` with an **organization** Admin key
 * (`platform.openai.com/settings/organization/admin-keys`) — distinct from a project API key
 * (`sk-proj-...`) and from the separate ChatGPT-workspace "Admin key" used for Compliance/Codex
 * Analytics (a different product surface entirely, not implemented here).
 *
 * Time params are **Unix seconds** here (`start_time`/`end_time`), unlike Anthropic's RFC 3339
 * strings — see `unixSeconds()`.
 *
 * UNVERIFIED (research/openai-sources.md §1.2): a single fetch of the API reference showed a
 * richer per-modality field set on the completions result object (`input_cache_write_tokens`,
 * `input_text_tokens`, `input_image_tokens`, etc.) beyond the stable cookbook-documented fields
 * used here. We only read the stable fields (`input_tokens`, `input_cached_tokens`,
 * `output_tokens`, `num_model_requests`) and ignore unknown extra keys rather than guess at a
 * possibly-transient schema.
 */

const BASE = 'https://api.openai.com/v1';

function openaiHeaders(adminKey: string): Record<string, string> {
  return { Authorization: `Bearer ${adminKey}`, 'Content-Type': 'application/json' };
}

interface OpenAiBucket<R> {
  object?: string;
  start_time: number;
  end_time: number;
  results?: R[];
}

interface OpenAiPage<R> {
  object?: string;
  data?: OpenAiBucket<R>[];
  has_more?: boolean;
  next_page?: string | null;
}

function flattenOpenAiBuckets<R>(page: OpenAiPage<R>): { bucketStart: string; bucketEnd: string; result: R }[] {
  const out: { bucketStart: string; bucketEnd: string; result: R }[] = [];
  for (const b of page.data ?? []) {
    const bucketStart = new Date(b.start_time * 1000).toISOString();
    const bucketEnd = new Date(b.end_time * 1000).toISOString();
    for (const r of b.results ?? []) out.push({ bucketStart, bucketEnd, result: r });
  }
  return out;
}

/** `organization.usage.completions.result` — stable field set per the cookbook example. */
export interface OpenAiCompletionsResult {
  object?: string;
  input_tokens?: number;
  input_cached_tokens?: number;
  output_tokens?: number;
  input_audio_tokens?: number;
  output_audio_tokens?: number;
  num_model_requests?: number;
  project_id?: string | null;
  user_id?: string | null;
  api_key_id?: string | null;
  model?: string | null;
  batch?: boolean;
  service_tier?: string | null;
}

/** `organization.costs.result`. */
export interface OpenAiCostsResult {
  object?: string;
  amount?: { value?: number; currency?: string };
  line_item?: string | null;
  project_id?: string | null;
  api_key_id?: string | null;
}

export interface NameMaps {
  projectNames?: Map<string, string>;
  userNames?: Map<string, { name?: string; email?: string }>;
  apiKeyNames?: Map<string, string>;
}

export function mapCompletionsResult(bucketStart: string, bucketEnd: string, r: OpenAiCompletionsResult, opts: NameMaps = {}): RawUsageEvent {
  const projectId = str(r.project_id ?? undefined);
  const userId = str(r.user_id ?? undefined);
  const apiKeyId = str(r.api_key_id ?? undefined);
  const model = str(r.model ?? undefined) ?? 'unknown';
  // OpenAI's input_tokens INCLUDES input_cached_tokens — subtract to get billable uncached input.
  const inputIncl = num(r.input_tokens);
  const cached = Math.max(0, num(r.input_cached_tokens));
  const user = userId ? opts.userNames?.get(userId) : undefined;
  return {
    ts: bucketStart,
    periodEnd: bucketEnd,
    source: 'openai-admin',
    provider: 'openai',
    model,
    surface: r.batch ? 'batch' : 'api',
    billing: 'api',
    granularity: 'day',
    actor: compact({
      projectId,
      projectName: projectId ? opts.projectNames?.get(projectId) : undefined,
      userId,
      name: user?.name,
      email: user?.email,
      apiKeyId,
      apiKeyName: apiKeyId ? opts.apiKeyNames?.get(apiKeyId) : undefined,
    }),
    context: compact({ serviceTier: str(r.service_tier ?? undefined) }),
    usage: {
      input: Math.max(0, inputIncl - cached),
      output: num(r.output_tokens),
      cacheRead: cached,
      cacheWrite5m: 0,
      cacheWrite1h: 0,
      requests: num(r.num_model_requests),
    },
    naturalKey: ['usage', bucketStart, model, projectId ?? '', userId ?? '', apiKeyId ?? '', r.batch ? 'batch' : 'sync', str(r.service_tier ?? undefined) ?? ''],
  };
}

/** `line_item` looks like `"gpt-4o-2024-08-06, input"` — strip the trailing kind suffix to get the model id. */
export function parseLineItemModel(lineItem: string | null | undefined): { model: string; kind?: string } {
  const s = str(lineItem ?? undefined);
  if (!s) return { model: 'unknown' };
  const m = /^(.*?),\s*(input|output|cached input|cached_input)\s*$/i.exec(s);
  const prefix = m?.[1];
  const kind = m?.[2];
  if (prefix && kind) return { model: prefix.trim(), kind: kind.toLowerCase().replace('_', ' ') };
  return { model: s };
}

export function mapCostsResult(bucketStart: string, bucketEnd: string, r: OpenAiCostsResult, opts: NameMaps = {}): RawUsageEvent {
  const projectId = str(r.project_id ?? undefined);
  const lineItem = str(r.line_item ?? undefined) ?? '';
  const { model, kind } = parseLineItemModel(lineItem);
  const value = r.amount?.value;
  return {
    ts: bucketStart,
    periodEnd: bucketEnd,
    source: 'openai-admin',
    provider: 'openai',
    model,
    surface: 'api',
    billing: 'api',
    granularity: 'day',
    actor: compact({ projectId, projectName: projectId ? opts.projectNames?.get(projectId) : undefined }),
    context: {},
    usage: emptyUsage(),
    cost: { billedUsd: typeof value === 'number' ? value : null, currency: 'USD', confidence: 'billed' },
    meta: compact({ lineItem, kind }),
    naturalKey: ['cost', bucketStart, projectId ?? '', lineItem],
  };
}

async function loadIdNameMap(ctx: ConnectorContext, headers: Record<string, string>, url: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  let after: string | undefined;
  let guard = 0;
  for (;;) {
    let res;
    try {
      res = await requestJson<{ data?: Array<{ id?: string; name?: string }>; has_more?: boolean }>(ctx, url, { headers, query: { limit: 100, after }, retries: 2 });
    } catch (err) {
      ctx.log.warn(`openai-admin: failed to load ${url}: ${(err as Error).message}`);
      break;
    }
    const data = res.body.data ?? [];
    for (const item of data) if (item.id) map.set(item.id, item.name ?? item.id);
    guard++;
    const lastId = data.length ? data[data.length - 1]?.id : undefined;
    if (!res.body.has_more || !lastId || guard > 50) break;
    after = lastId;
  }
  return map;
}

async function loadUsers(ctx: ConnectorContext, headers: Record<string, string>): Promise<Map<string, { name?: string; email?: string }>> {
  const map = new Map<string, { name?: string; email?: string }>();
  let after: string | undefined;
  let guard = 0;
  for (;;) {
    let res;
    try {
      res = await requestJson<{ data?: Array<{ id?: string; name?: string; email?: string }>; has_more?: boolean }>(ctx, `${BASE}/organization/users`, {
        headers,
        query: { limit: 100, after },
        retries: 2,
      });
    } catch (err) {
      ctx.log.warn(`openai-admin: failed to load users: ${(err as Error).message}`);
      break;
    }
    const data = res.body.data ?? [];
    for (const u of data) if (u.id) map.set(u.id, { name: u.name, email: u.email });
    guard++;
    const lastId = data.length ? data[data.length - 1]?.id : undefined;
    if (!res.body.has_more || !lastId || guard > 50) break;
    after = lastId;
  }
  return map;
}

async function getApiKeyMap(ctx: ConnectorContext, headers: Record<string, string>, cache: Map<string, Map<string, string>>, projectId: string): Promise<Map<string, string>> {
  const cached = cache.get(projectId);
  if (cached) return cached;
  const map = await loadIdNameMap(ctx, headers, `${BASE}/organization/projects/${encodeURIComponent(projectId)}/api_keys`);
  cache.set(projectId, map);
  return map;
}

const USAGE_GROUP_BY = ['project_id', 'user_id', 'api_key_id', 'model', 'batch', 'service_tier'];

export async function* pullCompletionsUsage(ctx: ConnectorContext, headers: Record<string, string>, since: string, until: string, names: { projectNames: Map<string, string>; userNames: Map<string, { name?: string; email?: string }> }): AsyncGenerator<RawUsageEvent> {
  const apiKeyCache = new Map<string, Map<string, string>>();
  const fetchPage = async (page: string | undefined): Promise<CursorPage<{ bucketStart: string; bucketEnd: string; result: OpenAiCompletionsResult }>> => {
    const res = await requestJson<OpenAiPage<OpenAiCompletionsResult>>(ctx, `${BASE}/organization/usage/completions`, {
      headers,
      query: { start_time: unixSeconds(since), end_time: unixSeconds(until), bucket_width: '1d', limit: 31, page, group_by: USAGE_GROUP_BY },
    });
    return { items: flattenOpenAiBuckets(res.body), hasMore: res.body.has_more, nextPage: res.body.next_page };
  };
  for await (const { bucketStart, bucketEnd, result } of paginateCursor(fetchPage)) {
    const apiKeyNames = result.project_id && result.api_key_id ? await getApiKeyMap(ctx, headers, apiKeyCache, result.project_id) : undefined;
    yield mapCompletionsResult(bucketStart, bucketEnd, result, { projectNames: names.projectNames, userNames: names.userNames, apiKeyNames });
  }
}

export async function* pullCostReport(ctx: ConnectorContext, headers: Record<string, string>, since: string, until: string, projectNames: Map<string, string>): AsyncGenerator<RawUsageEvent> {
  const fetchPage = async (page: string | undefined): Promise<CursorPage<{ bucketStart: string; bucketEnd: string; result: OpenAiCostsResult }>> => {
    const res = await requestJson<OpenAiPage<OpenAiCostsResult>>(ctx, `${BASE}/organization/costs`, {
      headers,
      query: { start_time: unixSeconds(since), end_time: unixSeconds(until), bucket_width: '1d', limit: 180, page, group_by: ['project_id', 'line_item'] },
    });
    return { items: flattenOpenAiBuckets(res.body), hasMore: res.body.has_more, nextPage: res.body.next_page };
  };
  for await (const { bucketStart, bucketEnd, result } of paginateCursor(fetchPage)) {
    yield mapCostsResult(bucketStart, bucketEnd, result, { projectNames });
  }
}

export const openaiAdminConnector: ApiConnector = {
  kind: 'api',
  id: 'openai-admin',
  displayName: 'OpenAI Admin API',
  credentials: [
    {
      key: 'adminKey',
      label: 'Organization Admin key',
      secret: true,
      envVar: 'OPENAI_ADMIN_KEY',
      help: 'platform.openai.com/settings/organization/admin-keys → Create new admin key. Organization owner only. Distinct from a project API key (sk-proj-...).',
    },
  ],

  async verify(ctx, creds) {
    const adminKey = str(creds['adminKey']);
    if (!adminKey) return { ok: false, message: 'Provide an organization Admin API key (platform.openai.com/settings/organization/admin-keys).' };
    try {
      const res = await requestJson<{ data?: unknown[] }>(ctx, `${BASE}/organization/projects`, { headers: openaiHeaders(adminKey), query: { limit: 1 }, retries: 1 });
      const n = res.body.data?.length ?? 0;
      return { ok: true, message: `Connected with organization Admin API key (${n} project${n === 1 ? '' : 's'} visible).` };
    } catch (err) {
      return {
        ok: false,
        message: describeAuthError(err, {
          unauthorized: 'Admin API key rejected — create one at platform.openai.com/settings/organization/admin-keys (organization owner only, not a project sk-proj-... key)',
          forbidden: 'Admin API key lacks the required scope for organization usage/cost data — re-create it with the Usage/Costs read scopes enabled',
        }),
      };
    }
  },

  async *pull(ctx, creds, opts) {
    const adminKey = str(creds['adminKey']);
    if (!adminKey) {
      ctx.log.warn('openai-admin: no adminKey credential set, skipping pull');
      return;
    }
    const headers = openaiHeaders(adminKey);
    const [projectNames, userNames] = await Promise.all([loadIdNameMap(ctx, headers, `${BASE}/organization/projects`), loadUsers(ctx, headers)]);

    const usageWindow = resolveWindow(ctx, opts, 'openai-admin:usage:last_pull', 90);
    ctx.log.debug(`openai-admin: pulling usage/completions ${usageWindow.since}..${usageWindow.until}`);
    for await (const ev of pullCompletionsUsage(ctx, headers, usageWindow.since, usageWindow.until, { projectNames, userNames })) yield ev;
    markPulled(ctx, 'openai-admin:usage:last_pull', usageWindow.until);

    const costWindow = resolveWindow(ctx, opts, 'openai-admin:cost:last_pull', 90);
    ctx.log.debug(`openai-admin: pulling costs ${costWindow.since}..${costWindow.until}`);
    for await (const ev of pullCostReport(ctx, headers, costWindow.since, costWindow.until, projectNames)) yield ev;
    markPulled(ctx, 'openai-admin:cost:last_pull', costWindow.until);
  },
};
