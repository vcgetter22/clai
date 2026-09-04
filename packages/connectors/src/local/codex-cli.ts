import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { zstdDecompressSync } from 'node:zlib';
import type { RawUsageEvent } from '@claii/core';
import type { ConnectorContext, Detection, LocalConnector, ScanOptions } from '../types.js';
import { fileMeta, num, readFileState, readLinesFrom, safeJson, str, walk, writeFileState } from '../util/files.js';

/**
 * OpenAI Codex CLI local session logs: `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-*.jsonl` and
 * `$CODEX_HOME/archived_sessions/*.jsonl` (older files may be zstd-compressed as `*.jsonl.zst`).
 *
 * Each rollout line is `{timestamp, type, payload}`. Usage arrives in `event_msg` records with
 * `payload.type === "token_count"` carrying cumulative `info.total_token_usage` and per-call
 * `info.last_token_usage`. We derive per-call usage from deltas of the cumulative counter, which is
 * robust to repeated token_count events (they also fire on rate-limit refreshes) and detects
 * counter resets after compaction.
 *
 * Token convention: OpenAI `input_tokens` INCLUDES `cached_input_tokens` and `cache_write_input_tokens`;
 * we split them out. `output_tokens` includes reasoning tokens.
 *
 * The same file format is also produced by other agents (`~/.pi/agent/sessions`, `~/.omp/agent/sessions`).
 */

interface Rollout {
  timestamp?: string;
  type?: string;
  payload?: Record<string, unknown>;
}

interface TokenUsageBlock {
  input_tokens?: number;
  cached_input_tokens?: number;
  cache_write_input_tokens?: number;
  output_tokens?: number;
  reasoning_output_tokens?: number;
  total_tokens?: number;
}

export function codexHome(env: NodeJS.ProcessEnv, home: string): string {
  return env['CODEX_HOME']?.trim() || join(home, '.codex');
}

/** Session roots that share the Codex rollout format. */
export function codexSessionRoots(env: NodeJS.ProcessEnv, home: string): string[] {
  const c = codexHome(env, home);
  return [join(c, 'sessions'), join(c, 'archived_sessions'), join(home, '.pi', 'agent', 'sessions'), join(home, '.omp', 'agent', 'sessions')].filter((p) => existsSync(p));
}

