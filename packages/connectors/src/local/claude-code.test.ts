import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CATALOG, finalizeEvent } from '@claii/core';
import { claudeCodeConnector, parseAssistantLine, toEvent } from './claude-code.js';
import { noopLogger, type ConnectorContext } from '../types.js';

function memState() {
  const m = new Map<string, string>();
  return { get: (k: string) => m.get(k), set: (k: string, v: string) => void m.set(k, v), map: m };
}

function ctxFor(home: string, plan?: string): ConnectorContext & { stateMap: Map<string, string> } {
  const st = memState();
  return {
    catalog: CATALOG,
    state: st,
    stateMap: st.map,
    log: noopLogger,
    now: () => new Date('2026-09-03T12:00:00Z'),
    home,
    env: {},
    planFor: () => plan,
  };
}

/** Mimics the real Claude Code line shape (structure inspected on 2026-09-03), content omitted. */
function assistantLine(over: Record<string, unknown> = {}, usage: Record<string, unknown> = {}) {
  return JSON.stringify({
    parentUuid: 'p1',
    isSidechain: false,
    userType: 'external',
    cwd: '/Users/me/Projects/clai',
    sessionId: 'sess-1',
    version: '2.1.221',
    gitBranch: 'main',
    type: 'assistant',
    uuid: 'u1',
    timestamp: '2026-09-01T10:00:00.000Z',
    requestId: 'req_1',
    effort: 'xhigh',
    message: {
      id: 'msg_1',
      model: 'claude-opus-5',
      role: 'assistant',
      type: 'message',
      content: [{ type: 'text', text: 'REDACTED' }],
      stop_reason: 'end_turn',
      usage: {
        input_tokens: 2,
        cache_creation_input_tokens: 77025,
        cache_read_input_tokens: 0,
        output_tokens: 774,
        server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 },
        service_tier: 'standard',
        cache_creation: { ephemeral_1h_input_tokens: 77025, ephemeral_5m_input_tokens: 0 },
        inference_geo: 'not_available',
        speed: 'standard',
        ...usage,
      },
    },
    ...over,
  });
}

describe('claude-code parser', () => {
  it('parses an assistant line into a normalized event', () => {
    const o = parseAssistantLine(assistantLine())!;
    expect(o).not.toBeNull();
    const ev = toEvent(o, { file: '/x/sess-1.jsonl', projectDir: '/x/-Users-me-Projects-clai', plan: 'max_20x' })!;
    expect(ev.model).toBe('claude-opus-5');
    expect(ev.usage).toEqual({ input: 2, output: 774, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 77025, requests: 1, webSearches: 0, webFetches: 0 });
    expect(ev.context.project).toBe('clai');
    expect(ev.context.sessionId).toBe('sess-1');
    expect(ev.context.effort).toBe('xhigh');
    expect(ev.billing).toBe('subscription');
    expect(ev.plan).toBe('max_20x');
    expect(ev.naturalKey).toEqual(['msg_1', 'req_1']);
    const { event } = finalizeEvent(ev, CATALOG);
    // 2*5 + 774*25 + 77025*10 => (10 + 19350 + 770250)/1e6
    expect(event.cost.computedUsd).toBeCloseTo(0.78961, 5);
  });
  it('falls back to legacy cache_creation_input_tokens when no breakdown exists', () => {
    const line = assistantLine({}, { cache_creation: undefined, cache_creation_input_tokens: 500 });
    const o = parseAssistantLine(line)!;
    const ev = toEvent(o, { file: '/x/a.jsonl', projectDir: '/x/p' })!;
    expect(ev.usage.cacheWrite5m).toBe(500);
    expect(ev.usage.cacheWrite1h).toBe(0);
    expect(ev.billing).toBe('unknown');
  });
  it('ignores non-assistant lines cheaply', () => {
    expect(parseAssistantLine('{"type":"user","message":{"role":"user","content":"hi"}}')).toBeNull();
    expect(parseAssistantLine('not json')).toBeNull();
  });
  it('labels sub-agent files', () => {
    const o = parseAssistantLine(assistantLine())!;
    const ev = toEvent(o, { file: '/x/p/agent-abc123.jsonl', projectDir: '/x/p' })!;
    expect(ev.context.agentId).toBe('abc123');
  });
});

