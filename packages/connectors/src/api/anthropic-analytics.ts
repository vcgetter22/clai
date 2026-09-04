import type { RawUsageEvent } from '@claii/core';
import type { ConnectorContext } from '../types.js';
import { str } from '../util/files.js';
import { type AnthropicBucketPage, type AnthropicCostResult, type AnthropicUsageResult, anthropicHeaders, flattenBuckets, mapCostResult, mapUsageResult } from './anthropic-admin.js';
import { type CursorPage, compact, describeAuthError, paginateCursor, requestJson } from './http.js';

/**
 * Claude Enterprise Analytics API (`/v1/organizations/analytics/*`) — the separate API family used
 * by claude.ai Enterprise orgs instead of the Console Admin API in `anthropic-admin.ts`, gated by a
 * distinct "Analytics API key" (`read:analytics` scope). Source:
 * https://platform.claude.com/docs/en/manage-claude/analytics-api.
 *
 * This module is deliberately NOT a second registered `ApiConnector` — `registerConnector` dedups
 * by connector `id`, and this data belongs to the same `SourceId` (`'anthropic-admin'`, there is no
 * dedicated Enterprise Analytics `SourceId`) as the Console Admin connector. Instead it exports pull
 * functions that `anthropicAdminConnector.pull()` calls when `creds.analyticsKey` is set. Emitted
 * events carry `meta.api = 'enterprise-analytics'` so they're distinguishable from Console-org rows.
 *
 * `usage_report`/`cost_report` here are documented as structurally identical to the Console
 * `usage_report/messages`/`cost_report` endpoints (same token/cost field vocabulary), so the row
 * mapping is reused from `anthropic-admin.ts`. What's Enterprise-specific is the *dimension* set:
 * `product`, `rbac_group_id`, `slack_channel_id` replace Console's `workspace_id`/`api_key_id`. The
 * exact `group_by[]` enum values for those Enterprise dimensions are UNVERIFIED (the docs page only
 * gives a full example response, not an enumerated group_by list for this specific endpoint), so we
 * only request the `group_by` values confirmed to exist on the sibling Console endpoint (`model`,
 * `service_tier`, `context_window`) to avoid a 400 from guessing an invalid enum string — the
 * Enterprise-only fields are read from the response defensively wherever the API includes them,
 * grouped or not, exactly as shown in the full quoted example.
 */

const ANALYTICS_BASE = 'https://api.anthropic.com/v1/organizations/analytics';

/** Enterprise Analytics adds these dimensions; also defensively look for a user-email dimension
 * (the task brief expects one when available) even though no confirmed field name exists for it —
 * try the couple of plausible spellings a `group_by[]=user_id`-like option might add. UNVERIFIED. */
interface AnalyticsUsageResult extends AnthropicUsageResult {
  email?: string;
  user_email?: string;
  actor?: { email_address?: string };
}

function analyticsActorEmail(r: AnalyticsUsageResult): string | undefined {
  return str(r.email) ?? str(r.user_email) ?? str(r.actor?.email_address);
}

function mapAnalyticsUsageResult(bucketStart: string, bucketEnd: string, r: AnalyticsUsageResult, granularity: 'hour' | 'day'): RawUsageEvent {
  const base = mapUsageResult(bucketStart, bucketEnd, r, {
    granularity,
    sourceMeta: compact({ api: 'enterprise-analytics', product: r.product, rbacGroupId: r.rbac_group_id, slackChannelId: r.slack_channel_id }),
  });
  const email = analyticsActorEmail(r);
  return {
    ...base,
    actor: compact({ ...base.actor, workspaceId: base.actor.workspaceId ?? r.rbac_group_id, email }),
    naturalKey: ['usage', 'analytics', ...(base.naturalKey ?? [])],
  };
}

