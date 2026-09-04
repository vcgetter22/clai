/**
 * Provider API connectors register here (Anthropic Admin/Analytics, OpenAI Admin, OpenRouter, Cursor, GitHub Copilot, ...).
 * Each module exports its connector and calls `registerConnector` on import.
 */
import { registerConnector } from '../registry.js';
import { anthropicAdminConnector, anthropicClaudeCodeConnector } from './anthropic-admin.js';
import { cursorAdminConnector } from './cursor-admin.js';
import { githubCopilotConnector } from './github-copilot.js';
import { openaiAdminConnector } from './openai-admin.js';
import { openrouterConnector } from './openrouter.js';

export { anthropicAdminConnector, anthropicClaudeCodeConnector } from './anthropic-admin.js';
export { cursorAdminConnector } from './cursor-admin.js';
export { githubCopilotConnector } from './github-copilot.js';
export { openaiAdminConnector } from './openai-admin.js';
export { openrouterConnector } from './openrouter.js';

export const apiConnectorsList = [anthropicAdminConnector, anthropicClaudeCodeConnector, openaiAdminConnector, openrouterConnector, cursorAdminConnector, githubCopilotConnector];

for (const c of apiConnectorsList) registerConnector(c);
