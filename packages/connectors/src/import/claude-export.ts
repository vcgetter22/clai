import { basename } from 'node:path';
import type { RawUsageEvent } from '@claii/core';
import type { ConnectorContext, ImportConnector } from '../types.js';
import { str } from '../util/files.js';
import { readEntryOrFile } from './zip.js';

/**
 * claude.ai data export import: the export zip (Settings -> Privacy -> Export data), or its
 * `conversations.json` already extracted from that zip.
 *
 * Per research/anthropic-sources.md §4.7 ("claude.ai data export") and its "Connector
 * implications" table row: the export is a JSON array of conversations, each with a
 * `chat_messages` array carrying `uuid`, `sender` (`human`/`assistant`), `created_at` and message
 * content -- but the research found **no confirmation of per-message token counts or a model-name
 * field anywhere in the export**. It explicitly says to treat the export as "useless for cost
 * reconstruction" (a content-only export, not a usage export) and warns against building a
 * token-cost estimator on top of it without first verifying the schema against a real export.
 *
 * Unlike chatgpt-export.ts (where a real-tokenizer estimate is the research's own documented
 * recommendation, because OpenAI's export at least names the model per message), this connector
 * does NOT fabricate per-message token/cost numbers. It emits one count-only event per assistant
 * reply -- `usage.requests: 1`, all token fields 0, `cost.confidence: 'estimated'` -- so clai can
 * still show *how many* replies/conversations exist and *when*, without pretending to know tokens
 * or dollars the export doesn't contain. `cost.confidence` is set to `'estimated'` deliberately:
 * `'unknown'` is itself one of core's own `SYNTHETIC_MODELS` sentinels
 * (packages/core/src/pricing/resolve.ts), so even with no `opts.model` override `finalizeEvent`
 * (packages/core/src/events.ts) would otherwise resolve this to a *trustworthy-looking*
 * `computedUsd: 0, confidence: 'computed'` -- indistinguishable from "we priced this and it really
 * is free" -- rather than "we have no idea". Setting `'estimated'` on the raw event makes
 * `finalizeEvent` downgrade that (and the same $0 outcome when a caller overrides with a real
 * priced model, since usage is all zero either way) to `'estimated'`, so it's never reported with
 * unwarranted confidence.
 *
 * `model` is `opts.model` when the caller explicitly declares it (the export has no per-message
 * model field to read), else `'unknown'` -- never a silently-guessed real, priced model.
 *
 * UNVERIFIED (research/anthropic-sources.md §4.7, itself sourced only from WebSearch summaries,
 * not an independently fetched schema): whether `chat_messages` is really a flat, chronologically
 * ordered array, or whether messages actually form a `parent_message_uuid`-linked list. We only
 * ever rely on each message's own `created_at` and `sender`/`uuid` fields (never on array
 * position/order) for exactly this reason, so this connector's output is correct either way.
 * `canImport`/`import` also degrade a missing/malformed field to "skip" rather than throwing.
 *
 * Privacy: message `text`/`content` fields are never read at all (not just "not stored") -- there
 * is nothing here to derive from them, so we don't even parse them out of the JSON.
 */

interface ClaudeMessage {
  uuid?: string;
  sender?: string;
  created_at?: string;
}

interface ClaudeConversation {
  uuid?: string;
  chat_messages?: ClaudeMessage[];
}

/**
 * chars/3.6 heuristic token estimate. Kept exported for API compatibility, but deliberately NOT
 * called from `conversationEvents` below: research/anthropic-sources.md §4.7 explicitly warns
 * against building a token-cost estimator on top of this export, since the export was never
 * confirmed to carry a model name (so there is no reliable tokenizer/model to estimate *for*) and
 * the research found no evidence the character counts would even approximate real usage.
 */
export function estimateClaudeTokens(text: string): number {
  if (!text) return 0;
  return Math.max(0, Math.round(text.length / 3.6));
}

