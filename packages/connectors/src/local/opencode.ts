import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { ProviderId, RawUsageEvent } from '@claii/core';
import type { ConnectorContext, Detection, LocalConnector, ScanOptions } from '../types.js';
import { fileMeta, num, readFileState, safeJson, str, walk, writeFileState } from '../util/files.js';

/**
 * OpenCode local session storage: `~/.local/share/opencode/storage/` (respects `XDG_DATA_HOME`),
 * per research/other-sources.md §8 "OpenCode".
 *
 * Each assistant reply is its own file at `message/<sessionID>/msg_<messageID>.json`, carrying
 * `modelID`, `providerID`, `tokens` (`{input, output, reasoning, cache: {read, write}}`), the
 * tool's own computed `cost`, and `time` (`{created, completed}`, epoch ms). The owning session
 * lives at `session/<projectHash>/<sessionID>.json` (nested under a per-project-hash directory,
 * *not* directly under `session/`) and carries `path`/`cwd`/`title`; we use its directory basename
 * as the project label. Because the project-hash segment isn't derivable from the session id
 * alone, `projectDirFor` resolves it by indexing every `session/**\/*.json` file once per scan
 * (see `scan()`) rather than joining a guessed path. Files are effectively immutable once the
 * assistant turn completes, so incremental scanning tracks each message file's size/mtime
 * individually (see `readFileState`) rather than a byte offset — unlike the append-only JSONL logs
 * the other local connectors read.
 *
 * KNOWN BUG (research, confirmed via github.com/anomalyco/opencode issue #28494): OpenCode's own
 * stored `cost` field ignores cache-read tokens, under-reporting true cost by 2-3x for
 * heavy-caching sessions. We still pass it through as `cost.computedUsd` — but `finalizeEvent`
 * (packages/core/src/events.ts) only ever falls back to a source-supplied `computedUsd` when clai's
 * own pricing catalog has no entry for the model at all, and marks that fallback `confidence:
 * 'estimated'` rather than `'computed'`, so this known-buggy number is never treated as ground
 * truth: whenever the model is priced, cost is recomputed from `tokens.*` instead.
 *
 * OpenCode v1.2+ also ships a single-SQLite-file storage backend (`~/.local/share/opencode/opencode.db`)
 * instead of these per-message JSON files. No table/column schema for it was found in this research
 * pass, so it isn't parsed here; `detect()` still surfaces its presence so a v1.2+ user sees *why*
 * clai found zero JSON messages rather than a silent empty result.
 */

interface OpencodeTokens {
  input?: number;
  output?: number;
  reasoning?: number;
  cache?: { read?: number; write?: number };
}

interface OpencodeMessage {
  id?: string;
  role?: string;
  sessionID?: string;
  modelID?: string;
  providerID?: string;
  tokens?: OpencodeTokens;
  cost?: number;
  time?: { created?: number; completed?: number };
}

interface OpencodeSession {
  id?: string;
  path?: string;
  cwd?: string;
}

const PROVIDER_MAP: Record<string, ProviderId> = {
  anthropic: 'anthropic',
  openai: 'openai',
  google: 'google',
  xai: 'xai',
  mistral: 'mistral',
  deepseek: 'deepseek',
};

/** Anything not in the direct map (openrouter, bedrock, vertex, groq, azure, ...) resolves to `other` so core infers the provider from the model id. */
export function mapOpencodeProvider(providerID: string | undefined): ProviderId {
  if (!providerID) return 'other';
  return PROVIDER_MAP[providerID.toLowerCase()] ?? 'other';
}

export function opencodeDataHome(env: NodeJS.ProcessEnv, home: string): string {
  return env['XDG_DATA_HOME']?.trim() || join(home, '.local', 'share');
}

export function opencodeStorageRoot(env: NodeJS.ProcessEnv, home: string): string {
  return join(opencodeDataHome(env, home), 'opencode', 'storage');
}

function epochToIso(ms: number | undefined): string | undefined {
  return typeof ms === 'number' && Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : undefined;
}

