/**
 * Data-export import connectors register here (claude.ai export, ChatGPT export, CSV, ...).
 * Each module exports its connector and calls `registerConnector` on import.
 */
import { registerConnector } from '../registry.js';
import { chatgptExportConnector } from './chatgpt-export.js';
import { claudeExportConnector } from './claude-export.js';

registerConnector(claudeExportConnector);
registerConnector(chatgptExportConnector);

export { claudeExportConnector } from './claude-export.js';
export { chatgptExportConnector } from './chatgpt-export.js';
export * from './zip.js';
