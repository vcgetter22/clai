#!/usr/bin/env node
// Converts research/pricing-catalog.draft.json (researcher schema) into the clai catalog shape
// and writes packages/core/src/pricing/catalog.research.json, which catalog.ts merges on top of the seed.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const src = process.argv[2] ?? join(root, 'research', 'pricing-catalog.draft.json');
const out = join(root, 'packages', 'core', 'src', 'pricing', 'catalog.research.json');
const draft = JSON.parse(readFileSync(src, 'utf8'));

const cleanAliases = (m) => [...new Set((m.aliases ?? []).filter((a) => typeof a === 'string' && a.trim() && !/[\s()]/.test(a) && a !== m.id))];

function tierOf(m) {
  const id = m.id.toLowerCase();
  const fam = String(m.family ?? '').toLowerCase();
  if (fam.includes('embed') || id.includes('embed')) return 'embedding';
  if (/(whisper|tts|transcribe|realtime|image|sora|davinci-002|babbage|instruct|vault)/.test(id)) return 'other';
  if (/(haiku|nano|flash-lite|-mini|mini$|micro|lite|small|ministral|command-r$|command-r7b|sonar$|grok-code|4\.1-fast|4-fast|build-)/.test(id)) return id.includes('mini') && /o[1-9]-mini|gpt-5.*mini/.test(id) ? 'mid' : 'small';
  if (/(opus|fable|mythos|pro$|-pro-|pro-preview|o1$|o3$|o3-pro|sol|terra|gpt-5\.6|gpt-5\.5$|gpt-5\.4$|gpt-5$|gpt-5\.1$|gpt-5\.2$|gpt-5\.3|codex$|grok-4\.6|grok-4\.5|grok-4$|large|command-a|premier|deep-research|maverick)/.test(id)) return 'frontier';
  return 'mid';
}

const models = draft.models.map((m) => {
  const lc = m.long_context && typeof m.long_context.threshold_input_tokens === 'number' ? {
    threshold: m.long_context.threshold_input_tokens,
    input: m.long_context.input,
    output: m.long_context.output,
    cacheRead: m.long_context.cache_read ?? null,
    cacheWrite5m: m.long_context.cache_write_5m ?? null,
    cacheWrite1h: m.long_context.cache_write_1h ?? null,
  } : null;
  const cacheRead = m.cache_read ?? m.cached_input ?? null;
  return {
    provider: m.provider,
    id: m.id,
    aliases: cleanAliases(m),
    displayName: m.display_name ?? m.id,
    family: m.family ?? m.id,
    tier: tierOf(m),
    input: Number(m.input ?? 0),
    output: Number(m.output ?? 0),
    cacheRead,
    cacheWrite5m: m.cache_write_5m ?? null,
    cacheWrite1h: m.cache_write_1h ?? null,
    batchMultiplier: m.batch_multiplier ?? null,
    longContext: lc,
    contextWindow: m.context_window ?? null,
    maxOutput: m.max_output ?? null,
    released: m.released ?? null,
    deprecated: m.deprecated ?? null,
    retired: m.retired ?? null,
    verified: m.verified === true,
    source: m.source ?? undefined,
    note: [m.note, m.long_context && m.long_context.threshold_input_tokens == null ? 'Long-context tier exists but its threshold was not published; priced at the base tier.' : null].filter(Boolean).join(' ') || undefined,
  };
});

const unitMap = { per_1000_requests: 'per_1000_requests', per_1000_calls: 'per_1000_calls', per_container_hour: 'per_container_hour' };
const nonToken = [];
for (const n of draft.non_token_prices ?? []) {
  if (n.provider === 'anthropic' && n.item === 'web_search') nonToken.push({ provider: 'anthropic', item: 'web_search', unit: 'per_1000_requests', price: n.price, source: n.source });
  if (n.provider === 'anthropic' && n.item === 'code_execution') nonToken.push({ provider: 'anthropic', item: 'code_execution', unit: 'per_container_hour', price: n.price, source: n.source });
  if (n.provider === 'openai' && n.item === 'web_search_reasoning_models') nonToken.push({ provider: 'openai', item: 'web_search', unit: 'per_1000_calls', price: n.price, source: n.source });
  if (n.provider === 'openai' && n.item === 'file_search_tool_call') nonToken.push({ provider: 'openai', item: 'file_search', unit: 'per_1000_calls', price: n.price, source: n.source });
  if (n.provider === 'google' && n.item === 'grounding_search_gemini2.5') nonToken.push({ provider: 'google', item: 'web_search', unit: 'per_1000_requests', price: n.price, source: n.source });
}
void unitMap;

const rules = {};
if (draft.rules?.google) rules.google = { cacheReadMultiplier: draft.rules.google.context_cache_read_multiplier ?? 0.1, batchDiscount: draft.rules.google.batch_discount ?? 0.5, notes: 'Cache reads are 10% of input on every Gemini model checked (2026-09). Storage billed per token-hour separately.' };
if (draft.rules?.xai) rules.xai = { cacheReadMultiplier: 0.25, notes: 'Uniform 2x input and 2x output above 200K tokens on current models.' };
if (draft.rules?.deepseek) rules.deepseek = { cacheReadMultiplier: 0.1, notes: 'Off-peak prices; peak window (01:00-04:00 and 06:00-10:00 UTC, Mon-Fri) is 2x.' };

const result = { version: draft.version, generatedAt: draft.generated_at, models, nonToken, subscriptions: [], rules };
writeFileSync(out, JSON.stringify(result, null, 1) + '\n');
const byProv = {};
for (const m of models) byProv[m.provider] = (byProv[m.provider] || 0) + 1;
console.log(`wrote ${out}: ${models.length} models`, byProv, `${models.filter((m) => m.verified).length} verified`);
