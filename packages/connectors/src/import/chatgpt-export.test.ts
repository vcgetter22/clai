import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { CATALOG, finalizeEvent } from '@claii/core';
import { canImportChatGptExport, chatgptExportConnector, conversationEvents, encodingForModel, estimateChatGptTokens, linearThread, mapModelSlug } from './chatgpt-export.js';
import { noopLogger, type ConnectorContext } from '../types.js';

function memState() {
  const m = new Map<string, string>();
  return { get: (k: string) => m.get(k), set: (k: string, v: string) => void m.set(k, v) };
}

function ctxFor(): ConnectorContext {
  return { catalog: CATALOG, state: memState(), log: noopLogger, now: () => new Date('2026-09-03T12:00:00Z'), home: '/home/me', env: {}, planFor: () => undefined };
}

/** Minimal single-entry deflated zip (mirrors zip.test.ts's approach). */
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
  id: 'conv-1',
  default_model_slug: 'auto',
  current_node: 'n4',
  mapping: {
    root: { id: 'root', message: null, parent: null },
    n1: { id: 'n1', parent: 'root', message: { id: 'msg-1', author: { role: 'user' }, create_time: 1756720000, content: { content_type: 'text', parts: ['hello there'] } } },
    n2: { id: 'n2', parent: 'n1', message: { id: 'msg-2', author: { role: 'assistant' }, create_time: 1756720005, content: { content_type: 'text', parts: ['hi! how can I help?'] }, metadata: { model_slug: 'gpt-4o' } } },
    n3: { id: 'n3', parent: 'n2', message: { id: 'msg-3', author: { role: 'user' }, create_time: 1756720060, content: { content_type: 'text', parts: ['what is the capital of France?'] } } },
    n4: { id: 'n4', parent: 'n3', message: { id: 'msg-4', author: { role: 'assistant' }, create_time: 1756720065, content: { content_type: 'text', parts: ['Paris.'] }, metadata: { model_slug: 'gpt-5-thinking' } } },
  },
};

describe('mapModelSlug', () => {
  it('renames known slugs and passes through recognized-but-unchanged ones', () => {
    expect(mapModelSlug('gpt-4-1')).toBe('gpt-4.1');
    expect(mapModelSlug('gpt-5-thinking')).toBe('gpt-5');
    expect(mapModelSlug('gpt-5-t-mini')).toBe('gpt-5-mini');
    expect(mapModelSlug('auto')).toBe('gpt-5');
    expect(mapModelSlug('text-davinci-002-render-sha')).toBe('gpt-3.5-turbo');
    expect(mapModelSlug('gpt-4o')).toBe('gpt-4o');
    expect(mapModelSlug('gpt-4o-mini')).toBe('gpt-4o-mini');
    expect(mapModelSlug('o3')).toBe('o3');
    expect(mapModelSlug('o4-mini')).toBe('o4-mini');
    expect(mapModelSlug('o1')).toBe('o1');
    expect(mapModelSlug('gpt-4')).toBe('gpt-4');
  });
  it('maps gpt-5-1* and gpt-5-2* prefix families without over-matching gpt-5-10', () => {
    expect(mapModelSlug('gpt-5-1')).toBe('gpt-5.1');
    expect(mapModelSlug('gpt-5-1-mini')).toBe('gpt-5.1');
    expect(mapModelSlug('gpt-5-2-codex')).toBe('gpt-5.2');
    expect(mapModelSlug('gpt-5-10')).toBe('gpt-5-10'); // not a 5.1 variant, passthrough
  });
  it('defaults unknown/missing slugs', () => {
    expect(mapModelSlug(undefined)).toBe('unknown');
    expect(mapModelSlug('some-future-model')).toBe('some-future-model');
  });
});

describe('encodingForModel / estimateChatGptTokens', () => {
  it('picks cl100k_base for legacy families and o200k_base for everything else, per research/openai-sources.md §4.2', () => {
    expect(encodingForModel('gpt-4')).toBe(encodingForModel('gpt-4-turbo'));
    expect(encodingForModel('gpt-3.5-turbo')).toBe(encodingForModel('gpt-4'));
    expect(encodingForModel('text-davinci-002-render-sha')).toBe(encodingForModel('gpt-4'));
    // gpt-4o is NOT the legacy gpt-4 family (no hyphen after "gpt-4") -- must use the newer encoding
    expect(encodingForModel('gpt-4o')).not.toBe(encodingForModel('gpt-4'));
    expect(encodingForModel('gpt-4.1')).not.toBe(encodingForModel('gpt-4'));
    expect(encodingForModel('gpt-5')).not.toBe(encodingForModel('gpt-4'));
    expect(encodingForModel('some-future-model')).toBe(encodingForModel('gpt-5')); // unrecognized defaults to o200k_base
  });

  it('the two encodings actually disagree on token count for the same text (sanity check the fix is real)', () => {
    // Whitespace-heavy code plus non-Latin text is where o200k_base (newer, larger vocab) and
    // cl100k_base (legacy) are known to diverge most -- a plain English sentence can coincidentally
    // tokenize to the same *count* in both even though the underlying token ids differ.
    const text = 'def foo(x,    y):\n\t\treturn x + y  # 合計を計算する\n\n' + '   '.repeat(10) + '日本語のテキストです。';
    expect(estimateChatGptTokens(text, 'gpt-4')).not.toBe(estimateChatGptTokens(text, 'gpt-4o'));
  });

  it('estimateChatGptTokens falls back to 0 for empty text', () => {
    expect(estimateChatGptTokens('', 'gpt-4o')).toBe(0);
  });
});

