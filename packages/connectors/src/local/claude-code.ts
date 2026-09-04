import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { RawUsageEvent } from '@claii/core';
import type { ConnectorContext, Detection, LocalConnector, ScanOptions } from '../types.js';
import { fileMeta, num, readFileState, readLinesFrom, safeJson, str, walk, writeFileState } from '../util/files.js';

/**
 * Claude Code local transcripts.
 *
 * Reads `<config-dir>/projects/<encoded-cwd>/<session>.jsonl` (and `agent-*.jsonl` sub-agent files).
 * Only usage metadata is read; prompt/response content is never touched or stored.
 *
 * Dedup: Claude Code writes one JSONL line per content block of an assistant message, each carrying
 * the same `message.id`, `requestId` and `usage`, so the natural key is (message.id, requestId).
 */

interface AssistantLine {
  type?: string;
  uuid?: string;
  sessionId?: string;
  timestamp?: string;
  cwd?: string;
  gitBranch?: string;
  version?: string;
  isSidechain?: boolean;
  isApiErrorMessage?: boolean;
  requestId?: string;
  effort?: string | number;
  agentId?: string;
  message?: {
    id?: string;
    model?: string;
    role?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number };
      server_tool_use?: { web_search_requests?: number; web_fetch_requests?: number };
      service_tier?: string;
      speed?: string;
    };
  };
}

export function claudeConfigDirs(env: NodeJS.ProcessEnv, home: string): string[] {
  const dirs: string[] = [];
  const configured = env['CLAUDE_CONFIG_DIR'];
  if (configured) for (const d of configured.split(',')) if (d.trim()) dirs.push(d.trim());
  dirs.push(join(home, '.claude'));
  dirs.push(join(home, '.config', 'claude'));
  return [...new Set(dirs)].filter((d) => existsSync(join(d, 'projects')));
}

/** Turn `-Users-me-Projects-foo` back into a readable project label (best effort). */
export function projectLabelFromDir(dirName: string, cwd?: string): string {
  if (cwd) return basename(cwd) || cwd;
  const parts = dirName.split('-').filter(Boolean);
  return parts[parts.length - 1] ?? dirName;
}

export function parseAssistantLine(line: string): AssistantLine | null {
  // Cheap pre-filter before JSON.parse: only assistant lines with usage matter.
  if (!line.includes('"assistant"') || !line.includes('"usage"')) return null;
  const o = safeJson<AssistantLine>(line);
  if (!o || o.type !== 'assistant' || !o.message?.usage) return null;
  return o;
}

export function toEvent(o: AssistantLine, opts: { file: string; projectDir: string; plan?: string; identity?: ConnectorContext['identity'] }): RawUsageEvent | null {
  const u = o.message!.usage!;
  const model = str(o.message!.model) ?? 'unknown';
  const ts = str(o.timestamp);
  if (!ts) return null;
  const cc5 = u.cache_creation?.ephemeral_5m_input_tokens;
  const cc1h = u.cache_creation?.ephemeral_1h_input_tokens;
  const hasBreakdown = typeof cc5 === 'number' || typeof cc1h === 'number';
  const cacheWrite5m = hasBreakdown ? num(cc5) : num(u.cache_creation_input_tokens);
  const cacheWrite1h = hasBreakdown ? num(cc1h) : 0;
  const messageId = str(o.message!.id);
  const requestId = str(o.requestId);
  const naturalKey = messageId ? [messageId, requestId ?? ''] : [str(o.sessionId) ?? '', str(o.uuid) ?? ts];
  const agentId = str(o.agentId) ?? (basename(opts.file).startsWith('agent-') ? basename(opts.file).replace(/^agent-/, '').replace(/\.jsonl$/, '') : undefined);
  const cwd = str(o.cwd);
  const context: RawUsageEvent['context'] = {
    sessionId: str(o.sessionId),
    cwd,
    project: projectLabelFromDir(basename(opts.projectDir), cwd),
    gitBranch: str(o.gitBranch),
    appVersion: str(o.version),
    serviceTier: str(u.service_tier),
    speed: str(u.speed),
    effort: o.effort === undefined ? undefined : String(o.effort),
    agentId,
    device: opts.identity?.device,
  };
  return {
    ts,
    source: 'claude-code',
    provider: 'anthropic',
    model,
    surface: 'cli-agent',
    billing: opts.plan ? 'subscription' : 'unknown',
    plan: opts.plan,
    granularity: 'request',
    actor: { email: opts.identity?.email, name: opts.identity?.name },
    context,
    usage: {
      input: num(u.input_tokens),
      output: num(u.output_tokens),
      cacheRead: num(u.cache_read_input_tokens),
      cacheWrite5m,
      cacheWrite1h,
      requests: 1,
      webSearches: num(u.server_tool_use?.web_search_requests),
      webFetches: num(u.server_tool_use?.web_fetch_requests),
    },
    naturalKey,
    meta: o.isSidechain ? { sidechain: true } : undefined,
  };
}

