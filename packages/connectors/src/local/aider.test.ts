import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CATALOG } from '@claii/core';
import { aiderConnector, aiderHistoryRoots, findAiderHistoryFiles, parseAiderHistory, turnToEvent } from './aider.js';
import { noopLogger, type ConnectorContext } from '../types.js';

function memState() {
  const m = new Map<string, string>();
  return { get: (k: string) => m.get(k), set: (k: string, v: string) => void m.set(k, v) };
}

function ctxFor(home: string, env: NodeJS.ProcessEnv = {}): ConnectorContext {
  return { catalog: CATALOG, state: memState(), log: noopLogger, now: () => new Date('2026-09-03T12:00:00Z'), home, env, planFor: () => undefined };
}

const SAMPLE = `# aider chat started at 2026-09-01 10:22:33

> /Users/me/.local/bin/aider --model gpt-5
> Aider v0.86.0
> Model: gpt-5 with diff edit format
> Git repo: .git with 245 files

#### please add a foo function

Sure, here you go.

> Tokens: 12k sent, 1.2k received. Cost: $0.05 message, $1.23 session.

#### now add tests

Added tests too.

> Tokens: 3.4k sent, 800 received. Cost: $0.02 message, $1.25 session.

# aider chat started at 2026-09-02 09:00:00

Main model: claude-opus-5 with diff edit format, infinite output
Weak model: claude-haiku-5

#### one more thing

OK.

> Tokens: 523 sent, 128 received. Cost: $0.01 message, $0.01 session.
`;

describe('parseAiderHistory', () => {
  it('parses k-suffixed and plain token counts, carries the model forward, and resets per session', () => {
    const turns = parseAiderHistory(SAMPLE);
    expect(turns).toHaveLength(3);
    expect(turns[0]).toMatchObject({ model: 'gpt-5', sent: 12000, received: 1200, messageCostUsd: 0.05, sessionIndex: 1 });
    expect(turns[0]!.ts).toBe(new Date(2026, 8, 1, 10, 22, 33).toISOString());
    expect(turns[1]).toMatchObject({ model: 'gpt-5', sent: 3400, received: 800, messageCostUsd: 0.02, sessionIndex: 1 });
    expect(turns[2]).toMatchObject({ model: 'claude-opus-5', sent: 523, received: 128, messageCostUsd: 0.01, sessionIndex: 2 });
    expect(turns[2]!.ts).toBe(new Date(2026, 8, 2, 9, 0, 0).toISOString());
  });

  it('falls back to the supplied timestamp when no session header precedes a Tokens line, and to unknown model', () => {
    const turns = parseAiderHistory('> Tokens: 100 sent, 50 received. Cost: $0.01 message.\n', '2026-01-01T00:00:00.000Z');
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({ model: 'unknown', sent: 100, received: 50, ts: '2026-01-01T00:00:00.000Z' });
  });

  it('treats a Tokens: line without a session cost as sessionCost-less but still parses message cost', () => {
    const turns = parseAiderHistory('# aider chat started at 2026-01-01 00:00:00\n> Tokens: 1k sent, 1k received. Cost: $0.01 message.\n');
    expect(turns[0]!.messageCostUsd).toBe(0.01);
  });

  it('parses a Tokens: line with no Cost clause at all, matching the research doc\'s literal example verbatim', () => {
    // research/other-sources.md §8 quotes exactly this line, with no "Cost: ..." suffix, as
    // Aider's inline cost text -- e.g. because Aider doesn't know the active model's price.
    const turns = parseAiderHistory('# aider chat started at 2026-01-01 00:00:00\n> Tokens: 38k sent, 1.1k received.\n');
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({ sent: 38000, received: 1100, messageCostUsd: null });
  });
});

