import type { ConnectorContext, PullOptions } from '../types.js';

/**
 * Shared HTTP plumbing for provider API connectors.
 *
 * All network access goes through `ctx.fetch` (falling back to the global `fetch` only when the
 * caller did not inject one, e.g. real CLI runs). Tests MUST inject a fake `ctx.fetch` so no
 * connector test ever makes a real network call.
 */

export class HttpError extends Error {
  readonly status: number;
  readonly url: string;
  readonly body: unknown;
  constructor(status: number, url: string, body: unknown, message?: string) {
    super(message ?? `HTTP ${status} for ${stripQuery(url)}`);
    this.name = 'HttpError';
    this.status = status;
    this.url = url;
    this.body = body;
  }
}

export function isHttpError(err: unknown): err is HttpError {
  return err instanceof HttpError;
}

/** Best-effort human string from a JSON error body (`{error:{message}}`, `{message}`, or a plain string). */
export function errorBodyMessage(body: unknown): string | undefined {
  if (typeof body === 'string') return body.slice(0, 500);
  if (body && typeof body === 'object') {
    const o = body as Record<string, unknown>;
    const err = o['error'];
    if (err && typeof err === 'object' && typeof (err as Record<string, unknown>)['message'] === 'string') {
      return (err as Record<string, unknown>)['message'] as string;
    }
    if (typeof o['message'] === 'string') return o['message'] as string;
  }
  return undefined;
}

function stripQuery(url: string): string {
  const i = url.indexOf('?');
  return i === -1 ? url : url.slice(0, i);
}

function sleep(ms: number): Promise<void> {
  return ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));
}

function retryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(header);
  return Number.isNaN(at) ? null : Math.max(0, at - Date.now());
}

function backoffMs(attempt: number, base: number, max: number): number {
  const exp = Math.min(max, base * 2 ** attempt);
  return Math.round(exp * (0.5 + Math.random() * 0.5));
}

export type QueryValue = string | number | boolean | undefined | null | ReadonlyArray<string | number>;

/** Anthropic and OpenAI both use repeated `key[]=v` for array-valued params; this matches both. */
export function toQuery(params: Record<string, QueryValue>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      for (const item of v) sp.append(`${k}[]`, String(item));
    } else {
      sp.append(k, String(v));
    }
  }
  return sp.toString();
}

export function withQuery(url: string, params: Record<string, QueryValue>): string {
  const qs = toQuery(params);
  if (!qs) return url;
  return `${url}${url.includes('?') ? '&' : '?'}${qs}`;
}

export interface RequestJsonInit {
  method?: string;
  headers?: Record<string, string>;
  query?: Record<string, QueryValue>;
  body?: unknown;
  /** Max retry attempts on 429/5xx/network error. Default 4. */
  retries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

export interface HttpResponse<T> {
  status: number;
  headers: Headers;
  body: T;
}

/**
 * GET/POST/... a JSON endpoint with retry-with-backoff on 429 and 5xx (honouring `Retry-After`
 * when present), and on transport-level errors. Non-2xx responses that are not retried (4xx other
 * than 429, or retries exhausted) throw `HttpError`.
 */
export async function requestJson<T = unknown>(ctx: ConnectorContext, url: string, init: RequestJsonInit = {}): Promise<HttpResponse<T>> {
  const { query, retries = 4, baseDelayMs = 300, maxDelayMs = 8000, method, headers, body } = init;
  const fullUrl = query ? withQuery(url, query) : url;
  const fetchFn = ctx.fetch ?? globalThis.fetch;
  if (!fetchFn) throw new Error('No fetch implementation available: inject ctx.fetch (tests must always do this)');
  const reqInit: RequestInit = { method, headers };
  if (body !== undefined) reqInit.body = typeof body === 'string' ? body : JSON.stringify(body);

  let attempt = 0;
  for (;;) {
    let res: Response;
    try {
      res = await fetchFn(fullUrl, reqInit);
    } catch (err) {
      if (attempt >= retries) throw err;
      const delay = backoffMs(attempt, baseDelayMs, maxDelayMs);
      ctx.log.warn(`network error calling ${stripQuery(fullUrl)}: ${(err as Error).message}; retrying in ${delay}ms`);
      await sleep(delay);
      attempt++;
      continue;
    }
    if ((res.status === 429 || res.status >= 500) && attempt < retries) {
      const delay = retryAfterMs(res.headers.get('retry-after')) ?? backoffMs(attempt, baseDelayMs, maxDelayMs);
      ctx.log.warn(`http ${res.status} from ${stripQuery(fullUrl)}; retrying in ${delay}ms (attempt ${attempt + 1}/${retries})`);
      await sleep(delay);
      attempt++;
      continue;
    }
    const text = await res.text();
    let parsed: unknown;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    if (!res.ok) throw new HttpError(res.status, fullUrl, parsed, errorBodyMessage(parsed));
    return { status: res.status, headers: res.headers, body: parsed as T };
  }
}

/** Like `requestJson` but returns the raw response text (for NDJSON downloads etc). */
export async function requestText(ctx: ConnectorContext, url: string, init: RequestJsonInit = {}): Promise<string> {
  const { query, retries = 4, baseDelayMs = 300, maxDelayMs = 8000, method, headers } = init;
  const fullUrl = query ? withQuery(url, query) : url;
  const fetchFn = ctx.fetch ?? globalThis.fetch;
  if (!fetchFn) throw new Error('No fetch implementation available: inject ctx.fetch (tests must always do this)');
  let attempt = 0;
  for (;;) {
    let res: Response;
    try {
      res = await fetchFn(fullUrl, { method, headers });
    } catch (err) {
      if (attempt >= retries) throw err;
      const delay = backoffMs(attempt, baseDelayMs, maxDelayMs);
      await sleep(delay);
      attempt++;
      continue;
    }
    if ((res.status === 429 || res.status >= 500) && attempt < retries) {
      const delay = retryAfterMs(res.headers.get('retry-after')) ?? backoffMs(attempt, baseDelayMs, maxDelayMs);
      ctx.log.warn(`http ${res.status} from ${stripQuery(fullUrl)}; retrying in ${delay}ms (attempt ${attempt + 1}/${retries})`);
      await sleep(delay);
      attempt++;
      continue;
    }
    const text = await res.text();
    if (!res.ok) throw new HttpError(res.status, fullUrl, text);
    return text;
  }
}

/** Parse newline-delimited JSON, skipping blank lines and (defensively) unparsable ones. */
export function parseNdjson<T = unknown>(text: string): T[] {
  const out: T[] = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t) as T);
    } catch {
      // Skip malformed lines rather than fail the whole report.
    }
  }
  return out;
}

