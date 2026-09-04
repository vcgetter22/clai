import type { RawUsageEvent } from '@claii/core';
import type { ApiConnector } from '../types.js';
import { num, str } from '../util/files.js';
import { compact, describeAuthError, isHttpError, markPulled, requestJson, resolveWindow } from './http.js';

/**
 * OpenRouter. Source: https://openrouter.ai/docs (fetched 2026-09-03), base
 * `https://openrouter.ai/api/v1`. `provider` is always `'openrouter'` here — core's model-resolve
 * step (`resolveModel`/`inferProvider` in `@claii/core`) infers the real underlying provider from
 * the `anthropic/claude-sonnet-4.5`-style model id for gateway sources.
 *
 * Two different credential classes exist and are NOT interchangeable: a regular inference key
 * (`apiKey`, used for completions and `GET /auth/key`) and a Management/provisioning key
 * (`managementKey`, required for `GET /activity` and `GET /credits`). Most individual users only
 * ever have the former, so `pull()` can legitimately do nothing — that is not an error condition.
 *
 * `/activity` (§4 of research/other-sources.md) only ever returns a rolling 30-day window and has
 * no `since`/`until` request params (an optional single `date` narrows to one day) — so unlike the
 * other connectors here, the default lookback is capped at 30 days (the provider's max) and pulls
 * are filtered to `[since, until)` client-side after fetching the one available window.
 */

const BASE = 'https://openrouter.ai/api/v1';

interface OpenRouterKeyInfo {
  label?: string;
  usage?: number;
  usage_daily?: number;
  usage_weekly?: number;
  usage_monthly?: number;
  limit?: number | null;
  limit_remaining?: number | null;
  is_free_tier?: boolean;
}

export interface OpenRouterActivityRow {
  date?: string;
  model?: string;
  model_permaslug?: string;
  endpoint_id?: string;
  provider_name?: string;
  usage?: number;
  byok_usage_inference?: number;
  requests?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  reasoning_tokens?: number;
}

export function mapActivityRow(row: OpenRouterActivityRow): RawUsageEvent | null {
  const date = str(row.date);
  if (!date) return null;
  const model = str(row.model) ?? 'unknown';
  return {
    ts: `${date}T00:00:00.000Z`,
    source: 'openrouter',
    provider: 'openrouter',
    model,
    surface: 'api',
    billing: 'api',
    granularity: 'day',
    actor: {},
    context: {},
    usage: {
      input: num(row.prompt_tokens),
      output: num(row.completion_tokens),
      cacheRead: 0,
      cacheWrite5m: 0,
      cacheWrite1h: 0,
      reasoning: num(row.reasoning_tokens),
      requests: num(row.requests),
    },
    // `usage` on this endpoint is already the total USD cost for the model/day/endpoint slice.
    cost: { billedUsd: typeof row.usage === 'number' ? row.usage : null, currency: 'USD', confidence: 'billed' },
    meta: compact({ providerName: row.provider_name, modelPermaslug: row.model_permaslug, endpointId: row.endpoint_id, byokUsageInference: row.byok_usage_inference }),
    naturalKey: ['activity', date, model, row.endpoint_id ?? '', row.provider_name ?? ''],
  };
}

export const openrouterConnector: ApiConnector = {
  kind: 'api',
  id: 'openrouter',
  displayName: 'OpenRouter',
  credentials: [
    { key: 'apiKey', label: 'API key', secret: true, envVar: 'OPENROUTER_API_KEY', help: 'openrouter.ai/settings/keys — a regular inference key.' },
    {
      key: 'managementKey',
      label: 'Management (provisioning) key',
      secret: true,
      optional: true,
      envVar: 'OPENROUTER_MANAGEMENT_KEY',
      help: 'openrouter.ai/settings/provisioning-keys — required for daily activity pulls; a regular inference key cannot call /activity.',
    },
  ],

  async verify(ctx, creds) {
    const apiKey = str(creds['apiKey']);
    if (!apiKey) return { ok: false, message: 'Provide an OpenRouter API key (openrouter.ai/settings/keys).' };
    let keyMsg: string;
    try {
      const res = await requestJson<{ data?: OpenRouterKeyInfo }>(ctx, `${BASE}/auth/key`, { headers: { Authorization: `Bearer ${apiKey}` }, retries: 1 });
      const d = res.body.data;
      const usage = typeof d?.usage === 'number' ? `$${d.usage.toFixed(2)}` : 'unknown';
      const limit = d?.limit == null ? 'unlimited' : `$${d.limit}`;
      keyMsg = `API key valid${d?.label ? ` (${d.label})` : ''} — usage to date ${usage} of ${limit}.`;
    } catch (err) {
      return {
        ok: false,
        message: describeAuthError(err, { unauthorized: 'OpenRouter API key rejected — check openrouter.ai/settings/keys', forbidden: 'OpenRouter API key lacks access' }),
      };
    }
    const managementKey = str(creds['managementKey']);
    if (!managementKey) {
      return {
        ok: true,
        message: `${keyMsg} No management key provided — daily /activity pulls will be skipped (a regular key cannot call it); add a provisioning key from openrouter.ai/settings/provisioning-keys to enable them.`,
      };
    }
    try {
      await requestJson(ctx, `${BASE}/credits`, { headers: { Authorization: `Bearer ${managementKey}` }, retries: 1 });
      return { ok: true, message: `${keyMsg} Management key valid — daily activity pulls enabled.` };
    } catch (err) {
      const detail = describeAuthError(err, { unauthorized: 'rejected (401)', forbidden: 'insufficient scope (403)' });
      return { ok: true, message: `${keyMsg} Management key ${detail} — activity pulls will be skipped until a valid provisioning key is supplied.` };
    }
  },

  async *pull(ctx, creds, opts) {
    const managementKey = str(creds['managementKey']);
    if (!managementKey) {
      ctx.log.warn('openrouter: no managementKey credential set; GET /activity requires a provisioning key, skipping pull');
      return;
    }
    // The API has no since/until params (an optional single `date` narrows to one UTC day) and
    // only ever covers a rolling 30-day window, so we fetch it whole and filter locally.
    const window = resolveWindow(ctx, opts, 'openrouter:last_pull', 30, 3);
    let rows: OpenRouterActivityRow[];
    try {
      const res = await requestJson<{ data?: OpenRouterActivityRow[] }>(ctx, `${BASE}/activity`, { headers: { Authorization: `Bearer ${managementKey}` }, retries: 3 });
      rows = res.body.data ?? [];
    } catch (err) {
      if (isHttpError(err) && (err.status === 401 || err.status === 403)) {
        ctx.log.warn(`openrouter: /activity unavailable (HTTP ${err.status}) — the management key likely lacks provisioning scope; emitting nothing this pull.`);
        return;
      }
      throw err;
    }
    for (const row of rows) {
      const ev = mapActivityRow(row);
      if (!ev) continue;
      if (ev.ts < window.since || ev.ts > window.until) continue;
      yield ev;
    }
    markPulled(ctx, 'openrouter:last_pull', window.until);
  },
};