/** Field-wise maximum of two usage records (streamed duplicates only ever grow). */
export function mergeUsageMax(a: RawUsageEvent['usage'], b: RawUsageEvent['usage']): RawUsageEvent['usage'] {
  return {
    input: Math.max(a.input, b.input),
    output: Math.max(a.output, b.output),
    cacheRead: Math.max(a.cacheRead, b.cacheRead),
    cacheWrite5m: Math.max(a.cacheWrite5m, b.cacheWrite5m),
    cacheWrite1h: Math.max(a.cacheWrite1h, b.cacheWrite1h),
    requests: 1,
    webSearches: Math.max(a.webSearches ?? 0, b.webSearches ?? 0),
    webFetches: Math.max(a.webFetches ?? 0, b.webFetches ?? 0),
  };
}

export const claudeCodeConnector: LocalConnector = {
  kind: 'local',
  id: 'claude-code',
  displayName: 'Claude Code',

  async detect(ctx: ConnectorContext): Promise<Detection> {
    const dirs = claudeConfigDirs(ctx.env, ctx.home);
    if (dirs.length === 0) return { found: false, summary: 'No Claude Code transcripts found (~/.claude/projects)', paths: [] };
    const files = dirs.flatMap((d) => walk(join(d, 'projects'), (n) => n.endsWith('.jsonl')));
    return {
      found: files.length > 0,
      summary: `${files.length} transcript file${files.length === 1 ? '' : 's'} in ${dirs.map((d) => join(d, 'projects')).join(', ')}`,
      paths: dirs,
      details: { files: files.length },
    };
  },

  async *scan(ctx: ConnectorContext, opts: ScanOptions = {}): AsyncGenerator<RawUsageEvent> {
    const plan = ctx.planFor('anthropic');
    const dirs = claudeConfigDirs(ctx.env, ctx.home);
    const seen = new Set<string>();
    for (const dir of dirs) {
      const projectsDir = join(dir, 'projects');
      const files = walk(projectsDir, (n) => n.endsWith('.jsonl'));
      for (const file of files) {
        const meta = fileMeta(file);
        if (!meta) continue;
        const prev = opts.full ? undefined : readFileState(ctx.state, file);
        let offset = 0;
        if (prev && prev.size <= meta.size && prev.offset <= meta.size) offset = prev.offset;
        if (offset >= meta.size && prev && prev.mtimeMs === meta.mtimeMs) continue; // unchanged
        if (opts.since && meta.mtimeMs < Date.parse(opts.since) && !prev) {
          // File last modified before the window; nothing inside can be newer.
          writeFileState(ctx.state, file, { size: meta.size, mtimeMs: meta.mtimeMs, offset: meta.size });
          continue;
        }
        const projectDir = join(projectsDir, file.slice(projectsDir.length + 1).split('/')[0] ?? '');
        let end = offset;
        // Lines of one message arrive consecutively (one per content block). Their usage is identical except
        // that output_tokens can grow on later lines, so duplicates are merged by taking the maximum per field.
        let pending: RawUsageEvent | null = null;
        let pendingKey = '';
        try {
          for await (const { line, end: lineEnd } of readLinesFrom(file, offset)) {
            end = lineEnd;
            const o = parseAssistantLine(line);
            if (!o) continue;
            if (o.isApiErrorMessage) continue;
            const ev = toEvent(o, { file, projectDir, plan, identity: ctx.identity });
            if (!ev) continue;
            if (opts.since && ev.ts < opts.since) continue;
            const key = ev.naturalKey!.join('');
            if (pending && key === pendingKey) {
              pending.usage = mergeUsageMax(pending.usage, ev.usage);
              continue;
            }
            if (pending) {
              if (!seen.has(pendingKey)) {
                seen.add(pendingKey);
                yield pending;
              }
            }
            pending = ev;
            pendingKey = key;
          }
          if (pending && !seen.has(pendingKey)) {
            seen.add(pendingKey);
            yield pending;
          }
          writeFileState(ctx.state, file, { size: meta.size, mtimeMs: meta.mtimeMs, offset: end });
        } catch (err) {
          ctx.log.warn(`claude-code: failed reading ${file}: ${(err as Error).message}`);
        }
      }
    }
  },
};

/** Claude Code's own aggregate stats (used by `clai doctor` to cross-check our cost math). */
export function readClaudeStatsCache(env: NodeJS.ProcessEnv, home: string): { modelUsage: Record<string, { inputTokens: number; outputTokens: number; cacheReadInputTokens: number; cacheCreationInputTokens: number; costUSD: number }>; lastComputedDate?: string } | null {
  for (const dir of [env['CLAUDE_CONFIG_DIR']?.split(',')[0], join(home, '.claude')]) {
    if (!dir) continue;
    const p = join(dir, 'stats-cache.json');
    if (!existsSync(p)) continue;
    try {
      const o = JSON.parse(readFileSync(p, 'utf8')) as { modelUsage?: Record<string, Record<string, number>>; lastComputedDate?: string };
      if (!o.modelUsage) return null;
      const modelUsage: Record<string, { inputTokens: number; outputTokens: number; cacheReadInputTokens: number; cacheCreationInputTokens: number; costUSD: number }> = {};
      for (const [k, v] of Object.entries(o.modelUsage)) {
        modelUsage[k] = {
          inputTokens: num(v['inputTokens']),
          outputTokens: num(v['outputTokens']),
          cacheReadInputTokens: num(v['cacheReadInputTokens']),
          cacheCreationInputTokens: num(v['cacheCreationInputTokens']),
          costUSD: num(v['costUSD']),
        };
      }
      return { modelUsage, lastComputedDate: o.lastComputedDate };
    } catch {
      return null;
    }
  }
  return null;
}
