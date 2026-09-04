import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CATALOG } from '@claii/core';
import { codexCliConnector, newCodexState, parseCodexLine } from './codex-cli.js';
import { noopLogger, type ConnectorContext } from '../types.js';

const lines = [
  JSON.stringify({ timestamp: '2026-09-02T09:00:00.000Z', type: 'session_meta', payload: { id: 'sess-x', timestamp: '2026-09-02T09:00:00.000Z', cwd: '/Users/me/Projects/api', originator: 'codex_cli_rs', cli_version: '0.45.0', instructions: null, git: { commit_hash: 'abc', branch: 'feat/x', repository_url: 'git@github.com:me/api.git' } } }),
  JSON.stringify({ timestamp: '2026-09-02T09:00:01.000Z', type: 'turn_context', payload: { cwd: '/Users/me/Projects/api', approval_policy: 'on-request', sandbox_policy: { type: 'workspace-write' }, model: 'gpt-5-codex', effort: 'medium', summary: 'auto' } }),
  JSON.stringify({ timestamp: '2026-09-02T09:00:05.000Z', type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 12000, cached_input_tokens: 10000, output_tokens: 300, reasoning_output_tokens: 100, total_tokens: 12300 }, last_token_usage: { input_tokens: 12000, cached_input_tokens: 10000, output_tokens: 300, reasoning_output_tokens: 100, total_tokens: 12300 }, model_context_window: 400000 }, rate_limits: { primary: { used_percent: 12.5, window_minutes: 300, resets_at: 1756810800 }, secondary: { used_percent: 30, window_minutes: 10080, resets_at: 1757300000 } } } }),
  // duplicate token_count (rate-limit refresh) with identical totals => no event
  JSON.stringify({ timestamp: '2026-09-02T09:00:06.000Z', type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 12000, cached_input_tokens: 10000, output_tokens: 300, reasoning_output_tokens: 100, total_tokens: 12300 }, last_token_usage: { input_tokens: 12000, cached_input_tokens: 10000, output_tokens: 300, reasoning_output_tokens: 100, total_tokens: 12300 }, model_context_window: 400000 }, rate_limits: null } }),
  JSON.stringify({ timestamp: '2026-09-02T09:01:00.000Z', type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 30000, cached_input_tokens: 25000, output_tokens: 1300, reasoning_output_tokens: 600, total_tokens: 31300 }, last_token_usage: { input_tokens: 18000, cached_input_tokens: 15000, output_tokens: 1000, reasoning_output_tokens: 500, total_tokens: 19000 }, model_context_window: 400000 }, rate_limits: null } }),
];

describe('codex-cli parser', () => {
  it('derives per-call usage from cumulative deltas and OpenAI cached-token semantics', () => {
    const st = newCodexState();
    const events = lines.map((l) => parseCodexLine(l, st, { file: '/x/rollout-1.jsonl', billing: 'subscription', plan: 'plus' })).filter(Boolean);
    expect(events).toHaveLength(2);
    const [a, b] = events as NonNullable<(typeof events)[number]>[];
    expect(a!.model).toBe('gpt-5-codex');
    expect(a!.usage).toMatchObject({ input: 2000, cacheRead: 10000, output: 300, reasoning: 100, requests: 1 });
    expect(b!.usage).toMatchObject({ input: 3000, cacheRead: 15000, output: 1000, reasoning: 500 });
    expect(a!.context).toMatchObject({ sessionId: 'sess-x', project: 'api', gitBranch: 'feat/x', appVersion: '0.45.0' });
    expect(a!.plan).toBe('plus');
    expect(a!.naturalKey).toEqual(['sess-x', '1', '2026-09-02T09:00:05.000Z']);
  });
});

describe('codex-cli connector', () => {
  it('detects sessions and infers billing mode from auth.json key names', async () => {
    const home = mkdtempSync(join(tmpdir(), 'clai-codex-'));
    const dir = join(home, '.codex', 'sessions', '2026', '09', '02');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'rollout-2026-09-02T09-00-00-abc.jsonl'), lines.join('\n') + '\n');
    writeFileSync(join(home, '.codex', 'auth.json'), JSON.stringify({ OPENAI_API_KEY: null, tokens: { id_token: 'x', access_token: 'y', refresh_token: 'z', account_id: 'acc' }, last_refresh: '2026-09-01T00:00:00Z' }));
    const m = new Map<string, string>();
    const ctx: ConnectorContext = { catalog: CATALOG, state: { get: (k) => m.get(k), set: (k, v) => void m.set(k, v) }, log: noopLogger, now: () => new Date(), home, env: {}, planFor: () => 'plus' };
    const det = await codexCliConnector.detect(ctx);
    expect(det.found).toBe(true);
    expect(det.summary).toContain('subscription');
    const out: { billing: string }[] = [];
    for await (const e of codexCliConnector.scan(ctx)) out.push(e);
    expect(out).toHaveLength(2);
    expect(out[0]!.billing).toBe('subscription');
    const again: unknown[] = [];
    for await (const e of codexCliConnector.scan(ctx)) again.push(e);
    expect(again).toHaveLength(0);
  });
});
