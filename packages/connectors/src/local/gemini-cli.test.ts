import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CATALOG } from '@claii/core';
import { geminiCliConnector, geminiChatCheckpoints, geminiLogsFiles, geminiTelemetryOutfile, parseGeminiTelemetryLine, toGeminiEvent } from './gemini-cli.js';
import { noopLogger, type ConnectorContext } from '../types.js';

function memState() {
  const m = new Map<string, string>();
  return { get: (k: string) => m.get(k), set: (k: string, v: string) => void m.set(k, v) };
}

function ctxFor(home: string, plan?: string): ConnectorContext {
  return { catalog: CATALOG, state: memState(), log: noopLogger, now: () => new Date('2026-09-03T12:00:00Z'), home, env: {}, planFor: () => plan };
}

function apiResponseLine(over: Record<string, unknown> = {}) {
  return JSON.stringify({
    timestamp: '2026-09-01T10:00:00.000Z',
    attributes: {
      'session.id': 'sess-1',
      'event.name': 'gemini_cli.api_response',
      model: 'gemini-2.5-pro',
      cwd: '/Users/me/Projects/clai',
      response_id: 'resp-1',
      input_token_count: 1000,
      output_token_count: 200,
      cached_content_token_count: 300,
      thoughts_token_count: 50,
      ...over,
    },
  });
}

describe('gemini-cli telemetry line parser', () => {
  it('parses a matching gemini_cli.api_response event, subtracting cached from input and folding thoughts into output', () => {
    const p = parseGeminiTelemetryLine(apiResponseLine())!;
    expect(p).not.toBeNull();
    expect(p.model).toBe('gemini-2.5-pro');
    expect(p.input).toBe(700); // 1000 - 300 cached
    expect(p.cacheRead).toBe(300);
    expect(p.output).toBe(250); // 200 + 50 thoughts
    expect(p.reasoning).toBe(50);
    expect(p.sessionId).toBe('sess-1');
    expect(p.cwd).toBe('/Users/me/Projects/clai');
    const ev = toGeminiEvent(p, { plan: 'pro', idx: 1 });
    expect(ev.provider).toBe('google');
    expect(ev.billing).toBe('subscription');
    expect(ev.context.project).toBe('clai');
    expect(ev.usage).toEqual({ input: 700, output: 250, cacheRead: 300, cacheWrite5m: 0, cacheWrite1h: 0, reasoning: 50, requests: 1 });
    expect(ev.naturalKey).toEqual(['sess-1', 'resp-1']);
  });

  it('ignores non-matching events and unparsable lines cheaply', () => {
    expect(parseGeminiTelemetryLine(JSON.stringify({ attributes: { 'event.name': 'gemini_cli.tool_call' } }))).toBeNull();
    expect(parseGeminiTelemetryLine('not json')).toBeNull();
    expect(parseGeminiTelemetryLine('{"nothing":"gemini_cli.api_response but not real json'))
      .toBeNull();
  });

  it('accepts flattened attributes (no nested attributes bag)', () => {
    const line = JSON.stringify({ timestamp: 1756720800000, 'event.name': 'gemini_cli.api_response', model: 'gemini-2.5-flash', input_token_count: 10, output_token_count: 5, cached_content_token_count: 0, thoughts_token_count: 0 });
    const p = parseGeminiTelemetryLine(line)!;
    expect(p.model).toBe('gemini-2.5-flash');
    expect(p.input).toBe(10);
  });

  it('drops events with no discoverable timestamp', () => {
    const line = JSON.stringify({ attributes: { 'event.name': 'gemini_cli.api_response', model: 'x', input_token_count: 1, output_token_count: 1 } });
    expect(parseGeminiTelemetryLine(line)).toBeNull();
  });
});

