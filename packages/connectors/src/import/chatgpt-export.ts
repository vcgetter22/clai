import { basename } from 'node:path';
import { countTokens as countTokensO200k } from 'gpt-tokenizer/encoding/o200k_base';
import { countTokens as countTokensCl100k } from 'gpt-tokenizer/encoding/cl100k_base';
import type { RawUsageEvent } from '@claii/core';
import type { ConnectorContext, ImportConnector } from '../types.js';
import { readEntryOrFile } from './zip.js';

/**
 * ChatGPT data export import (research/openai-sources.md §4 "ChatGPT Data Export"): the export
 * zip (Settings -> Data controls -> Export), or its `conversations.json` already extracted from
 * that zip.
 *
 * Each conversation is a `mapping` of node id -> {message, parent, children}; we walk from
 * `current_node` up the `parent` chain to `mapping` root and reverse it to get the linear thread
 * actually shown to the user (branches/regenerations off that path are not counted) -- this schema
 * has been stable for years per the research, confirmed field-for-field against its quoted
 * `conversations.json` example. Unlike claude-export (whose research finding is that the export
 * carries literally no token/model data and should not have numbers fabricated on top of it), the
 * research's own recommendation here is to estimate via `tiktoken`, so usage is a tokenizer-based
 * estimate (`cost.confidence: 'estimated'`) using `gpt-tokenizer` (the JS equivalent) — a genuine
 * tokenizer, but still an estimate of what the *original* request looked like, not what OpenAI
 * actually billed: hidden/full reasoning traces for thinking models are NOT reconstructable from
 * the `thoughts` content type (a user-facing summary, not the raw billed reasoning tokens), so
 * estimates systematically undercount reasoning-heavy conversations (research's explicit caveat).
 * Mirroring claude-export's chat-caching model: `input` = the immediately preceding user message,
 * `cacheRead` = every earlier message in the thread, `output` = the assistant message itself.
 *
 * Encoding: the research documents two distinct tiktoken encodings by model family --
 * `o200k_base` for gpt-4o/gpt-4.1/gpt-5/o1/o3/o4 families, `cl100k_base` for legacy
 * gpt-4/gpt-4-turbo/gpt-3.5-turbo/text-davinci-variants and text-embedding-ada-002 -- with
 * unrecognized/future slugs defaulting to `o200k_base` (OpenAI's modern default). `encodingForModel` implements that
 * lookup; every historical conversation in a long-lived account can span both eras, so picking one
 * encoding globally (as opposed to per-turn, keyed off that turn's own resolved model) would
 * silently mis-estimate every legacy-model message.
 *
 * Model id comes from `message.metadata.model_slug ?? message.metadata.default_model_slug ??
 * conversation.default_model_slug` (all three appear in the research's quoted per-message example),
 * passed through `mapModelSlug` to canonicalize ChatGPT's internal slugs to clai's catalog ids.
 *
 * UNVERIFIED: exact export schema (field names match the shape documented for ChatGPT's data
 * export as of this writing) and the slug map's coverage of every historical `model_slug` value —
 * coded defensively so an unrecognized slug passes through unchanged (still recorded, just
 * possibly unpriced by the catalog) rather than being dropped, and a malformed/missing `mapping`
 * yields zero events for that conversation instead of throwing. The research also flags it
 * couldn't confirm whether the GPT-4.1 slug is literally `gpt-4-1` or `gpt-4.1` in real exports;
 * `mapModelSlug` handles both by construction (see its inline comment).
 */

interface ChatGptContent {
  content_type?: string;
  parts?: unknown[];
  text?: string;
}

interface ChatGptMessage {
  id?: string;
  author?: { role?: string };
  create_time?: number | null;
  content?: ChatGptContent;
  metadata?: { model_slug?: string; default_model_slug?: string };
}

interface ChatGptNode {
  id?: string;
  message?: ChatGptMessage | null;
  parent?: string | null;
}

interface ChatGptConversation {
  id?: string;
  conversation_id?: string;
  mapping?: Record<string, ChatGptNode>;
  current_node?: string;
  default_model_slug?: string;
}

const TEXT_CONTENT_TYPES = new Set(['text', 'multimodal_text']);

function nodeText(msg: ChatGptMessage | null | undefined): string {
  if (!msg?.content) return '';
  const ct = msg.content.content_type;
  if (ct !== undefined && !TEXT_CONTENT_TYPES.has(ct)) return ''; // skip images/code-exec/tool payloads etc.
  const parts = msg.content.parts;
  if (!Array.isArray(parts)) return typeof msg.content.text === 'string' ? msg.content.text : '';
  return parts.filter((p): p is string => typeof p === 'string').join('\n');
}

/**
 * cl100k_base covers the pre-o200k model families named in research/openai-sources.md §4.2: bare
 * `gpt-4` and its `gpt-4-*` variants (turbo/plugins/browsing/snapshots -- but NOT `gpt-4o*`, which
 * has no hyphen after `gpt-4` and belongs to the newer o200k family), `gpt-3.5*`, legacy
 * `text-davinci*`, and `text-embedding-ada-002`. Everything else (gpt-4o, gpt-4.1, gpt-5 family,
 * o1/o3/o4, and any unrecognized/future slug) uses o200k_base, the documented default.
 */
export function encodingForModel(model: string): (text: string) => number {
  const m = model.toLowerCase();
  const isCl100k = m === 'gpt-4' || m.startsWith('gpt-4-') || m.startsWith('gpt-3.5') || m.startsWith('text-davinci') || m === 'text-embedding-ada-002';
  return isCl100k ? countTokensCl100k : countTokensO200k;
}

