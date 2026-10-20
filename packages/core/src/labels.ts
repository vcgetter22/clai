import type { ProviderId, SourceId } from './types.js';

/** Display names for providers, shared by every surface that names one. */
export const PROVIDER_LABELS: Record<ProviderId, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
  xai: 'xAI',
  mistral: 'Mistral',
  deepseek: 'DeepSeek',
  cohere: 'Cohere',
  perplexity: 'Perplexity',
  meta: 'Meta',
  amazon: 'Amazon',
  openrouter: 'OpenRouter',
  cursor: 'Cursor',
  github: 'GitHub Copilot',
  microsoft: 'Microsoft',
  other: 'Other',
};

export function providerLabel(provider: string): string {
  return (PROVIDER_LABELS as Record<string, string>)[provider] ?? provider;
}

/**
 * The provider behind a single-provider source. Multi-provider tools (OpenCode, Cline, Aider,
 * OpenRouter, gateways, CSV) return null: their usage is split by the events' own provider.
 */
const SOURCE_PROVIDERS: Partial<Record<SourceId, ProviderId>> = {
  'claude-code': 'anthropic',
  'claude-cowork': 'anthropic',
  'anthropic-admin': 'anthropic',
  'anthropic-claude-code': 'anthropic',
  'claude-export': 'anthropic',
  'codex-cli': 'openai',
  'openai-admin': 'openai',
  'chatgpt-export': 'openai',
  'gemini-cli': 'google',
  'cursor-admin': 'cursor',
  'github-copilot': 'github',
};

export function sourceProvider(source: string): ProviderId | null {
  return (SOURCE_PROVIDERS as Record<string, ProviderId>)[source] ?? null;
}
