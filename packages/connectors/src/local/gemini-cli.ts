import { existsSync, readFileSync } from 'node:fs';
import { basename, isAbsolute, join, sep } from 'node:path';
import type { RawUsageEvent } from '@claii/core';
import type { ConnectorContext, Detection, LocalConnector, ScanOptions } from '../types.js';
import { fileMeta, num, readFileState, readLinesFrom, safeJson, str, walk, writeFileState } from '../util/files.js';

/**
 * Gemini CLI local usage data.
 *
 * Home: `GEMINI_CLI_HOME` or `~/.gemini`. Three local artifact types live under it:
 *  - `tmp/<project-hash>/chats/*.json`  — saved chat checkpoints (`/chat save` / `/chat resume`).
 *  - `tmp/<project-hash>/logs.json`     — CLI prompt history (input up-arrow recall).
 *  - the OTel local telemetry outfile configured via `telemetry.outfile` in `settings.json`
 *    (written when `telemetry.enabled` and `telemetry.target` is local), carrying
 *    `gemini_cli.api_response` events with per-call model/input_token_count/output_token_count/
 *    cached_content_token_count/thoughts_token_count.
 *
 * LIMITATION (research/other-sources.md §1c "Gemini CLI — local files & telemetry"): the research
 * could not independently confirm the exact filenames/schema of the chat-checkpoint and
 * prompt-history artifacts under `tmp/<project-hash>/` — UNVERIFIED exact filenames, though the
 * existence of a per-project-hash tmp directory holding session history is corroborated by
 * multiple community docs. Either way, neither artifact is documented to record per-turn token
 * usage. `detect()` still reports how many of these files exist (a useful signal that Gemini CLI
 * is in use), but `scan()` only ever emits events from the telemetry outfile, since the research's
 * `gemini_cli.api_response` OTel event is the one confirmed, structured record for per-call token
 * usage. Without telemetry enabled + a local outfile configured, clai cannot see Gemini CLI token
 * usage at all; `detect().summary` says so explicitly.
 *
 * UNVERIFIED (research/other-sources.md §1c: no sample outfile was fetched to inspect against —
 * only the field list in the docs' quoted `gemini_cli.api_response` example): we assume the
 * outfile is newline-delimited JSON, one record per line (the common shape for OTel JS file/console
 * exporters — also matches how every other local connector here reads its logs), tolerating both
 * a nested `attributes` bag and attributes flattened onto the record itself. We also assume
 * `total_token_count = input + output(candidates) + thoughts + tool`, i.e. `thoughts_token_count`
 * is *not* already folded into `output_token_count` (the research's own example totals only add up
 * this way: 8231 input + 512 output + 128 thoughts + 64 tool = 8935 total — thoughts is a sibling
 * of candidates/output, not a subset, and `cached_content_token_count` IS already included in
 * `input_token_count`, mirroring Gemini's documented `usageMetadata` shape where
 * `cachedContentTokenCount` is a subset of `promptTokenCount`), so we subtract cached from `input`
 * and add thoughts into `output` — consistent with core's convention (packages/core/src/types.ts)
 * that `input` excludes cache and `output` must include reasoning tokens for cost accounting — and
 * mirror thoughts into `reasoning`. If the real outfile uses a different record shape,
 * `parseGeminiTelemetryLine` simply returns null per line and `scan()` yields nothing rather than
 * crashing.
 */

export function geminiHome(env: NodeJS.ProcessEnv, home: string): string {
  return env['GEMINI_CLI_HOME']?.trim() || join(home, '.gemini');
}

/** Chat checkpoint files saved by `/chat save` (no token usage recorded). */
export function geminiChatCheckpoints(home: string): string[] {
  return walk(join(home, 'tmp'), (n, full) => n.endsWith('.json') && full.split(sep).includes('chats'));
}

/** Prompt-history files backing the CLI's input recall (no token usage recorded). */
export function geminiLogsFiles(home: string): string[] {
  return walk(join(home, 'tmp'), (n) => n === 'logs.json');
}