describe('turnToEvent', () => {
  it('maps a turn into a normalized event, tagging session id from project + session index', () => {
    const turns = parseAiderHistory(SAMPLE);
    const ev = turnToEvent(turns[0]!, { file: '/x/.aider.chat.history.md', project: 'clai', cwd: '/x' })!;
    expect(ev.provider).toBe('other');
    expect(ev.surface).toBe('cli-agent');
    expect(ev.billing).toBe('api');
    expect(ev.granularity).toBe('message');
    expect(ev.usage).toEqual({ input: 12000, output: 1200, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, requests: 1 });
    expect(ev.cost).toEqual({ computedUsd: 0.05 });
    expect(ev.context.sessionId).toBe('clai#1');
    expect(ev.naturalKey).toEqual(['/x/.aider.chat.history.md', String(turns[0]!.lineIndex), turns[0]!.ts]);
  });

  it('returns null when a turn has no discoverable timestamp at all', () => {
    expect(turnToEvent({ model: 'x', sent: 1, received: 1, messageCostUsd: null, lineIndex: 0, sessionIndex: 0 }, { file: 'f' })).toBeNull();
  });
});

describe('aiderHistoryRoots / findAiderHistoryFiles', () => {
  it('defaults to the home directory and finds files one level deep plus in the root itself', () => {
    const home = mkdtempSync(join(tmpdir(), 'clai-aider-'));
    expect(aiderHistoryRoots({}, home)).toEqual([home]);
    mkdirSync(join(home, 'proj-a'), { recursive: true });
    writeFileSync(join(home, 'proj-a', '.aider.chat.history.md'), SAMPLE);
    writeFileSync(join(home, '.aider.chat.history.md'), SAMPLE);
    const files = findAiderHistoryFiles(aiderHistoryRoots({}, home));
    expect(files).toHaveLength(2);
  });

  it('honors AIDER_HISTORY_ROOTS as a comma-separated list', () => {
    const base = mkdtempSync(join(tmpdir(), 'clai-aider-'));
    const rootA = join(base, 'work');
    const rootB = join(base, 'oss');
    mkdirSync(join(rootA, 'proj'), { recursive: true });
    mkdirSync(rootB, { recursive: true });
    writeFileSync(join(rootA, 'proj', '.aider.chat.history.md'), SAMPLE);
    writeFileSync(join(rootB, '.aider.chat.history.md'), SAMPLE);
    const roots = aiderHistoryRoots({ AIDER_HISTORY_ROOTS: `${rootA}, ${rootB}` }, base);
    expect(roots).toEqual([rootA, rootB]);
    expect(findAiderHistoryFiles(roots)).toHaveLength(2);
  });
});

describe('aider connector scan', () => {
  it('detects and scans project history, dedups unchanged files, and picks up appended sessions on full rescan', async () => {
    const home = mkdtempSync(join(tmpdir(), 'clai-aider-'));
    const proj = join(home, 'clai');
    mkdirSync(proj, { recursive: true });
    writeFileSync(join(proj, '.aider.chat.history.md'), SAMPLE);
    const ctx = ctxFor(home);

    const det = await aiderConnector.detect(ctx);
    expect(det.found).toBe(true);
    expect(det.details?.['files']).toBe(1);

    const first: unknown[] = [];
    for await (const e of aiderConnector.scan(ctx)) first.push(e);
    expect(first).toHaveLength(3);

    const second: unknown[] = [];
    for await (const e of aiderConnector.scan(ctx)) second.push(e);
    expect(second).toHaveLength(0); // unchanged file, skipped

    // append a new session; file changes so it is fully re-read (naturalKey dedups the old turns)
    writeFileSync(join(proj, '.aider.chat.history.md'), SAMPLE + '\n# aider chat started at 2026-09-03 08:00:00\n\n#### hi\n\nhi\n\n> Tokens: 10 sent, 10 received. Cost: $0.001 message.\n');
    const third: { naturalKey?: string[] }[] = [];
    for await (const e of aiderConnector.scan(ctx)) third.push(e);
    expect(third).toHaveLength(4);
  });
});
