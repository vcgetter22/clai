/**
 * Additional local-log connectors register here (Gemini CLI, OpenCode, Cline/Roo, Aider, ...).
 * Each module exports its connector and calls `registerConnector` on import.
 */
import { registerConnector } from '../registry.js';
import { aiderConnector } from './aider.js';
import { clineConnector } from './cline.js';
import { geminiCliConnector } from './gemini-cli.js';
import { opencodeConnector } from './opencode.js';

registerConnector(geminiCliConnector);
registerConnector(opencodeConnector);
registerConnector(clineConnector);
registerConnector(aiderConnector);

export { aiderConnector } from './aider.js';
export { clineConnector } from './cline.js';
export { geminiCliConnector } from './gemini-cli.js';
export { opencodeConnector } from './opencode.js';