/**
 * Resolve the configured OTel local telemetry outfile, if any: `GEMINI_TELEMETRY_OUTFILE` (the
 * documented env var override for the `telemetry.outfile` setting, research/other-sources.md §1c)
 * takes precedence, falling back to `telemetry.outfile` in `settings.json`.
 */
export function geminiTelemetryOutfile(env: NodeJS.ProcessEnv, home: string): string | undefined {
  const envOutfile = str(env['GEMINI_TELEMETRY_OUTFILE']);
  if (envOutfile) return isAbsolute(envOutfile) ? envOutfile : join(home, envOutfile);
  const settingsPath = join(home, 'settings.json');
  if (!existsSync(settingsPath)) return undefined;
  try {
    const raw = JSON.parse(readFileSync(settingsPath, 'utf8')) as { telemetry?: { outfile?: string } };
    const outfile = str(raw.telemetry?.outfile);
    if (!outfile) return undefined;
    return isAbsolute(outfile) ? outfile : join(home, outfile);
  } catch {
    return undefined;
  }
}

export interface ParsedGeminiApiResponse {
  ts: string;
  model: string;
  sessionId?: string;
  cwd?: string;
  responseId?: string;
  promptId?: string;
  input: number;
  cacheRead: number;
  output: number;
  reasoning: number;
}

function extractTimestamp(rec: Record<string, unknown>): string | undefined {
  const raw = rec['timestamp'] ?? rec['time'] ?? rec['observedTimestamp'] ?? rec['observed_timestamp'];
  if (typeof raw === 'string') {
    const ms = Date.parse(raw);
    if (!Number.isNaN(ms)) return new Date(ms).toISOString();
  } else if (typeof raw === 'number') {
    if (raw > 1e17) return new Date(raw / 1e6).toISOString(); // epoch nanoseconds
    if (raw > 1e12) return new Date(raw).toISOString(); // epoch milliseconds
    if (raw > 1e9) return new Date(raw * 1000).toISOString(); // epoch seconds
  } else if (Array.isArray(raw) && raw.length === 2 && typeof raw[0] === 'number' && typeof raw[1] === 'number') {
    return new Date(raw[0] * 1000 + raw[1] / 1e6).toISOString(); // [seconds, nanoseconds] hrtime-style tuple
  }
  return undefined;
}

/** Parse one line of the OTel outfile; returns null for anything that isn't a matching api_response event. */
export function parseGeminiTelemetryLine(line: string): ParsedGeminiApiResponse | null {
  if (!line.includes('gemini_cli.api_response')) return null; // cheap pre-filter before JSON.parse
  const rec = safeJson<Record<string, unknown>>(line);
  if (!rec) return null;
  const attrsRaw = rec['attributes'];
  const attrs = attrsRaw && typeof attrsRaw === 'object' ? (attrsRaw as Record<string, unknown>) : rec;
  const eventName = str(attrs['event.name']) ?? str(attrs['event_name']) ?? str(rec['event.name']) ?? str(rec['event_name']) ?? str(rec['name']);
  if (eventName !== 'gemini_cli.api_response') return null;
  const ts = extractTimestamp(rec) ?? extractTimestamp(attrs);
  if (!ts) return null;
  const cached = num(attrs['cached_content_token_count']);
  const thoughts = num(attrs['thoughts_token_count']);
  return {
    ts,
    model: str(attrs['model']) ?? 'unknown',
    sessionId: str(attrs['session.id']) ?? str(attrs['session_id']),
    cwd: str(attrs['cwd']),
    responseId: str(attrs['response_id']) ?? str(attrs['response.id']),
    promptId: str(attrs['prompt_id']) ?? str(attrs['prompt.id']),
    input: Math.max(0, num(attrs['input_token_count']) - cached),
    cacheRead: cached,
    output: num(attrs['output_token_count']) + thoughts,
    reasoning: thoughts,
  };
}