/** Text of a message for length-based estimation only; the text itself is never retained. */
function messageText(msg: ClaudeMessage): string {
  const direct = typeof (msg as { text?: unknown }).text === 'string' ? ((msg as { text?: string }).text ?? '') : '';
  const parts = Array.isArray((msg as { content?: unknown }).content) ? ((msg as { content?: { text?: unknown }[] }).content ?? []) : [];
  const fromParts = parts.map((p) => (typeof p?.text === 'string' ? p.text : '')).join('');
  return direct.length >= fromParts.length ? direct : fromParts;
}

/**
 * Default: one count-only event per assistant reply (the export carries no tokens or model).
 * With `estimate: true` (explicit opt-in from `clai import --estimate`), token counts are derived
 * from text length with the chars/3.6 heuristic and modelled like a chat turn: `input` is the
 * preceding human message, `cacheRead` the earlier history (chat re-sends it, cached), `output`
 * the reply. Every such event carries `cost.confidence: 'estimated'`.
 */
export function* conversationEvents(conv: ClaudeConversation, opts: { model?: string; estimate?: boolean; identity?: ConnectorContext['identity'] }): Generator<RawUsageEvent> {
  const messages = conv.chat_messages ?? [];
  const uuid = conv.uuid ?? 'unknown';
  const model = opts.model ?? (opts.estimate ? 'claude-sonnet-5' : 'unknown');
  let history = 0;
  let lastHuman = 0;
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (!msg) continue;
    const tokens = opts.estimate ? estimateClaudeTokens(messageText(msg)) : 0;
    if (msg.sender !== 'assistant') {
      if (opts.estimate) {
        lastHuman = tokens;
      }
      continue;
    }
    const ts = str(msg.created_at);
    if (!ts) {
      if (opts.estimate) history += lastHuman + tokens;
      continue;
    }
    const msgUuid = msg.uuid ?? String(i);
    const usage = opts.estimate
      ? { input: lastHuman, output: tokens, cacheRead: history, cacheWrite5m: 0, cacheWrite1h: 0, requests: 1 }
      : { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, requests: 1 };
    if (opts.estimate) {
      history += lastHuman + tokens;
      lastHuman = 0;
    }

    yield {
      ts,
      source: 'claude-export',
      provider: 'anthropic',
      model,
      surface: 'chat',
      billing: 'subscription',
      granularity: 'message',
      actor: { email: opts.identity?.email, name: opts.identity?.name },
      context: { tags: { conversation: uuid } },
      usage,
      cost: { confidence: 'estimated' },
      naturalKey: [uuid, msgUuid],
    };
  }
}

export function canImportClaudeExport(path: string, head: string): boolean {
  if (head.includes('"chat_messages"')) return true; // already-extracted conversations.json
  if (head.startsWith('PK')) {
    // Best-effort filename hint: claude.ai and ChatGPT exports both zip a `conversations.json`
    // with no reliable shared magic differentiator, so accept anything not clearly branded for
    // the other product; `import()`'s own chat_messages shape check is the final word.
    const name = basename(path).toLowerCase();
    if (name.includes('chatgpt') || name.includes('openai')) return false;
    return name.endsWith('.zip');
  }
  return false;
}

export const claudeExportConnector: ImportConnector = {
  kind: 'import',
  id: 'claude-export',
  displayName: 'Claude.ai Export',

  canImport: canImportClaudeExport,

  async *import(ctx: ConnectorContext, path: string, opts?: { plan?: string; model?: string; estimate?: boolean }): AsyncGenerator<RawUsageEvent> {
    const buf = readEntryOrFile(path, (n) => n.toLowerCase().endsWith('conversations.json'));
    const data = JSON.parse(buf.toString('utf8')) as unknown;
    const conversations = Array.isArray(data) ? (data as ClaudeConversation[]) : [];
    for (const conv of conversations) {
      for (const ev of conversationEvents(conv, { model: opts?.model, estimate: opts?.estimate, identity: ctx.identity })) {
        yield opts?.plan ? { ...ev, plan: opts.plan } : ev;
      }
    }
  },
};
