import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { CATALOG, finalizeEvent } from '@claii/core';
import { canImportClaudeExport, claudeExportConnector, conversationEvents, estimateClaudeTokens } from './claude-export.js';
import { noopLogger, type ConnectorContext } from '../types.js';

function memState() {
  const m = new Map<string, string>();
  return { get: (k: string) => m.get(k), set: (k: string, v: string) => void m.set(k, v) };
}

function ctxFor(): ConnectorContext {
  return { catalog: CATALOG, state: memState(), log: noopLogger, now: () => new Date('2026-09-03T12:00:00Z'), home: '/home/me', env: {}, planFor: () => undefined };
}

/** Minimal single-entry deflated zip, built by hand (mirrors zip.test.ts's approach). */
function buildZip(name: string, data: Buffer): Buffer {
  const nameBuf = Buffer.from(name, 'utf8');
  const compData = deflateRawSync(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 6);
  local.writeUInt16LE(8, 8);
  local.writeUInt16LE(0, 10);
  local.writeUInt16LE(0, 12);
  local.writeUInt32LE(0, 14);
  local.writeUInt32LE(compData.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  local.writeUInt16LE(0, 28);
  const localEntry = Buffer.concat([local, nameBuf, compData]);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt16LE(0, 12);
  central.writeUInt16LE(0, 14);
  central.writeUInt32LE(0, 16);
  central.writeUInt32LE(compData.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt16LE(0, 30);
  central.writeUInt16LE(0, 32);
  central.writeUInt16LE(0, 34);
  central.writeUInt16LE(0, 36);
  central.writeUInt32LE(0, 38);
  central.writeUInt32LE(0, 42);
  const centralEntry = Buffer.concat([central, nameBuf]);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(centralEntry.length, 12);
  eocd.writeUInt32LE(localEntry.length, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([localEntry, centralEntry, eocd]);
}

const CONVERSATION = {
  uuid: 'conv-1',
  chat_messages: [
    { uuid: 'm1', sender: 'human', text: 'hello there', created_at: '2026-09-01T10:00:00.000Z' },
    { uuid: 'm2', sender: 'assistant', text: 'hi! how can I help?', created_at: '2026-09-01T10:00:05.000Z' },
    { uuid: 'm3', sender: 'human', text: 'what is the capital of France?', created_at: '2026-09-01T10:01:00.000Z' },
    { uuid: 'm4', sender: 'assistant', content: [{ type: 'text', text: 'Paris.' }], created_at: '2026-09-01T10:01:05.000Z' },
  ],
};

describe('estimateClaudeTokens', () => {
  it('estimates via a chars/3.6 heuristic (kept exported for API compatibility; not used by conversationEvents -- see its doc comment)', () => {
    expect(estimateClaudeTokens('')).toBe(0);
    expect(estimateClaudeTokens('x'.repeat(36))).toBe(10);
  });
});

describe('conversationEvents', () => {
  it('emits a count-only event per assistant message -- no fabricated tokens, since the export carries none (research/anthropic-sources.md §4.7)', () => {
    const events = [...conversationEvents(CONVERSATION, {})];
    expect(events).toHaveLength(2);
    const [first, second] = events;
    expect(first!.model).toBe('unknown'); // export has no per-message (or any) model field
    expect(first!.usage).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, requests: 1 });
    expect(first!.naturalKey).toEqual(['conv-1', 'm2']);
    expect(first!.cost).toEqual({ confidence: 'estimated' });
    expect(first!.context).toEqual({ tags: { conversation: 'conv-1' } });
    expect(first!.ts).toBe('2026-09-01T10:00:05.000Z');

    expect(second!.usage).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, requests: 1 });
    expect(second!.naturalKey).toEqual(['conv-1', 'm4']);
  });

  it('uses opts.model when the caller explicitly declares it, else "unknown"', () => {
    const [withOverride] = [...conversationEvents(CONVERSATION, { model: 'claude-opus-5' })];
    expect(withOverride!.model).toBe('claude-opus-5');
    const [withoutOverride] = [...conversationEvents(CONVERSATION, {})];
    expect(withoutOverride!.model).toBe('unknown');
  });

  it('never reports an invented dollar figure through finalizeEvent, whether the model is left "unknown" (core\'s own zero-cost synthetic-model sentinel, packages/core/src/pricing/resolve.ts SYNTHETIC_MODELS) or the caller overrides it with a real priced model', () => {
    const [unresolved] = [...conversationEvents(CONVERSATION, {})];
    const a = finalizeEvent(unresolved!, CATALOG);
    expect(a.event.cost).toEqual({ billedUsd: null, computedUsd: 0, currency: 'USD', confidence: 'estimated', pricingVersion: CATALOG.version });

    const [resolved] = [...conversationEvents(CONVERSATION, { model: 'claude-sonnet-5' })];
    const b = finalizeEvent(resolved!, CATALOG);
    expect(b.event.cost.confidence).toBe('estimated'); // downgraded from 'computed' -- never trustworthy
    expect(b.event.cost.computedUsd).toBe(0); // zero known tokens in, zero out -- no fabricated number
  });

  it('skips messages with no created_at and non-assistant senders', () => {
    const events = [...conversationEvents({ uuid: 'c', chat_messages: [{ uuid: 'a', sender: 'assistant' }] }, {})];
    expect(events).toHaveLength(0);
  });
});

describe('canImportClaudeExport', () => {
  it('accepts an extracted conversations.json via JSON head sniff', () => {
    expect(canImportClaudeExport('/x/conversations.json', '{"uuid":"a","chat_messages":[]}')).toBe(true);
  });
  it('accepts a zip unless clearly branded chatgpt/openai', () => {
    expect(canImportClaudeExport('/x/data-export.zip', 'PK\x03\x04')).toBe(true);
    expect(canImportClaudeExport('/x/chatgpt-export.zip', 'PK\x03\x04')).toBe(false);
  });
  it('rejects unrelated JSON', () => {
    expect(canImportClaudeExport('/x/foo.json', '{"mapping":{}}')).toBe(false);
  });
});

describe('claudeExportConnector.import', () => {
  it('reads conversations.json directly (non-zip input)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'clai-claude-export-'));
    const path = join(dir, 'conversations.json');
    writeFileSync(path, JSON.stringify([CONVERSATION]));
    const out: unknown[] = [];
    for await (const e of claudeExportConnector.import(ctxFor(), path)) out.push(e);
    expect(out).toHaveLength(2);
  });

  it('reads conversations.json out of a zip export and defaults the model to "unknown" (no model field in the export)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'clai-claude-export-'));
    const path = join(dir, 'data-export.zip');
    writeFileSync(path, buildZip('conversations.json', Buffer.from(JSON.stringify([CONVERSATION]))));
    const out: { model: string }[] = [];
    for await (const e of claudeExportConnector.import(ctxFor(), path)) out.push(e as never);
    expect(out).toHaveLength(2);
    expect(out[0]!.model).toBe('unknown');
  });

  it('honors an explicit opts.model override', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'clai-claude-export-'));
    const path = join(dir, 'conversations.json');
    writeFileSync(path, JSON.stringify([CONVERSATION]));
    const out: { model: string }[] = [];
    for await (const e of claudeExportConnector.import(ctxFor(), path, { model: 'claude-opus-5' })) out.push(e as never);
    expect(out[0]!.model).toBe('claude-opus-5');
  });
});
