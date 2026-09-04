import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { RawUsageEvent } from '@claii/core';
import type { ConnectorContext, Detection, LocalConnector, ScanOptions } from '../types.js';
import { fileMeta, num, readFileState, safeJson, str, writeFileState } from '../util/files.js';

/**
 * Cline and Roo Code local task storage (research/other-sources.md §8 "Cline and Roo Code") — both
 * are VS Code extensions/forks sharing the same task-log design under the editor's `globalStorage`
 * directory: `<globalStorage>/<extension-id>/tasks/<taskId>/`. `vsCodeGlobalStorageRoots` also
 * searches VS Code Server's own globalStorage (`~/.vscode-server/data/User/globalStorage`) — the
 * research cites a distinct path for Roo Code under remote/WSL/SSH-attached sessions.
 *
 * We read `ui_messages.json` in each task directory: an array of UI timeline messages, where
 * entries with `say: 'api_req_started'` carry a JSON-*string* `text` field (parsed a second time)
 * with `tokensIn`/`tokensOut`/`cacheWrites`/`cacheReads`/`cost`/`apiProtocol` for that request
 * (confirmed field names, cross-tool via the `tokscale` parser). Model id is read from that same
 * object when present, else best-effort from `task_metadata.json`, else from the first message
 * carrying a `model` field in `api_conversation_history.json`, else 'unknown'. Provider is always
 * 'other' (Cline/Roo Code support many backends and don't consistently expose which); core infers
 * the real provider from the model id at finalize time — `apiProtocol` is captured into `meta` for
 * visibility only, not used to override that inference.
 *
 * UNVERIFIED: `task_metadata.json`'s exact field names for the task's working directory
 * (`cwd`/`workspace`/`workspaceDir` are all tried) and for the model id
 * (`apiModelId`/`modelId`/`model`, plus a nested `api.modelId`/`api.model`) — coded defensively so
 * a missing/renamed field degrades to 'unknown' rather than throwing. Whole-file re-reads (see
 * `scan()`) mean a wrong guess here never blocks the token/cost numbers, which are read directly
 * off documented `ui_messages.json` fields. We also don't read the sibling `state/taskHistory.json`
 * task index the research mentions (no field schema was found for it) — enumerating `tasks/*`
 * subdirectories directly is at least as complete and doesn't depend on that index being present
 * or fresh. Both repos have open issues about task-history JSON corruption/data loss, so every read
 * here is wrapped defensively (try/catch, `safeJson`) and a corrupt file is skipped, not thrown.
 */

export type ClineTool = 'cline' | 'roo-code';

const EXTENSIONS: { dir: string; tool: ClineTool }[] = [
  { dir: 'saoudrizwan.claude-dev', tool: 'cline' },
  { dir: 'rooveterinaryinc.roo-cline', tool: 'roo-code' },
];

/** VS Code and its common forks all use the same `User/globalStorage/<ext>` layout. */
const EDITOR_APPS = ['Code', 'Cursor', 'VSCodium', 'Code - Insiders'];

/** Roots to search for `<app>/User/globalStorage`, one per supported editor, for the given OS. */
export function vsCodeGlobalStorageRoots(env: NodeJS.ProcessEnv, home: string, platform: NodeJS.Platform = process.platform): string[] {
  if (platform === 'darwin') {
    return EDITOR_APPS.map((app) => join(home, 'Library', 'Application Support', app, 'User', 'globalStorage'));
  }
  if (platform === 'win32') {
    const appData = env['APPDATA'];
    return appData ? EDITOR_APPS.map((app) => join(appData, app, 'User', 'globalStorage')) : [];
  }
  // Linux, plus VS Code Server's own globalStorage for remote/WSL/SSH-attached sessions — a
  // distinct path cited specifically for Roo Code (research/other-sources.md §8 "Cline and Roo
  // Code"). Only relevant when clai itself runs on the remote/WSL Linux host, not the local client.
  return [...EDITOR_APPS.map((app) => join(home, '.config', app, 'User', 'globalStorage')), join(home, '.vscode-server', 'data', 'User', 'globalStorage')];
}

export interface ClineTaskDir {
  dir: string;
  taskId: string;
  tool: ClineTool;
}