/** Token count via the encoding appropriate for `model` (falls back to 0 for empty text). */
export function estimateChatGptTokens(text: string, model: string): number {
  return text ? encodingForModel(model)(text) : 0;
}

const SLUG_EXACT: Record<string, string> = {
  // UNVERIFIED (research/openai-sources.md §4.2) whether the real slug is `gpt-4-1` or `gpt-4.1` --
  // handled either way: if it's `gpt-4-1` this maps it to `gpt-4.1`; if it's already `gpt-4.1` it
  // isn't in this table and falls through to `return slug` unchanged, landing on the same id.
  'gpt-4-1': 'gpt-4.1',
  'gpt-5-thinking': 'gpt-5', // thinking mode isn't a separately priced catalog SKU, just more output tokens
  'gpt-5-t-mini': 'gpt-5-mini', // "-mini" tier -> mini pricing, not flagship (best-effort: not in the research's observed slug list)
  auto: 'gpt-5',
  'text-davinci-002-render-sha': 'gpt-3.5-turbo',
};

/** Canonicalize a ChatGPT internal model slug to a clai catalog id; unrecognized slugs pass through unchanged. */
export function mapModelSlug(slug: string | undefined): string {
  if (!slug) return 'unknown';
  const s = slug.trim().toLowerCase();
  const exact = SLUG_EXACT[s];
  if (exact) return exact;
  if (/^gpt-5-1(\D|$)/.test(s)) return 'gpt-5.1';
  if (/^gpt-5-2(\D|$)/.test(s)) return 'gpt-5.2';
  return slug; // gpt-4o, gpt-4o-mini, gpt-5, o3, o4-mini, o1, gpt-4, or an unrecognized future slug
}

/** Walk `current_node` up the parent chain to the mapping root, then reverse to chronological order. */
export function linearThread(conv: ChatGptConversation): { nodeId: string; node: ChatGptNode }[] {
  const mapping = conv.mapping ?? {};
  const chain: { nodeId: string; node: ChatGptNode }[] = [];
  const seen = new Set<string>();
  let cur = conv.current_node ?? undefined;
  while (cur) {
    const node = mapping[cur];
    if (!node || seen.has(cur)) break;
    seen.add(cur);
    chain.push({ nodeId: cur, node });
    cur = node.parent ?? undefined;
  }
  chain.reverse();
  return chain;
}

export function* conversationEvents(conv: ChatGptConversation, opts: { identity?: ConnectorContext['identity'] }): Generator<RawUsageEvent> {
  const chain = linearThread(conv).filter((n) => n.node.message);
  const convId = conv.conversation_id ?? conv.id ?? 'unknown';

  for (let i = 0; i < chain.length; i++) {
    const entry = chain[i];
    const msg = entry?.node.message;
    if (!msg || msg.author?.role !== 'assistant') continue;
    const text = nodeText(msg);
    if (!text) continue; // tool calls / non-text content / empty turns
    const createTime = msg.create_time;
    if (typeof createTime !== 'number') continue;
    const ts = new Date(createTime * 1000).toISOString();
    // Per-message model_slug, then per-message default_model_slug (both appear in the research's
    // quoted message.metadata example), then the conversation-level default_model_slug.
    const model = mapModelSlug(msg.metadata?.model_slug ?? msg.metadata?.default_model_slug ?? conv.default_model_slug);

    let userIdx = -1;
    for (let j = i - 1; j >= 0; j--) {
      if (chain[j]?.node.message?.author?.role === 'user') {
        userIdx = j;
        break;
      }
    }
    const precedingUser = userIdx >= 0 ? nodeText(chain[userIdx]?.node.message) : '';
    const earlier = userIdx > 0 ? chain.slice(0, userIdx).map((n) => nodeText(n.node.message)).join('\n') : '';
    const msgId = msg.id ?? entry?.nodeId ?? String(i);

    yield {
      ts,
      source: 'chatgpt-export',
      provider: 'openai',
      model,
      surface: 'chat',
      billing: 'subscription',
      granularity: 'message',
      actor: { email: opts.identity?.email, name: opts.identity?.name },
      context: { tags: { conversation: convId } },
      usage: {
        input: estimateChatGptTokens(precedingUser, model),
        output: estimateChatGptTokens(text, model),
        cacheRead: estimateChatGptTokens(earlier, model),
        cacheWrite5m: 0,
        cacheWrite1h: 0,
        requests: 1,
      },
      cost: { confidence: 'estimated' },
      naturalKey: [convId, msgId],
    };
  }
}

export function canImportChatGptExport(path: string, head: string): boolean {
  if (head.includes('"mapping"')) return true; // already-extracted conversations.json
  if (head.startsWith('PK')) {
    const name = basename(path).toLowerCase();
    if (name.includes('claude') || name.includes('anthropic')) return false;
    return name.endsWith('.zip');
  }
  return false;
}

export const chatgptExportConnector: ImportConnector = {
  kind: 'import',
  id: 'chatgpt-export',
  displayName: 'ChatGPT Export',

  canImport: canImportChatGptExport,

  async *import(ctx: ConnectorContext, path: string): AsyncGenerator<RawUsageEvent> {
    const buf = readEntryOrFile(path, (n) => n.toLowerCase().endsWith('conversations.json'));
    const data = JSON.parse(buf.toString('utf8')) as unknown;
    const conversations = Array.isArray(data) ? (data as ChatGptConversation[]) : [];
    for (const conv of conversations) {
      yield* conversationEvents(conv, { identity: ctx.identity });
    }
  },
};
