import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { RawUsageEvent } from '@claii/core';
import type { ConnectorContext, Detection, LocalConnector, ScanOptions } from '../types.js';
import { fileMeta, readFileState, writeFileState } from '../util/files.js';

/**
 * Aider local chat history (research/other-sources.md §8 "Aider"): `.aider.chat.history.md`, a
 * markdown transcript Aider appends to in the directory it was run from — confirmed as the most
 * stable/long-standing Aider artifact, though the least structured (text/regex parsing required,
 * not JSON; grows unbounded). One file can contain multiple sessions (each new `aider` invocation
 * appends a fresh `# aider chat started at ...` banner + transcript).
 *
 * Roots: `AIDER_HISTORY_ROOTS` (comma-separated directories) or, by default, just the home
 * directory. For each root we check the root itself and each of its immediate subdirectories
 * (i.e. "one level deep") for a `.aider.chat.history.md` file — this matches the common layout of
 * project directories living directly under a root (`~/<project>/.aider.chat.history.md` for the
 * default home-based root, or `<AIDER_HISTORY_ROOTS entry>/<project>/.aider.chat.history.md`).
 * Deeper project trees need an explicit `AIDER_HISTORY_ROOTS` entry closer to the projects.
 *
 * Each turn logs a summary line, e.g. `> Tokens: 12k sent, 1.2k received. Cost: $0.05 message,
 * $1.23 session.` (plain numbers or `k`-suffixed thousands; the `Cost: ...` clause itself is
 * optional -- see `TOKENS_RE`). The active model is read from `> Model: xxx with yyy edit format`
 * or `Main model: xxx ...` banner lines and carried forward until the next session header or model
 * line; a file whose Tokens: lines are re-parsed is always re-read from the start (like
 * codex-cli.ts's rollout parser) so a live/in-progress session's carried model state is never split
 * across incremental reads — naturalKey-based idempotent upserts make the repeated full read cheap
 * to dedupe.
 *
 * Deliberately NOT read, per the research: `~/.aider/analytics.json` (holds only a random UUID4
 * anonymous-analytics identity, not a usage ledger) and `.aider.model.metadata.json` (a
 * user-supplied pricing fallback table, not a usage record). `.aider.analytics.json`'s
 * `message_send` event is reported to carry "detailed token usage and calculated costs" but its
 * exact per-event field names are UNVERIFIED (third-party summary only, not Aider's own docs), so
 * we don't speculatively parse it -- the `.md` transcript above is the confirmed, stable source.
 */

export function aiderHistoryRoots(env: NodeJS.ProcessEnv, home: string): string[] {
  const configured = env['AIDER_HISTORY_ROOTS']?.trim();
  if (configured) return configured.split(',').map((s) => s.trim()).filter(Boolean);
  return [home];
}

/** `.aider.chat.history.md` files directly in each root, plus one level of subdirectories. */
export function findAiderHistoryFiles(roots: string[]): string[] {
  const out: string[] = [];
  for (const root of roots) {
    const direct = join(root, '.aider.chat.history.md');
    if (existsSync(direct)) out.push(direct);
    let entries: import('node:fs').Dirent[];
    try {
      entries = readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const p = join(root, e.name, '.aider.chat.history.md');
      if (existsSync(p)) out.push(p);
    }
  }
  return [...new Set(out)];
}

function parseLocalTimestamp(s: string): string | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/.exec(s.trim());
  if (!m) return undefined;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function toAmount(numStr: string | undefined, k: string | undefined): number {
  const n = Number(numStr);
  if (!Number.isFinite(n)) return 0;
  return Math.round(k ? n * 1000 : n);
}

const HEADER_RE = /^#\s*aider chat started at\s+(.+?)\s*$/i;
// "> Model: xxx with yyy edit format" (older) or "Main model: xxx with yyy edit format, ..." (newer banner).
const MODEL_RE = /^>?\s*(?:Main model|Model):\s*(.+)$/i;
// The whole "Cost: $X message[, $Y session]" clause is optional: research/other-sources.md §8
// ("Aider") quotes the line as `> Tokens: 38k sent, 1.1k received.` with no cost figure at all, so
// a Tokens: line must still be captured (sent/received parsed, messageCostUsd left null) when cost
// is absent -- e.g. when Aider doesn't know the active model's price.
const TOKENS_RE = /^>\s*Tokens:\s*([\d.]+)(k)?\s*sent,\s*([\d.]+)(k)?\s*received\.(?:\s*Cost:\s*\$([\d.]+)\s*message(?:,\s*\$([\d.]+)\s*session)?)?/i;

export interface AiderTurn {
  ts?: string;
  model: string;
  sent: number;
  received: number;
  messageCostUsd: number | null;
  lineIndex: number;
  sessionIndex: number;
}