/** Whether Codex is authenticated with an API key (API billing) or ChatGPT login (subscription). Reads only key *names*. */
export function codexBillingMode(codexDir: string): 'api' | 'subscription' | 'unknown' {
  const p = join(codexDir, 'auth.json');
  if (!existsSync(p)) return 'unknown';
  try {
    const o = JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>;
    const mode = str(o['auth_mode'])?.toLowerCase();
    if (mode === 'apikey' || mode === 'api_key') return 'api';
    if (mode === 'chatgpt' || mode === 'chatgpt_auth_tokens') return 'subscription';
    if (typeof o['OPENAI_API_KEY'] === 'string' && (o['OPENAI_API_KEY'] as string).length > 0) return 'api';
    if (o['tokens'] && typeof o['tokens'] === 'object') return 'subscription';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

const PLAN_MAP: Record<string, string> = { free: 'free', go: 'go', plus: 'plus', pro: 'pro', team: 'business', business: 'business', enterprise: 'enterprise', edu: 'enterprise' };

function delta(cur: TokenUsageBlock, prev: TokenUsageBlock | null): TokenUsageBlock {
  if (!prev) return cur;
  const d = {
    input_tokens: num(cur.input_tokens) - num(prev.input_tokens),
    cached_input_tokens: num(cur.cached_input_tokens) - num(prev.cached_input_tokens),
    cache_write_input_tokens: num(cur.cache_write_input_tokens) - num(prev.cache_write_input_tokens),
    output_tokens: num(cur.output_tokens) - num(prev.output_tokens),
    reasoning_output_tokens: num(cur.reasoning_output_tokens) - num(prev.reasoning_output_tokens),
    total_tokens: num(cur.total_tokens) - num(prev.total_tokens),
  };
  // Counter reset (new context window after compaction, or a resumed session): treat as fresh.
  if (d.input_tokens < 0 || d.output_tokens < 0) return cur;
  return d;
}

export interface CodexParseState {
  sessionId?: string;
  cwd?: string;
  model?: string;
  cliVersion?: string;
  gitBranch?: string;
  gitRepo?: string;
  planType?: string;
  lastTotal: TokenUsageBlock | null;
  index: number;
}

export function newCodexState(): CodexParseState {
  return { lastTotal: null, index: 0 };
}

/** Parse one rollout line, mutating `st`; returns an event when a token_count with a positive delta is seen. */
export function parseCodexLine(line: string, st: CodexParseState, opts: { file: string; billing: RawUsageEvent['billing']; plan?: string; identity?: ConnectorContext['identity'] }): RawUsageEvent | null {
  const o = safeJson<Rollout>(line);
  if (!o || !o.type) return null;
  const p = o.payload ?? {};
  if (o.type === 'session_meta') {
    st.sessionId = str(p['session_id']) ?? str(p['id']) ?? st.sessionId;
    st.cwd = str(p['cwd']) ?? st.cwd;
    st.cliVersion = str(p['cli_version']) ?? st.cliVersion;
    const git = p['git'] as Record<string, unknown> | undefined;
    if (git) {
      st.gitBranch = str(git['branch']) ?? st.gitBranch;
      st.gitRepo = str(git['repository_url']) ?? st.gitRepo;
    }
    const model = str(p['model']);
    if (model) st.model = model;
    return null;
  }
  if (o.type === 'turn_context') {
    st.model = str(p['model']) ?? st.model;
    st.cwd = str(p['cwd']) ?? st.cwd;
    return null;
  }
  let info: Record<string, unknown> | null | undefined;
  if (o.type === 'event_msg' && p['type'] === 'token_count') {
    info = p['info'] as Record<string, unknown> | null | undefined;
    const rl = p['rate_limits'] as Record<string, unknown> | null | undefined;
    const planType = rl ? str(rl['plan_type']) : undefined;
    if (planType) st.planType = PLAN_MAP[planType.toLowerCase()] ?? planType.toLowerCase();
  } else if (o.type === 'token_usage_record') {
    info = (p['info'] as Record<string, unknown> | undefined) ?? p;
  } else return null;
  if (!info) return null;
  const total = info['total_token_usage'] as TokenUsageBlock | undefined;
  const last = info['last_token_usage'] as TokenUsageBlock | undefined;
  let d: TokenUsageBlock;
  if (total) {
    d = delta(total, st.lastTotal);
    st.lastTotal = total;
  } else if (last) {
    d = last;
  } else return null;
  const inputIncl = num(d.input_tokens);
  const cached = Math.max(0, num(d.cached_input_tokens));
  const cacheWrite = Math.max(0, num(d.cache_write_input_tokens));
  const output = num(d.output_tokens);
  if (inputIncl <= 0 && output <= 0) return null;
  st.index += 1;
  const ts = str(o.timestamp) ?? new Date(0).toISOString();
  const sessionId = st.sessionId ?? basename(opts.file).replace(/\.jsonl(\.zst)?$/, '');
  const billing = opts.billing === 'unknown' && st.planType ? 'subscription' : opts.billing;
  return {
    ts,
    source: 'codex-cli',
    provider: 'openai',
    model: st.model ?? 'gpt-5-codex',
    surface: 'cli-agent',
    billing,
    plan: billing === 'subscription' ? (st.planType ?? opts.plan) : undefined,
    granularity: 'request',
    actor: { email: opts.identity?.email, name: opts.identity?.name },
    context: {
      sessionId,
      cwd: st.cwd,
      project: st.cwd ? basename(st.cwd) : undefined,
      gitBranch: st.gitBranch,
      gitRepo: st.gitRepo,
      appVersion: st.cliVersion,
      device: opts.identity?.device,
    },
    usage: {
      input: Math.max(0, inputIncl - cached - cacheWrite),
      output: Math.max(0, output),
      cacheRead: cached,
      cacheWrite5m: cacheWrite,
      cacheWrite1h: 0,
      reasoning: Math.max(0, num(d.reasoning_output_tokens)),
      requests: 1,
    },
    naturalKey: [sessionId, String(st.index), ts],
  };
}

/** Read a rollout file (plain or zstd-compressed) as lines. */
async function* rolloutLines(file: string): AsyncGenerator<{ line: string; end: number }> {
  if (file.endsWith('.zst')) {
    const buf = zstdDecompressSync(readFileSync(file));
    const text = buf.toString('utf8');
    let end = 0;
    for (const line of text.split('\n')) {
      end += Buffer.byteLength(line, 'utf8') + 1;
      if (line.trim()) yield { line, end };
    }
    return;
  }
  yield* readLinesFrom(file, 0);
}

export const codexCliConnector: LocalConnector = {
  kind: 'local',
  id: 'codex-cli',
  displayName: 'Codex CLI',

  async detect(ctx: ConnectorContext): Promise<Detection> {
    const roots = codexSessionRoots(ctx.env, ctx.home);
    if (roots.length === 0) return { found: false, summary: 'No Codex CLI sessions found (~/.codex/sessions)', paths: [] };
    const files = roots.flatMap((r) => walk(r, (n) => n.endsWith('.jsonl') || n.endsWith('.jsonl.zst')));
    return {
      found: files.length > 0,
      summary: `${files.length} Codex session log${files.length === 1 ? '' : 's'} in ${roots.join(', ')} (${codexBillingMode(codexHome(ctx.env, ctx.home))} billing)`,
      paths: roots,
      details: { files: files.length },
    };
  },

  async *scan(ctx: ConnectorContext, opts: ScanOptions = {}): AsyncGenerator<RawUsageEvent> {
    const roots = codexSessionRoots(ctx.env, ctx.home);
    if (roots.length === 0) return;
    const billing = codexBillingMode(codexHome(ctx.env, ctx.home));
    const plan = ctx.planFor('openai');
    for (const root of roots) {
      for (const file of walk(root, (n) => n.endsWith('.jsonl') || n.endsWith('.jsonl.zst'))) {
        const meta = fileMeta(file);
        if (!meta) continue;
        const prev = opts.full ? undefined : readFileState(ctx.state, file);
        if (prev && prev.offset >= meta.size && prev.mtimeMs === meta.mtimeMs) continue;
        if (opts.since && meta.mtimeMs < Date.parse(opts.since) && !prev) {
          writeFileState(ctx.state, file, { size: meta.size, mtimeMs: meta.mtimeMs, offset: meta.size });
          continue;
        }
        // Delta parsing needs the whole file: always read from 0; stable ids make re-reads idempotent.
        const st = newCodexState();
        let end = 0;
        try {
          for await (const { line, end: lineEnd } of rolloutLines(file)) {
            end = lineEnd;
            const ev = parseCodexLine(line, st, { file, billing, plan, identity: ctx.identity });
            if (!ev) continue;
            if (opts.since && ev.ts < opts.since) continue;
            yield ev;
          }
          writeFileState(ctx.state, file, { size: meta.size, mtimeMs: meta.mtimeMs, offset: Math.max(end, meta.size) });
        } catch (err) {
          ctx.log.warn(`codex-cli: failed reading ${file}: ${(err as Error).message}`);
        }
      }
    }
  },
};