describe('claude-code connector scan', () => {
  it('walks project dirs, dedups streamed duplicates, resumes incrementally', async () => {
    const home = mkdtempSync(join(tmpdir(), 'clai-cc-'));
    const proj = join(home, '.claude', 'projects', '-Users-me-Projects-clai');
    mkdirSync(proj, { recursive: true });
    const file = join(proj, 'sess-1.jsonl');
    // three lines for the same message (thinking/text/tool_use blocks) + one user line + a second message
    writeFileSync(
      file,
      [
        assistantLine(),
        assistantLine({ uuid: 'u1b' }),
        '{"type":"user","message":{"role":"user","content":"x"},"timestamp":"2026-09-01T10:00:01.000Z"}',
        assistantLine({ uuid: 'u2', requestId: 'req_2', timestamp: '2026-09-01T10:01:00.000Z', message: JSON.parse(assistantLine()).message && { ...JSON.parse(assistantLine()).message, id: 'msg_2' } }),
        '',
      ].join('\n'),
    );
    const ctx = ctxFor(home, 'pro');
    const det = await claudeCodeConnector.detect(ctx);
    expect(det.found).toBe(true);
    const first: { naturalKey?: string[]; usage: { output: number } }[] = [];
    for await (const e of claudeCodeConnector.scan(ctx)) first.push(e);
    expect(first).toHaveLength(2);
    expect(first[0]!.naturalKey).toEqual(['msg_1', 'req_1']);
    // second scan: nothing new
    const second: unknown[] = [];
    for await (const e of claudeCodeConnector.scan(ctx)) second.push(e);
    expect(second).toHaveLength(0);
    // append a new message: only it is read
    appendFileSync(file, assistantLine({ uuid: 'u3', requestId: 'req_3', timestamp: '2026-09-01T10:02:00.000Z', message: { ...JSON.parse(assistantLine()).message, id: 'msg_3' } }) + '\n');
    const third: { naturalKey?: string[] }[] = [];
    for await (const e of claudeCodeConnector.scan(ctx)) third.push(e);
    expect(third).toHaveLength(1);
    expect(third[0]!.naturalKey).toEqual(['msg_3', 'req_3']);
    // partial trailing line (no newline) is not consumed until complete
    appendFileSync(file, assistantLine({ uuid: 'u4', requestId: 'req_4', message: { ...JSON.parse(assistantLine()).message, id: 'msg_4' } }).slice(0, 50));
    const fourth: unknown[] = [];
    for await (const e of claudeCodeConnector.scan(ctx)) fourth.push(e);
    expect(fourth).toHaveLength(0);
    // full rescan re-emits everything
    const full: unknown[] = [];
    for await (const e of claudeCodeConnector.scan(ctx, { full: true })) full.push(e);
    expect(full).toHaveLength(3);
  });

  it('merges streamed duplicate lines by taking the maximum output tokens', async () => {
    const home = mkdtempSync(join(tmpdir(), 'clai-cc2-'));
    const proj = join(home, '.claude', 'projects', '-Users-me-Projects-x');
    mkdirSync(proj, { recursive: true });
    // thinking block line reports 5 output tokens, the final text line 1136 (observed in real transcripts)
    writeFileSync(join(proj, 's.jsonl'), [assistantLine({ uuid: 'a' }, { output_tokens: 5 }), assistantLine({ uuid: 'b' }, { output_tokens: 5 }), assistantLine({ uuid: 'c' }, { output_tokens: 1136 }), ''].join('\n'));
    const ctx = ctxFor(home);
    const out: { usage: { output: number; cacheWrite1h: number } }[] = [];
    for await (const e of claudeCodeConnector.scan(ctx)) out.push(e);
    expect(out).toHaveLength(1);
    expect(out[0]!.usage.output).toBe(1136);
    expect(out[0]!.usage.cacheWrite1h).toBe(77025);
  });
});