export interface CursorPage<T> {
  items: T[];
  nextPage?: string | null;
  hasMore?: boolean;
}

/**
 * Drain a `next_page`-cursor-paginated endpoint (Anthropic Admin/Analytics API, OpenAI Usage/Costs
 * API) into a flat async stream, calling `fetchPage` again as long as more pages are indicated.
 */
export async function* paginateCursor<T>(fetchPage: (page: string | undefined) => Promise<CursorPage<T>>, opts: { maxPages?: number } = {}): AsyncGenerator<T> {
  const maxPages = opts.maxPages ?? 1000;
  let page: string | undefined;
  let n = 0;
  for (;;) {
    const res = await fetchPage(page);
    for (const item of res.items) yield item;
    n++;
    if (n >= maxPages) break;
    if (res.hasMore === false) break;
    if (!res.nextPage) break;
    page = res.nextPage;
  }
}

/** Parse a GitHub-style `Link` response header into `{ rel: url }`. */
export function parseLinkHeader(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(',')) {
    const m = /<([^>]+)>\s*;\s*rel="([^"]+)"/.exec(part.trim());
    const link = m?.[1];
    const rel = m?.[2];
    if (link && rel) out[rel] = link;
  }
  return out;
}

export interface PullWindow {
  since: string;
  until: string;
  /** True when there was no saved cursor (first pull / `full`), so the default lookback applied. */
  isFirstPull: boolean;
}

/**
 * Resolve the [since, until) window for a pull: `opts.since`/`opts.until` always win; otherwise
 * resume from the saved `last_pull` cursor minus `overlapDays` (to catch late-arriving/revised
 * data), or fall back to `defaultLookbackDays` on a first/`full` pull.
 */
export function resolveWindow(ctx: ConnectorContext, opts: PullOptions | undefined, stateKey: string, defaultLookbackDays: number, overlapDays = 3): PullWindow {
  const now = ctx.now();
  const until = opts?.until ?? now.toISOString();
  if (opts?.since) return { since: opts.since, until, isFirstPull: false };
  const last = opts?.full ? undefined : ctx.state.get(stateKey);
  if (!last) {
    const since = new Date(now.getTime() - defaultLookbackDays * 86_400_000).toISOString();
    return { since, until, isFirstPull: true };
  }
  const since = new Date(Math.min(Date.parse(last), now.getTime()) - overlapDays * 86_400_000).toISOString();
  return { since, until, isFirstPull: false };
}

export function markPulled(ctx: ConnectorContext, stateKey: string, until: string): void {
  ctx.state.set(stateKey, until);
}

/** Split a [since, until) ISO window into UTC calendar-day strings (YYYY-MM-DD), inclusive of both ends. */
export function isoDayRange(sinceIso: string, untilIso: string): string[] {
  const out: string[] = [];
  const start = new Date(sinceIso);
  const end = new Date(untilIso);
  const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const endDay = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  let guard = 0;
  while (d.getTime() <= endDay && guard++ < 5000) {
    const iso = d.toISOString().slice(0, 10);
    out.push(iso);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export function unixSeconds(iso: string): number {
  return Math.floor(Date.parse(iso) / 1000);
}

export function basicAuthHeader(username: string, password = ''): string {
  return `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`;
}

/** Drop `undefined`/`null` valued keys so `meta` objects stay small and clean. */
export function compact<T extends Record<string, unknown>>(obj: T): T {
  const out = {} as T;
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== null) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

/**
 * Like `compact`, but narrows the return type to `Record<string, string>` (dropping undefined
 * values, not just filtering them at runtime) — for `EventContext.tags`, which is a plain index
 * signature type, so `exactOptionalPropertyTypes` doesn't rescue a `string | undefined` value the
 * way it does for optional properties like `Actor.email?`.
 */
export function compactTags(obj: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/** Turn a thrown error (ideally an `HttpError`) into a helpful, credential-specific `verify()` message. */
export function describeAuthError(err: unknown, opts: { unauthorized: string; forbidden: string; fallback?: string }): string {
  if (isHttpError(err)) {
    const detail = errorBodyMessage(err.body);
    if (err.status === 401) return detail ? `${opts.unauthorized} (${detail})` : opts.unauthorized;
    if (err.status === 403) return detail ? `${opts.forbidden} (${detail})` : opts.forbidden;
    return detail ? `HTTP ${err.status}: ${detail}` : `HTTP ${err.status} from ${stripQuery(err.url)}`;
  }
  return opts.fallback ?? (err instanceof Error ? err.message : String(err));
}
