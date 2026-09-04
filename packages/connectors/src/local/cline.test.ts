import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CATALOG } from '@claii/core';
import { clineConnector, findClineTasks, parseApiReqStarted, readTaskModel, readTaskProject, toClineEvent, vsCodeGlobalStorageRoots } from './cline.js';
import { noopLogger, type ConnectorContext } from '../types.js';

function memState() {
  const m = new Map<string, string>();
  return { get: (k: string) => m.get(k), set: (k: string, v: string) => void m.set(k, v) };
}

function ctxFor(home: string): ConnectorContext {
  return { catalog: CATALOG, state: memState(), log: noopLogger, now: () => new Date('2026-09-03T12:00:00Z'), home, env: {}, planFor: () => undefined };
}

function apiReqStartedMsg(over: Record<string, unknown> = {}) {
  return { ts: 1756720000000, type: 'say', say: 'api_req_started', text: JSON.stringify({ tokensIn: 1500, tokensOut: 400, cacheWrites: 200, cacheReads: 50, cost: 0.045, ...over }) };
}

describe('vsCodeGlobalStorageRoots', () => {
  it('builds the right shape for macOS, Linux and Windows', () => {
    const mac = vsCodeGlobalStorageRoots({}, '/Users/me', 'darwin');
    expect(mac).toContain(join('/Users/me', 'Library', 'Application Support', 'Code', 'User', 'globalStorage'));
    expect(mac).toContain(join('/Users/me', 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage'));

    const linux = vsCodeGlobalStorageRoots({}, '/home/me', 'linux');
    expect(linux).toContain(join('/home/me', '.config', 'Code', 'User', 'globalStorage'));
    expect(linux).toContain(join('/home/me', '.config', 'VSCodium', 'User', 'globalStorage'));
    // remote/WSL/SSH-attached VS Code Server sessions (cited specifically for Roo Code)
    expect(linux).toContain(join('/home/me', '.vscode-server', 'data', 'User', 'globalStorage'));

    const win = vsCodeGlobalStorageRoots({ APPDATA: 'C:\\Users\\me\\AppData\\Roaming' }, 'C:\\Users\\me', 'win32');
    expect(win).toContain(join('C:\\Users\\me\\AppData\\Roaming', 'Code', 'User', 'globalStorage'));
    expect(vsCodeGlobalStorageRoots({}, 'C:\\Users\\me', 'win32')).toEqual([]); // no APPDATA
  });
});

describe('parseApiReqStarted', () => {
  it('parses the JSON-string text field of an api_req_started entry', () => {
    const info = parseApiReqStarted(apiReqStartedMsg())!;
    expect(info).toEqual({ tokensIn: 1500, tokensOut: 400, cacheWrites: 200, cacheReads: 50, cost: 0.045 });
  });
  it('ignores other say types', () => {
    expect(parseApiReqStarted({ ts: 1, say: 'text', text: 'hello' })).toBeNull();
  });
});

describe('toClineEvent', () => {
  it('maps token/cost fields, falls back to a supplied model, and tags the tool in meta', () => {
    const info = parseApiReqStarted(apiReqStartedMsg())!;
    const ev = toClineEvent(info, { ts: 1756720000000, taskId: 'task-1', tool: 'roo-code', fallbackModel: 'claude-sonnet-5', cwd: '/Users/me/Projects/clai', project: 'clai' });
    expect(ev.provider).toBe('other');
    expect(ev.surface).toBe('ide');
    expect(ev.billing).toBe('api');
    expect(ev.model).toBe('claude-sonnet-5');
    expect(ev.usage).toEqual({ input: 1500, output: 400, cacheRead: 50, cacheWrite5m: 200, cacheWrite1h: 0, requests: 1 });
    expect(ev.cost).toEqual({ computedUsd: 0.045 });
    expect(ev.context.project).toBe('clai');
    expect(ev.naturalKey).toEqual(['task-1', '1756720000000']);
    expect(ev.meta).toEqual({ tool: 'roo-code' });
  });

  it('prefers a model embedded in the request info over the fallback', () => {
    const info = parseApiReqStarted(apiReqStartedMsg({ model: 'gpt-5' }))!;
    const ev = toClineEvent(info, { ts: 1, taskId: 't', tool: 'cline', fallbackModel: 'claude-sonnet-5' });
    expect(ev.model).toBe('gpt-5');
  });

  it('captures apiProtocol into meta when present, without touching provider', () => {
    const info = parseApiReqStarted(apiReqStartedMsg({ apiProtocol: 'anthropic' }))!;
    const ev = toClineEvent(info, { ts: 1, taskId: 't', tool: 'cline' });
    expect(ev.provider).toBe('other');
    expect(ev.meta).toEqual({ tool: 'cline', apiProtocol: 'anthropic' });
  });
});

describe('cline connector', () => {
  it('discovers tasks under saoudrizwan.claude-dev and rooveterinaryinc.roo-cline, scans usage, and dedups unchanged files', async () => {
    const home = mkdtempSync(join(tmpdir(), 'clai-cline-'));
    const clineTasks = join(home, 'Library', 'Application Support', 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'tasks', 'task-1');
    const rooTasks = join(home, 'Library', 'Application Support', 'Code', 'User', 'globalStorage', 'rooveterinaryinc.roo-cline', 'tasks', 'task-2');
    mkdirSync(clineTasks, { recursive: true });
    mkdirSync(rooTasks, { recursive: true });
    writeFileSync(join(clineTasks, 'ui_messages.json'), JSON.stringify([{ ts: 1756719999000, say: 'text', text: 'hi' }, apiReqStartedMsg()]));
    writeFileSync(join(clineTasks, 'task_metadata.json'), JSON.stringify({ cwd: '/Users/me/Projects/clai', apiModelId: 'claude-sonnet-5' }));
    writeFileSync(join(rooTasks, 'ui_messages.json'), JSON.stringify([apiReqStartedMsg({ cost: 0.01 })]));

    const found = findClineTasks({}, home, 'darwin');
    expect(found).toHaveLength(2);

    const ctx = ctxFor(home);
    // findClineTasks in the connector uses process.platform; only assert end-to-end on the current OS.
    const det = await clineConnector.detect(ctx);
    if (process.platform === 'darwin') {
      expect(det.found).toBe(true);
      expect(det.details).toEqual({ tasks: 2, cline: 1, rooCode: 1 });

      const first: { model: string; context: { project?: string } }[] = [];
      for await (const e of clineConnector.scan(ctx)) first.push(e as never);
      expect(first).toHaveLength(2);
      const clineEv = first.find((e) => e.context.project === 'clai')!;
      expect(clineEv.model).toBe('claude-sonnet-5'); // from task_metadata.json, no model in the request text

      const second: unknown[] = [];
      for await (const e of clineConnector.scan(ctx)) second.push(e);
      expect(second).toHaveLength(0);
    }
  });

  it('readTaskModel falls back through task_metadata.json then api_conversation_history.json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clai-cline-task-'));
    expect(readTaskModel(dir)).toBeUndefined();
    writeFileSync(join(dir, 'api_conversation_history.json'), JSON.stringify([{ role: 'user', content: 'x' }, { role: 'assistant', model: 'gpt-5', content: 'y' }]));
    expect(readTaskModel(dir)).toBe('gpt-5');
    writeFileSync(join(dir, 'task_metadata.json'), JSON.stringify({ modelId: 'claude-opus-5' }));
    expect(readTaskModel(dir)).toBe('claude-opus-5');
  });

  it('readTaskProject reads cwd/workspace fields defensively', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clai-cline-task-'));
    expect(readTaskProject(dir)).toEqual({});
    writeFileSync(join(dir, 'task_metadata.json'), JSON.stringify({ workspace: '/Users/me/Projects/foo' }));
    expect(readTaskProject(dir)).toEqual({ cwd: '/Users/me/Projects/foo', project: 'foo' });
  });
});