describe('gemini-cli home/artifact discovery', () => {
  it('finds chat checkpoints and logs.json under tmp/<hash>/', () => {
    const home = mkdtempSync(join(tmpdir(), 'clai-gemini-'));
    const hashDir = join(home, 'tmp', 'abc123');
    mkdirSync(join(hashDir, 'chats'), { recursive: true });
    writeFileSync(join(hashDir, 'chats', 'checkpoint-default.json'), '[]');
    writeFileSync(join(hashDir, 'logs.json'), '[]');
    expect(geminiChatCheckpoints(home)).toHaveLength(1);
    expect(geminiLogsFiles(home)).toHaveLength(1);
  });

  it('resolves a relative telemetry outfile against the gemini home dir', () => {
    const home = mkdtempSync(join(tmpdir(), 'clai-gemini-'));
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, 'settings.json'), JSON.stringify({ telemetry: { enabled: true, target: 'local', outfile: 'telemetry.log' } }));
    expect(geminiTelemetryOutfile({}, home)).toBe(join(home, 'telemetry.log'));
  });

  it('returns undefined when settings.json is missing or has no outfile', () => {
    const home = mkdtempSync(join(tmpdir(), 'clai-gemini-'));
    expect(geminiTelemetryOutfile({}, home)).toBeUndefined();
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, 'settings.json'), JSON.stringify({}));
    expect(geminiTelemetryOutfile({}, home)).toBeUndefined();
  });

  it('prefers the GEMINI_TELEMETRY_OUTFILE env var override over settings.json', () => {
    const home = mkdtempSync(join(tmpdir(), 'clai-gemini-'));
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, 'settings.json'), JSON.stringify({ telemetry: { enabled: true, target: 'local', outfile: 'from-settings.log' } }));
    expect(geminiTelemetryOutfile({ GEMINI_TELEMETRY_OUTFILE: 'from-env.log' }, home)).toBe(join(home, 'from-env.log'));
    expect(geminiTelemetryOutfile({ GEMINI_TELEMETRY_OUTFILE: '/abs/from-env.log' }, home)).toBe('/abs/from-env.log');
    // no env override: falls back to settings.json as before
    expect(geminiTelemetryOutfile({}, home)).toBe(join(home, 'from-settings.log'));
  });
});

describe('gemini-cli connector', () => {
  it('detect() documents the chats/logs.json usage-data limitation when no telemetry outfile is configured', async () => {
    const home = mkdtempSync(join(tmpdir(), 'clai-gemini-'));
    const hashDir = join(home, '.gemini', 'tmp', 'abc123');
    mkdirSync(join(hashDir, 'chats'), { recursive: true });
    writeFileSync(join(hashDir, 'chats', 'checkpoint-default.json'), '[]');
    const ctx = ctxFor(home);
    const det = await geminiCliConnector.detect(ctx);
    expect(det.found).toBe(true);
    expect(det.summary).toMatch(/no per-turn usage|unavailable/i);
    expect(det.summary).toContain('1 chat checkpoint');
  });

  it('scans the telemetry outfile incrementally and resumes from a saved offset', async () => {
    const home = mkdtempSync(join(tmpdir(), 'clai-gemini-'));
    mkdirSync(join(home, '.gemini'), { recursive: true });
    writeFileSync(join(home, '.gemini', 'settings.json'), JSON.stringify({ telemetry: { enabled: true, target: 'local', outfile: 'telemetry.log' } }));
    const outfile = join(home, '.gemini', 'telemetry.log');
    writeFileSync(outfile, [apiResponseLine(), apiResponseLine({ response_id: 'resp-2' })].join('\n') + '\n');
    const ctx = ctxFor(home, 'pro');
    const det = await geminiCliConnector.detect(ctx);
    expect(det.details?.['telemetryOutfileFound']).toBe(true);

    const first: unknown[] = [];
    for await (const e of geminiCliConnector.scan(ctx)) first.push(e);
    expect(first).toHaveLength(2);

    const second: unknown[] = [];
    for await (const e of geminiCliConnector.scan(ctx)) second.push(e);
    expect(second).toHaveLength(0);

    appendFileSync(outfile, apiResponseLine({ response_id: 'resp-3' }) + '\n');
    const third: { naturalKey?: string[] }[] = [];
    for await (const e of geminiCliConnector.scan(ctx)) third.push(e);
    expect(third).toHaveLength(1);
    expect(third[0]!.naturalKey).toEqual(['sess-1', 'resp-3']);
  });

  it('returns no events when telemetry is not configured', async () => {
    const home = mkdtempSync(join(tmpdir(), 'clai-gemini-'));
    mkdirSync(join(home, '.gemini'), { recursive: true });
    const ctx = ctxFor(home);
    const out: unknown[] = [];
    for await (const e of geminiCliConnector.scan(ctx)) out.push(e);
    expect(out).toHaveLength(0);
  });
});
