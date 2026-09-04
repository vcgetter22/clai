import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CATALOG } from '@claii/core';
import { mapOpencodeProvider, opencodeConnector, opencodeStorageRoot, toOpencodeEvent } from './opencode.js';
import { noopLogger, type ConnectorContext } from '../types.js';

function memState() {
  const m = new Map<string, string>();
  return { get: (k: string) => m.get(k), set: (k: string, v: string) => void m.set(k, v) };
}

function ctxFor(home: string, env: NodeJS.ProcessEnv = {}): ConnectorContext {
  return { catalog: CATALOG, state: memState(), log: noopLogger, now: () => new Date('2026-09-03T12:00:00Z'), home, env, planFor: () => undefined };
}

function assistantMessage(over: Record<string, unknown> = {}) {
  return JSON.stringify({
    id: 'msg_1',
    role: 'assistant',
    sessionID: 'ses_1',
    modelID: 'claude-sonnet-5',
    providerID: 'anthropic',
    tokens: { input: 500, output: 200, reasoning: 30, cache: { read: 100, write: 50 } },
    cost: 0.0123,
    time: { created: 1756720000000, completed: 1756720010000 },
    ...over,
  });
}

describe('mapOpencodeProvider', () => {
  it('maps the direct providers and falls back to other for gateways', () => {
    expect(mapOpencodeProvider('anthropic')).toBe('anthropic');
    expect(mapOpencodeProvider('openai')).toBe('openai');
    expect(mapOpencodeProvider('google')).toBe('google');
    expect(mapOpencodeProvider('xai')).toBe('xai');
    expect(mapOpencodeProvider('mistral')).toBe('mistral');
    expect(mapOpencodeProvider('deepseek')).toBe('deepseek');
    expect(mapOpencodeProvider('openrouter')).toBe('other');
    expect(mapOpencodeProvider('bedrock')).toBe('other');
    expect(mapOpencodeProvider('vertex')).toBe('other');
    expect(mapOpencodeProvider(undefined)).toBe('other');
  });
});

describe('opencodeStorageRoot', () => {
  it('respects XDG_DATA_HOME and defaults to ~/.local/share', () => {
    expect(opencodeStorageRoot({}, '/home/me')).toBe(join('/home/me', '.local', 'share', 'opencode', 'storage'));
    expect(opencodeStorageRoot({ XDG_DATA_HOME: '/custom/data' }, '/home/me')).toBe(join('/custom/data', 'opencode', 'storage'));
  });
});

describe('toOpencodeEvent', () => {
  it('maps tokens/cost/time into a normalized event', () => {
    const msg = JSON.parse(assistantMessage());
    const ev = toOpencodeEvent(msg, { file: '/x/msg_1.json', sessionID: 'ses_1', messageID: 'msg_1', projectDir: '/Users/me/Projects/clai' })!;
    expect(ev.model).toBe('claude-sonnet-5');
    expect(ev.provider).toBe('anthropic');
    expect(ev.billing).toBe('api');
    expect(ev.usage).toEqual({ input: 500, output: 200, reasoning: 30, cacheRead: 100, cacheWrite5m: 50, cacheWrite1h: 0, requests: 1 });
    expect(ev.cost).toEqual({ computedUsd: 0.0123 });
    expect(ev.context.project).toBe('clai');
    expect(ev.naturalKey).toEqual(['ses_1', 'msg_1']);
    expect(ev.ts).toBe(new Date(1756720010000).toISOString());
  });

  it('returns null without a usable timestamp', () => {
    const msg = JSON.parse(assistantMessage({ time: {} }));
    expect(toOpencodeEvent(msg, { file: '/x/msg_1.json', sessionID: 'ses_1', messageID: 'msg_1' })).toBeNull();
  });
});

describe('opencode connector scan', () => {
  it('walks message/<session>/<message>.json, resolves the project from session/<projectHash>/<session>.json, skips non-assistant/no-token messages, and dedups unchanged files', async () => {
    const home = mkdtempSync(join(tmpdir(), 'clai-opencode-'));
    const root = join(home, '.local', 'share', 'opencode', 'storage');
    mkdirSync(join(root, 'message', 'ses_1'), { recursive: true });
    // Sessions live nested under a per-project-hash directory (session/{projectHash}/{sessionID}.json),
    // not flat under session/ — regression coverage for that path shape.
    mkdirSync(join(root, 'session', 'prj_abc123'), { recursive: true });
    writeFileSync(join(root, 'session', 'prj_abc123', 'ses_1.json'), JSON.stringify({ id: 'ses_1', path: '/Users/me/Projects/clai', title: 'clai' }));
    writeFileSync(join(root, 'message', 'ses_1', 'msg_0.json'), JSON.stringify({ id: 'msg_0', role: 'user', sessionID: 'ses_1' }));
    writeFileSync(join(root, 'message', 'ses_1', 'msg_1.json'), assistantMessage());

    const ctx = ctxFor(home);
    const det = await opencodeConnector.detect(ctx);
    expect(det.found).toBe(true);
    expect(det.details?.['files']).toBe(2);

    const first: { context: { project?: string } }[] = [];
    for await (const e of opencodeConnector.scan(ctx)) first.push(e as never);
    expect(first).toHaveLength(1);
    expect(first[0]!.context.project).toBe('clai'); // resolved through the nested project-hash session file

    const second: unknown[] = [];
    for await (const e of opencodeConnector.scan(ctx)) second.push(e);
    expect(second).toHaveLength(0);

    // a new assistant message file appears
    mkdirSync(join(root, 'message', 'ses_1'), { recursive: true });
    writeFileSync(join(root, 'message', 'ses_1', 'msg_2.json'), assistantMessage({ id: 'msg_2', time: { created: 1756720020000, completed: 1756720030000 } }));
    const third: { naturalKey?: string[] }[] = [];
    for await (const e of opencodeConnector.scan(ctx)) third.push(e);
    expect(third).toHaveLength(1);
    expect(third[0]!.naturalKey).toEqual(['ses_1', 'msg_2']);

    const full: unknown[] = [];
    for await (const e of opencodeConnector.scan(ctx, { full: true })) full.push(e);
    expect(full).toHaveLength(2);
  });

  it('detect() surfaces the v1.2+ SQLite storage file when no legacy JSON messages exist', async () => {
    const home = mkdtempSync(join(tmpdir(), 'clai-opencode-'));
    const root = join(home, '.local', 'share', 'opencode', 'storage');
    mkdirSync(root, { recursive: true });
    writeFileSync(join(home, '.local', 'share', 'opencode', 'opencode.db'), '');

    const ctx = ctxFor(home);
    const det = await opencodeConnector.detect(ctx);
    expect(det.found).toBe(true);
    expect(det.details).toEqual({ files: 0, sqlite: true });
    expect(det.summary).toMatch(/sqlite/i);

    const events: unknown[] = [];
    for await (const e of opencodeConnector.scan(ctx)) events.push(e);
    expect(events).toHaveLength(0); // not parsed -- no documented schema
  });
});