describe('linearThread', () => {
  it('walks current_node up the parent chain and returns chronological order', () => {
    const chain = linearThread(CONVERSATION);
    expect(chain.map((n) => n.nodeId)).toEqual(['root', 'n1', 'n2', 'n3', 'n4']);
  });
  it('handles a missing/empty mapping gracefully', () => {
    expect(linearThread({})).toEqual([]);
  });
});

describe('conversationEvents', () => {
  it('builds one event per assistant turn with preceding-user input, earlier-messages cacheRead, and mapped models', () => {
    const events = [...conversationEvents(CONVERSATION, {})];
    expect(events).toHaveLength(2);
    const [first, second] = events;
    expect(first!.model).toBe('gpt-4o');
    expect(first!.usage.input).toBe(estimateChatGptTokens('hello there', 'gpt-4o'));
    expect(first!.usage.cacheRead).toBe(0);
    expect(first!.usage.output).toBe(estimateChatGptTokens('hi! how can I help?', 'gpt-4o'));
    expect(first!.naturalKey).toEqual(['conv-1', 'msg-2']);
    expect(first!.cost).toEqual({ confidence: 'estimated' });
    expect(first!.context).toEqual({ tags: { conversation: 'conv-1' } });

    expect(second!.model).toBe('gpt-5'); // gpt-5-thinking -> gpt-5
    expect(second!.usage.input).toBe(estimateChatGptTokens('what is the capital of France?', 'gpt-5'));
    expect(second!.usage.cacheRead).toBe(estimateChatGptTokens('hello there\nhi! how can I help?', 'gpt-5'));
    expect(second!.usage.output).toBe(estimateChatGptTokens('Paris.', 'gpt-5'));
    expect(second!.naturalKey).toEqual(['conv-1', 'msg-4']);
  });

  it('falls back to conversation.default_model_slug when a message has no metadata.model_slug', () => {
    const conv = {
      id: 'c2',
      default_model_slug: 'auto',
      current_node: 'n2',
      mapping: {
        n1: { id: 'n1', parent: null, message: { id: 'm1', author: { role: 'user' }, create_time: 1, content: { content_type: 'text', parts: ['hi'] } } },
        n2: { id: 'n2', parent: 'n1', message: { id: 'm2', author: { role: 'assistant' }, create_time: 2, content: { content_type: 'text', parts: ['hello'] } } },
      },
    };
    const [ev] = [...conversationEvents(conv, {})];
    expect(ev!.model).toBe('gpt-5');
  });

  it('prefers message.metadata.default_model_slug over the conversation-level default when model_slug is absent', () => {
    const conv = {
      id: 'c2b',
      default_model_slug: 'auto', // would map to gpt-5 if used
      current_node: 'n2',
      mapping: {
        n1: { id: 'n1', parent: null, message: { id: 'm1', author: { role: 'user' }, create_time: 1, content: { content_type: 'text', parts: ['hi'] } } },
        n2: {
          id: 'n2',
          parent: 'n1',
          message: { id: 'm2', author: { role: 'assistant' }, create_time: 2, content: { content_type: 'text', parts: ['hello'] }, metadata: { default_model_slug: 'gpt-4o' } },
        },
      },
    };
    const [ev] = [...conversationEvents(conv, {})];
    expect(ev!.model).toBe('gpt-4o');
  });

  it('skips non-text content (tool/image) and turns with no create_time', () => {
    const conv = {
      id: 'c3',
      current_node: 'n2',
      mapping: {
        n1: { id: 'n1', parent: null, message: { id: 'm1', author: { role: 'user' }, create_time: 1, content: { content_type: 'text', parts: ['hi'] } } },
        n2: { id: 'n2', parent: 'n1', message: { id: 'm2', author: { role: 'assistant' }, create_time: null, content: { content_type: 'code', parts: ['print(1)'] } } },
      },
    };
    expect([...conversationEvents(conv, {})]).toHaveLength(0);
  });

  it('sets confidence estimated end to end through finalizeEvent', () => {
    const [ev] = [...conversationEvents(CONVERSATION, {})];
    const { event } = finalizeEvent(ev!, CATALOG);
    expect(event.cost.confidence).toBe('estimated');
  });
});

describe('canImportChatGptExport', () => {
  it('accepts an extracted conversations.json via JSON head sniff', () => {
    expect(canImportChatGptExport('/x/conversations.json', '{"mapping":{}}')).toBe(true);
  });
  it('accepts a zip unless clearly branded claude/anthropic', () => {
    expect(canImportChatGptExport('/x/chatgpt-export.zip', 'PK\x03\x04')).toBe(true);
    expect(canImportChatGptExport('/x/claude-export.zip', 'PK\x03\x04')).toBe(false);
  });
});

describe('chatgptExportConnector.import', () => {
  it('reads conversations.json directly and out of a zip', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'clai-chatgpt-export-'));
    const jsonPath = join(dir, 'conversations.json');
    writeFileSync(jsonPath, JSON.stringify([CONVERSATION]));
    const fromJson: unknown[] = [];
    for await (const e of chatgptExportConnector.import(ctxFor(), jsonPath)) fromJson.push(e);
    expect(fromJson).toHaveLength(2);

    const zipPath = join(dir, 'export.zip');
    writeFileSync(zipPath, buildZip('conversations.json', Buffer.from(JSON.stringify([CONVERSATION]))));
    const fromZip: unknown[] = [];
    for await (const e of chatgptExportConnector.import(ctxFor(), zipPath)) fromZip.push(e);
    expect(fromZip).toHaveLength(2);
  });
});
