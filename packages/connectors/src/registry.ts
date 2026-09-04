import type { SourceId } from '@claii/core';
import { claudeCodeConnector } from './local/claude-code.js';
import { codexCliConnector } from './local/codex-cli.js';
import type { ApiConnector, Connector, ImportConnector, LocalConnector } from './types.js';

/**
 * Connector registry. Local connectors are auto-detected by `clai scan`; API connectors are
 * configured with `clai connect <id>`; import connectors handle `clai import <file>`.
 *
 * Additional connectors register themselves by pushing into these arrays from their modules
 * (see `local/index.ts`, `api/index.ts`, `import/index.ts`).
 */
export const localConnectors: LocalConnector[] = [claudeCodeConnector, codexCliConnector];
export const apiConnectors: ApiConnector[] = [];
export const importConnectors: ImportConnector[] = [];

export function registerConnector(c: Connector): void {
  const list: Connector[] = c.kind === 'local' ? localConnectors : c.kind === 'api' ? apiConnectors : importConnectors;
  if (!list.some((x) => x.id === c.id)) list.push(c as never);
}

export function allConnectors(): Connector[] {
  return [...localConnectors, ...apiConnectors, ...importConnectors];
}

export function findConnector(id: string): Connector | undefined {
  return allConnectors().find((c) => c.id === (id as SourceId));
}