export function findClineTasks(env: NodeJS.ProcessEnv, home: string, platform?: NodeJS.Platform): ClineTaskDir[] {
  const roots = vsCodeGlobalStorageRoots(env, home, platform);
  const out: ClineTaskDir[] = [];
  for (const root of roots) {
    for (const ext of EXTENSIONS) {
      const tasksDir = join(root, ext.dir, 'tasks');
      if (!existsSync(tasksDir)) continue;
      let entries: import('node:fs').Dirent[];
      try {
        entries = readdirSync(tasksDir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of entries) {
        if (!e.isDirectory()) continue;
        const dir = join(tasksDir, e.name);
        if (existsSync(join(dir, 'ui_messages.json'))) out.push({ dir, taskId: e.name, tool: ext.tool });
      }
    }
  }
  return out;
}

interface ClineUiMessage {
  ts?: number;
  type?: string;
  say?: string;
  text?: string;
}

export interface ClineApiReqInfo {
  model?: string;
  tokensIn?: number;
  tokensOut?: number;
  cacheWrites?: number;
  cacheReads?: number;
  cost?: number;
  /** Wire protocol used for this request (e.g. `anthropic`/`openai`); confirmed field name via the
   * `tokscale` parser (research/other-sources.md §8), kept for `meta` only — `provider` is still
   * left to core's model-id inference below, not overridden from this. */
  apiProtocol?: string;
}

export function parseApiReqStarted(msg: ClineUiMessage): ClineApiReqInfo | null {
  if (msg.say !== 'api_req_started' || !msg.text) return null;
  return safeJson<ClineApiReqInfo>(msg.text);
}

/** Best-effort model id for a task, tried when the per-request info doesn't carry one. */
export function readTaskModel(dir: string): string | undefined {
  const metaPath = join(dir, 'task_metadata.json');
  if (existsSync(metaPath)) {
    try {
      const meta = safeJson<Record<string, unknown>>(readFileSync(metaPath, 'utf8'));
      const direct = str(meta?.['apiModelId']) ?? str(meta?.['modelId']) ?? str(meta?.['model']);
      if (direct) return direct;
      const api = meta?.['api'] as Record<string, unknown> | undefined;
      const nested = str(api?.['modelId']) ?? str(api?.['model']);
      if (nested) return nested;
    } catch {
      // fall through to conversation history
    }
  }
  const historyPath = join(dir, 'api_conversation_history.json');
  if (existsSync(historyPath)) {
    try {
      const hist = safeJson<unknown[]>(readFileSync(historyPath, 'utf8'));
      if (Array.isArray(hist)) {
        for (const m of hist) {
          if (m && typeof m === 'object') {
            const v = str((m as Record<string, unknown>)['model']);
            if (v) return v;
          }
        }
      }
    } catch {
      // no model info recoverable
    }
  }
  return undefined;
}

/** Best-effort project/cwd for a task, from `task_metadata.json`. */
export function readTaskProject(dir: string): { cwd?: string; project?: string } {
  const metaPath = join(dir, 'task_metadata.json');
  if (!existsSync(metaPath)) return {};
  try {
    const meta = safeJson<Record<string, unknown>>(readFileSync(metaPath, 'utf8'));
    const cwd = str(meta?.['cwd']) ?? str(meta?.['workspace']) ?? str(meta?.['workspaceDir']);
    return { cwd, project: cwd ? basename(cwd) : undefined };
  } catch {
    return {};
  }
}

export function toClineEvent(info: ClineApiReqInfo, opts: { ts: number; taskId: string; tool: ClineTool; fallbackModel?: string; cwd?: string; project?: string; identity?: ConnectorContext['identity'] }): RawUsageEvent {
  const model = str(info.model) ?? opts.fallbackModel ?? 'unknown';
  const cost = typeof info.cost === 'number' && Number.isFinite(info.cost) ? info.cost : undefined;
  return {
    ts: new Date(opts.ts).toISOString(),
    source: 'cline',
    provider: 'other',
    model,
    surface: 'ide',
    billing: 'api',
    granularity: 'request',
    actor: { email: opts.identity?.email, name: opts.identity?.name },
    context: { sessionId: opts.taskId, cwd: opts.cwd, project: opts.project, device: opts.identity?.device },
    usage: {
      input: num(info.tokensIn),
      output: num(info.tokensOut),
      cacheRead: num(info.cacheReads),
      cacheWrite5m: num(info.cacheWrites),
      cacheWrite1h: 0,
      requests: 1,
    },
    cost: cost === undefined ? undefined : { computedUsd: cost },
    naturalKey: [opts.taskId, String(opts.ts)],
    meta: info.apiProtocol ? { tool: opts.tool, apiProtocol: info.apiProtocol } : { tool: opts.tool },
  };
}

export const clineConnector: LocalConnector = {
  kind: 'local',
  id: 'cline',
  displayName: 'Cline / Roo Code',

  async detect(ctx: ConnectorContext): Promise<Detection> {
    const tasks = findClineTasks(ctx.env, ctx.home);
    if (tasks.length === 0) return { found: false, summary: 'No Cline or Roo Code tasks found (VS Code globalStorage)', paths: [] };
    const clineCount = tasks.filter((t) => t.tool === 'cline').length;
    const rooCount = tasks.length - clineCount;
    return {
      found: true,
      summary: `${clineCount} Cline task${clineCount === 1 ? '' : 's'}, ${rooCount} Roo Code task${rooCount === 1 ? '' : 's'}`,
      paths: [...new Set(tasks.map((t) => t.dir))],
      details: { tasks: tasks.length, cline: clineCount, rooCode: rooCount },
    };
  },

  async *scan(ctx: ConnectorContext, opts: ScanOptions = {}): AsyncGenerator<RawUsageEvent> {
    const tasks = findClineTasks(ctx.env, ctx.home);
    for (const task of tasks) {
      const file = join(task.dir, 'ui_messages.json');
      const meta = fileMeta(file);
      if (!meta) continue;
      const prev = opts.full ? undefined : readFileState(ctx.state, file);
      if (prev && prev.size === meta.size && prev.mtimeMs === meta.mtimeMs) continue; // unchanged
      if (opts.since && meta.mtimeMs < Date.parse(opts.since) && !prev) {
        writeFileState(ctx.state, file, { size: meta.size, mtimeMs: meta.mtimeMs, offset: meta.size });
        continue;
      }
      try {
        const arr = safeJson<ClineUiMessage[]>(readFileSync(file, 'utf8'));
        if (Array.isArray(arr)) {
          const fallbackModel = readTaskModel(task.dir);
          const { cwd, project } = readTaskProject(task.dir);
          for (const msg of arr) {
            const info = parseApiReqStarted(msg);
            if (!info || typeof msg.ts !== 'number') continue;
            const ev = toClineEvent(info, { ts: msg.ts, taskId: task.taskId, tool: task.tool, fallbackModel, cwd, project, identity: ctx.identity });
            if (opts.since && ev.ts < opts.since) continue;
            yield ev;
          }
        }
        writeFileState(ctx.state, file, { size: meta.size, mtimeMs: meta.mtimeMs, offset: meta.size });
      } catch (err) {
        ctx.log.warn(`cline: failed reading ${file}: ${(err as Error).message}`);
      }
    }
  },
};