export function toGeminiEvent(p: ParsedGeminiApiResponse, opts: { plan?: string; identity?: ConnectorContext['identity']; idx: number }): RawUsageEvent {
  return {
    ts: p.ts,
    source: 'gemini-cli',
    provider: 'google',
    model: p.model,
    surface: 'cli-agent',
    billing: opts.plan ? 'subscription' : 'unknown',
    plan: opts.plan,
    granularity: 'request',
    actor: { email: opts.identity?.email, name: opts.identity?.name },
    context: {
      sessionId: p.sessionId,
      cwd: p.cwd,
      project: p.cwd ? basename(p.cwd) : undefined,
      device: opts.identity?.device,
    },
    usage: { input: p.input, output: p.output, cacheRead: p.cacheRead, cacheWrite5m: 0, cacheWrite1h: 0, reasoning: p.reasoning, requests: 1 },
    naturalKey: [p.sessionId ?? 'session', p.responseId ?? p.promptId ?? `${p.ts}-${opts.idx}`],
  };
}

export const geminiCliConnector: LocalConnector = {
  kind: 'local',
  id: 'gemini-cli',
  displayName: 'Gemini CLI',

  async detect(ctx: ConnectorContext): Promise<Detection> {
    const home = geminiHome(ctx.env, ctx.home);
    if (!existsSync(home)) return { found: false, summary: 'No Gemini CLI data found (~/.gemini)', paths: [] };
    const chats = geminiChatCheckpoints(home);
    const logs = geminiLogsFiles(home);
    const outfile = geminiTelemetryOutfile(ctx.env, home);
    const hasOutfile = !!outfile && existsSync(outfile);
    const summary = hasOutfile
      ? `OTel telemetry outfile with usage data at ${outfile}; ${chats.length} chat checkpoint(s) and ${logs.length} logs.json file(s) also found (no per-turn usage recorded there)`
      : `No OTel telemetry outfile configured (per-turn token usage unavailable) — ${chats.length} chat checkpoint(s) and ${logs.length} logs.json file(s) found in ${home}, but Gemini CLI does not record token usage in them; enable telemetry with a local outfile in settings.json to track usage`;
    return {
      found: hasOutfile || chats.length > 0 || logs.length > 0,
      summary,
      paths: [home],
      details: { chats: chats.length, logs: logs.length, telemetryOutfile: outfile ?? null, telemetryOutfileFound: hasOutfile },
    };
  },

  async *scan(ctx: ConnectorContext, opts: ScanOptions = {}): AsyncGenerator<RawUsageEvent> {
    const home = geminiHome(ctx.env, ctx.home);
    const outfile = geminiTelemetryOutfile(ctx.env, home);
    if (!outfile || !existsSync(outfile)) return;
    const plan = ctx.planFor('google');
    const meta = fileMeta(outfile);
    if (!meta) return;
    const prev = opts.full ? undefined : readFileState(ctx.state, outfile);
    let offset = 0;
    if (prev && prev.size <= meta.size && prev.offset <= meta.size) offset = prev.offset;
    if (offset >= meta.size && prev && prev.mtimeMs === meta.mtimeMs) return; // unchanged
    if (opts.since && meta.mtimeMs < Date.parse(opts.since) && !prev) {
      writeFileState(ctx.state, outfile, { size: meta.size, mtimeMs: meta.mtimeMs, offset: meta.size });
      return;
    }
    let idx = 0;
    let end = offset;
    try {
      for await (const { line, end: lineEnd } of readLinesFrom(outfile, offset)) {
        end = lineEnd;
        const parsed = parseGeminiTelemetryLine(line);
        if (!parsed) continue;
        idx += 1;
        const ev = toGeminiEvent(parsed, { plan, identity: ctx.identity, idx });
        if (opts.since && ev.ts < opts.since) continue;
        yield ev;
      }
      writeFileState(ctx.state, outfile, { size: meta.size, mtimeMs: meta.mtimeMs, offset: end });
    } catch (err) {
      ctx.log.warn(`gemini-cli: failed reading ${outfile}: ${(err as Error).message}`);
    }
  },
};