function mapAnalyticsCostResult(bucketStart: string, bucketEnd: string, r: AnthropicCostResult): RawUsageEvent {
  const base = mapCostResult(bucketStart, bucketEnd, r, { sourceMeta: { api: 'enterprise-analytics' } });
  return { ...base, naturalKey: ['cost', 'analytics', ...(base.naturalKey ?? [])] };
}

const ANALYTICS_USAGE_GROUP_BY = ['model', 'service_tier', 'context_window'];

function bucketWidthFor(since: string, until: string): { bucketWidth: '1h' | '1d'; limit: number; granularity: 'hour' | 'day' } {
  const spanDays = (Date.parse(until) - Date.parse(since)) / 86_400_000;
  return spanDays <= 7 ? { bucketWidth: '1h', limit: 168, granularity: 'hour' } : { bucketWidth: '1d', limit: 31, granularity: 'day' };
}

export async function* pullAnalyticsUsage(ctx: ConnectorContext, analyticsKey: string, since: string, until: string): AsyncGenerator<RawUsageEvent> {
  const { bucketWidth, limit, granularity } = bucketWidthFor(since, until);
  const headers = anthropicHeaders(analyticsKey);
  const fetchPage = async (page: string | undefined): Promise<CursorPage<{ bucketStart: string; bucketEnd: string; result: AnalyticsUsageResult }>> => {
    const res = await requestJson<AnthropicBucketPage<AnalyticsUsageResult>>(ctx, `${ANALYTICS_BASE}/usage_report`, {
      headers,
      query: { starting_at: since, ending_at: until, bucket_width: bucketWidth, limit, page, group_by: ANALYTICS_USAGE_GROUP_BY },
    });
    return { items: flattenBuckets(res.body), hasMore: res.body.has_more, nextPage: res.body.next_page };
  };
  for await (const { bucketStart, bucketEnd, result } of paginateCursor(fetchPage)) {
    yield mapAnalyticsUsageResult(bucketStart, bucketEnd, result, granularity);
  }
}

export async function* pullAnalyticsCost(ctx: ConnectorContext, analyticsKey: string, since: string, until: string): AsyncGenerator<RawUsageEvent> {
  const headers = anthropicHeaders(analyticsKey);
  const fetchPage = async (page: string | undefined): Promise<CursorPage<{ bucketStart: string; bucketEnd: string; result: AnthropicCostResult }>> => {
    const res = await requestJson<AnthropicBucketPage<AnthropicCostResult>>(ctx, `${ANALYTICS_BASE}/cost_report`, {
      headers,
      query: { starting_at: since, ending_at: until, bucket_width: '1d', limit: 31, page, group_by: ['description'] },
    });
    return { items: flattenBuckets(res.body), hasMore: res.body.has_more, nextPage: res.body.next_page };
  };
  for await (const { bucketStart, bucketEnd, result } of paginateCursor(fetchPage)) {
    yield mapAnalyticsCostResult(bucketStart, bucketEnd, result);
  }
}

export async function verifyAnalyticsKey(ctx: ConnectorContext, analyticsKey: string): Promise<{ ok: boolean; message: string }> {
  if (!analyticsKey) return { ok: false, message: 'Provide an Analytics API key (claude.ai → Organization settings → API, read:analytics scope).' };
  const until = ctx.now().toISOString();
  const since = new Date(ctx.now().getTime() - 86_400_000).toISOString();
  try {
    await requestJson(ctx, `${ANALYTICS_BASE}/usage_report`, { headers: anthropicHeaders(analyticsKey), query: { starting_at: since, ending_at: until, bucket_width: '1d', limit: 1 }, retries: 1 });
    return { ok: true, message: 'Connected with Analytics API key (Claude Enterprise Analytics API).' };
  } catch (err) {
    return {
      ok: false,
      message: describeAuthError(err, {
        unauthorized: 'Analytics API key rejected — create one at claude.ai → Organization settings → API (primary owner only, read:analytics scope)',
        forbidden: 'Analytics API key lacks the read:analytics scope, or this organization has no Claude Enterprise Analytics access',
      }),
    };
  }
}
