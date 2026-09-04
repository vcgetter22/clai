/**
 * One color per provider, held constant everywhere it appears (daily chart, ledgers, model
 * rows). Models take their provider's color, so "Anthropic is ledger green" stays true for
 * Opus and Sonnet alike; anything unknown falls back to muted rather than a new hue.
 */

const PROVIDER_VARS: Record<string, string> = {
  anthropic: '--series-anthropic',
  openai: '--series-openai',
  google: '--series-google',
  cursor: '--series-cursor',
  github: '--series-github',
  xai: '--series-xai',
  mistral: '--series-mistral',
};

/** Providers the overview always lists, with "no source" when nothing has been connected. */
export const KNOWN_PROVIDERS = ['anthropic', 'openai', 'google', 'cursor', 'github'];

export function providerColor(provider: string): string {
  const v = PROVIDER_VARS[provider];
  return v ? `var(${v})` : 'var(--muted)';
}

export function modelProvider(modelKey: string): string {
  const k = modelKey.toLowerCase();
  if (k.startsWith('claude')) return 'anthropic';
  if (/^(gpt|o[1-9]|codex|chatgpt|text-embedding|davinci)/.test(k)) return 'openai';
  if (k.startsWith('gemini') || k.startsWith('models/')) return 'google';
  if (k.includes('cursor')) return 'cursor';
  if (k.includes('copilot')) return 'github';
  if (k.startsWith('grok')) return 'xai';
  if (/^(mistral|mixtral|codestral|ministral|magistral|devstral)/.test(k)) return 'mistral';
  return 'other';
}

export function modelColor(modelKey: string): string {
  return providerColor(modelProvider(modelKey));
}

/** The single accent used for "one series, one color" ranked lists (arbitrary categories like project names). */
export const ACCENT = 'var(--accent)';

export const DEEMPHASIS = 'var(--muted)';

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
