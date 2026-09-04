/**
 * Stable entity -> categorical-slot color mapping. Slots are the eight validated
 * hues from the dataviz palette (see styles.css `--series-1..8`), always assigned in
 * the SAME fixed order regardless of which entities are present in a given filtered
 * view — so "Anthropic is blue" stays true everywhere it appears (daily chart,
 * breakdown lists, model chart), never repainted by rank or by what a filter hides.
 *
 * Known, product-relevant identities get their own reserved slot; anything else folds
 * into slot 8 ("Other") rather than generating a new hue.
 */

const PROVIDER_ORDER = ['anthropic', 'openai', 'google', 'cursor', 'github', 'xai', 'mistral'];
const MODEL_ORDER = ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5', 'gpt-5-codex', 'gemini-2.5-flash', 'claude-opus-4-1', 'claude-sonnet-4'];

function slotVar(order: string[], key: string): string {
  const idx = order.indexOf(key);
  const slot = idx === -1 ? 8 : idx + 1;
  return `var(--series-${slot})`;
}

export function providerColor(provider: string): string {
  return slotVar(PROVIDER_ORDER, provider);
}

export function modelColor(modelKey: string): string {
  return slotVar(MODEL_ORDER, modelKey);
}

/** The single accent used for "one series, one color" ranked lists (arbitrary categories like project names). */
export const ACCENT = 'var(--series-1)';

export const DEEMPHASIS = 'var(--text-muted)';

export function providerLabel(provider: string): string {
  const known: Record<string, string> = {
    anthropic: 'Anthropic',
    openai: 'OpenAI',
    google: 'Google',
    cursor: 'Cursor',
    github: 'GitHub Copilot',
    xai: 'xAI',
    mistral: 'Mistral',
    deepseek: 'DeepSeek',
    cohere: 'Cohere',
    perplexity: 'Perplexity',
    meta: 'Meta',
    amazon: 'Amazon',
    openrouter: 'OpenRouter',
    microsoft: 'Microsoft',
    other: 'Other',
  };
  return known[provider] ?? provider;
}

export function sourceLabel(source: string): string {
  const known: Record<string, string> = {
    'claude-code': 'Claude Code',
    'codex-cli': 'Codex CLI',
    'gemini-cli': 'Gemini CLI',
    'anthropic-admin': 'Anthropic Admin API',
    'openai-admin': 'OpenAI Admin API',
    'cursor-admin': 'Cursor Admin',
    'github-copilot': 'GitHub Copilot',
    manual: 'Manual entry',
  };
  return known[source] ?? source;
}