interface AiderState {
  ts?: string;
  model: string;
  sessionIndex: number;
  lineIndex: number;
}

function newAiderState(): AiderState {
  return { model: 'unknown', sessionIndex: 0, lineIndex: -1 };
}

function stepAiderLine(line: string, st: AiderState): AiderTurn | null {
  st.lineIndex += 1;
  const header = HEADER_RE.exec(line);
  if (header) {
    st.ts = parseLocalTimestamp(header[1] ?? '');
    st.model = 'unknown';
    st.sessionIndex += 1;
    return null;
  }
  const modelLine = MODEL_RE.exec(line);
  if (modelLine) {
    const raw = (modelLine[1] ?? '').split(/\s+with\s+/i)[0]?.split(',')[0]?.trim();
    if (raw) st.model = raw;
    return null;
  }
  const tok = TOKENS_RE.exec(line);
  if (!tok) return null;
  return {
    ts: st.ts,
    model: st.model,
    sent: toAmount(tok[1], tok[2]),
    received: toAmount(tok[3], tok[4]),
    messageCostUsd: tok[5] !== undefined ? Number(tok[5]) : null,
    lineIndex: st.lineIndex,
    sessionIndex: st.sessionIndex,
  };
}

/** Pure parse of a full `.aider.chat.history.md` text into turns; `fallbackTs` covers a Tokens: line seen before any session header. */
export function parseAiderHistory(text: string, fallbackTs?: string): AiderTurn[] {
  const st = newAiderState();
  const turns: AiderTurn[] = [];
  for (const line of text.split(/\r?\n/)) {
    const turn = stepAiderLine(line, st);
    if (turn) turns.push({ ...turn, ts: turn.ts ?? fallbackTs });
  }
  return turns;
}

export function turnToEvent(t: AiderTurn, opts: { file: string; project?: string; cwd?: string; identity?: ConnectorContext['identity'] }): RawUsageEvent | null {
  if (!t.ts) return null;
  return {
    ts: t.ts,
    source: 'aider',
    provider: 'other',
    model: t.model,
    surface: 'cli-agent',
    billing: 'api',
    granularity: 'message',
    actor: { email: opts.identity?.email, name: opts.identity?.name },
    context: {
      cwd: opts.cwd,
      project: opts.project,
      sessionId: opts.project ? `${opts.project}#${t.sessionIndex}` : undefined,
      device: opts.identity?.device,
    },
    usage: { input: t.sent, output: t.received, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, requests: 1 },
    cost: t.messageCostUsd === null ? undefined : { computedUsd: t.messageCostUsd },
    naturalKey: [opts.file, String(t.lineIndex), t.ts],
  };
}

export const aiderConnector: LocalConnector = {
  kind: 'local',
  id: 'aider',
  displayName: 'Aider',

  async detect(ctx: ConnectorContext): Promise<Detection> {
    const roots = aiderHistoryRoots(ctx.env, ctx.home);
    const files = findAiderHistoryFiles(roots);
    return {
      found: files.length > 0,
      summary:
        files.length > 0
          ? `${files.length} .aider.chat.history.md file${files.length === 1 ? '' : 's'} found in ${roots.join(', ')}`
          : `No .aider.chat.history.md files found in ${roots.join(', ')} (set AIDER_HISTORY_ROOTS to search other locations)`,
      paths: roots,
      details: { files: files.length },
    };
  },

  async *scan(ctx: ConnectorContext, opts: ScanOptions = {}): AsyncGenerator<RawUsageEvent> {
    const roots = aiderHistoryRoots(ctx.env, ctx.home);
    const files = findAiderHistoryFiles(roots);
    for (const file of files) {
      const meta = fileMeta(file);
      if (!meta) continue;
      const prev = opts.full ? undefined : readFileState(ctx.state, file);
      if (prev && prev.size === meta.size && prev.mtimeMs === meta.mtimeMs) continue; // unchanged
      if (opts.since && meta.mtimeMs < Date.parse(opts.since) && !prev) {
        writeFileState(ctx.state, file, { size: meta.size, mtimeMs: meta.mtimeMs, offset: meta.size });
        continue;
      }
      try {
        const text = readFileSync(file, 'utf8');
        const projectDir = dirname(file);
        const project = basename(projectDir);
        const turns = parseAiderHistory(text, new Date(meta.mtimeMs).toISOString());
        for (const t of turns) {
          const ev = turnToEvent(t, { file, project, cwd: projectDir, identity: ctx.identity });
          if (!ev) continue;
          if (opts.since && ev.ts < opts.since) continue;
          yield ev;
        }
        writeFileState(ctx.state, file, { size: meta.size, mtimeMs: meta.mtimeMs, offset: meta.size });
      } catch (err) {
        ctx.log.warn(`aider: failed reading ${file}: ${(err as Error).message}`);
      }
    }
  },
};