export function toOpencodeEvent(msg: OpencodeMessage, opts: { file: string; sessionID: string; messageID: string; projectDir?: string; identity?: ConnectorContext['identity'] }): RawUsageEvent | null {
  const ts = epochToIso(msg.time?.completed) ?? epochToIso(msg.time?.created);
  if (!ts) return null;
  const tokens = msg.tokens ?? {};
  const cost = typeof msg.cost === 'number' && Number.isFinite(msg.cost) ? msg.cost : undefined;
  return {
    ts,
    source: 'opencode',
    provider: mapOpencodeProvider(msg.providerID),
    model: str(msg.modelID) ?? 'unknown',
    surface: 'cli-agent',
    billing: 'api',
    granularity: 'request',
    actor: { email: opts.identity?.email, name: opts.identity?.name },
    context: {
      sessionId: opts.sessionID,
      cwd: opts.projectDir,
      project: opts.projectDir ? basename(opts.projectDir) : undefined,
      device: opts.identity?.device,
    },
    usage: {
      input: num(tokens.input),
      output: num(tokens.output),
      reasoning: num(tokens.reasoning),
      cacheRead: num(tokens.cache?.read),
      cacheWrite5m: num(tokens.cache?.write),
      cacheWrite1h: 0,
      requests: 1,
    },
    cost: cost === undefined ? undefined : { computedUsd: cost },
    naturalKey: [opts.sessionID, opts.messageID],
  };
}

export const opencodeConnector: LocalConnector = {
  kind: 'local',
  id: 'opencode',
  displayName: 'OpenCode',

  async detect(ctx: ConnectorContext): Promise<Detection> {
    const root = opencodeStorageRoot(ctx.env, ctx.home);
    const files = walk(join(root, 'message'), (n) => n.endsWith('.json'));
    if (files.length === 0) {
      // v1.2+ moved to a single SQLite file; report its presence so a v1.2+ user sees why the
      // legacy JSON scan found nothing instead of a silent zero (research/other-sources.md §8).
      const dbPath = join(dirname(root), 'opencode.db');
      if (existsSync(dbPath)) {
        return {
          found: true,
          summary: `OpenCode v1.2+ SQLite storage detected at ${dbPath} (not yet parsed by clai — no documented schema found; no legacy JSON messages in ${root})`,
          paths: [root, dbPath],
          details: { files: 0, sqlite: true },
        };
      }
    }
    return {
      found: files.length > 0,
      summary: `${files.length} message${files.length === 1 ? '' : 's'} in ${root}`,
      paths: [root],
      details: { files: files.length },
    };
  },

  async *scan(ctx: ConnectorContext, opts: ScanOptions = {}): AsyncGenerator<RawUsageEvent> {
    const root = opencodeStorageRoot(ctx.env, ctx.home);
    const files = walk(join(root, 'message'), (n) => n.endsWith('.json'));
    // Index every session file once, regardless of which `<projectHash>/` subdirectory it lives
    // under (session/{projectHash}/{sessionID}.json — see the module doc comment), keyed by the
    // session id (its filename minus `.json`) so lookups below are O(1).
    const sessionPathById = new Map<string, string>();
    for (const f of walk(join(root, 'session'), (n) => n.endsWith('.json'))) sessionPathById.set(basename(f, '.json'), f);
    const sessionDirCache = new Map<string, string | undefined>();
    const projectDirFor = (sessionID: string): string | undefined => {
      if (sessionDirCache.has(sessionID)) return sessionDirCache.get(sessionID);
      const sessionFile = sessionPathById.get(sessionID);
      let dir: string | undefined;
      if (sessionFile) {
        try {
          const s = safeJson<OpencodeSession>(readFileSync(sessionFile, 'utf8'));
          dir = str(s?.path) ?? str(s?.cwd);
        } catch {
          dir = undefined;
        }
      }
      sessionDirCache.set(sessionID, dir);
      return dir;
    };

    for (const file of files) {
      const meta = fileMeta(file);
      if (!meta) continue;
      const prev = opts.full ? undefined : readFileState(ctx.state, file);
      if (prev && prev.size === meta.size && prev.mtimeMs === meta.mtimeMs) continue; // unchanged, already processed
      if (opts.since && meta.mtimeMs < Date.parse(opts.since) && !prev) {
        writeFileState(ctx.state, file, { size: meta.size, mtimeMs: meta.mtimeMs, offset: meta.size });
        continue;
      }
      try {
        const msg = safeJson<OpencodeMessage>(readFileSync(file, 'utf8'));
        if (msg && msg.role === 'assistant' && msg.tokens) {
          const sessionID = str(msg.sessionID) ?? basename(dirname(file));
          const messageID = str(msg.id) ?? basename(file, '.json');
          const ev = toOpencodeEvent(msg, { file, sessionID, messageID, projectDir: projectDirFor(sessionID), identity: ctx.identity });
          if (ev && !(opts.since && ev.ts < opts.since)) yield ev;
        }
        writeFileState(ctx.state, file, { size: meta.size, mtimeMs: meta.mtimeMs, offset: meta.size });
      } catch (err) {
        ctx.log.warn(`opencode: failed reading ${file}: ${(err as Error).message}`);
      }
    }
  },
};
