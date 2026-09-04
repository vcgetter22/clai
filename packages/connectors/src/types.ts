import type { PricingCatalog, RawUsageEvent, SourceId } from '@claii/core';

export interface StateStore {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
}

export interface Logger {
  debug(msg: string): void;
  info(msg: string): void;
  warn(msg: string): void;
}

export interface ConnectorContext {
  catalog: PricingCatalog;
  /** Per-source persistent state (file offsets, last pull cursors). */
  state: StateStore;
  log: Logger;
  now: () => Date;
  home: string;
  env: NodeJS.ProcessEnv;
  /** Declared subscription plan for a provider, used to label local-agent usage (e.g. `max_20x`). */
  planFor: (provider: string) => string | undefined;
  /** Optional identity attached to locally collected events (team mode). */
  identity?: { email?: string; name?: string; device?: string };
  fetch?: typeof fetch;
}

export interface ScanOptions {
  /** Only emit events at or after this ISO timestamp. */
  since?: string | null;
  /** Ignore saved offsets and re-read everything. */
  full?: boolean;
}

export interface Detection {
  found: boolean;
  /** Human-readable summary, e.g. "233 transcripts in ~/.claude/projects". */
  summary: string;
  paths: string[];
  details?: Record<string, unknown>;
}

export interface LocalConnector {
  kind: 'local';
  id: SourceId;
  displayName: string;
  detect(ctx: ConnectorContext): Promise<Detection>;
  scan(ctx: ConnectorContext, opts?: ScanOptions): AsyncGenerator<RawUsageEvent>;
}

export interface CredentialSpec {
  key: string;
  label: string;
  secret: boolean;
  envVar?: string;
  help?: string;
  /** Not required for the connector to work (e.g. an alternative key type or an org-level scope). */
  optional?: boolean;
}

export interface PullOptions {
  since?: string | null;
  until?: string | null;
  full?: boolean;
}

export interface ApiConnector {
  kind: 'api';
  id: SourceId;
  displayName: string;
  credentials: CredentialSpec[];
  /** Validate credentials cheaply (one request). */
  verify(ctx: ConnectorContext, creds: Record<string, string>): Promise<{ ok: boolean; message: string }>;
  pull(ctx: ConnectorContext, creds: Record<string, string>, opts?: PullOptions): AsyncGenerator<RawUsageEvent>;
}

export interface ImportConnector {
  kind: 'import';
  id: SourceId;
  displayName: string;
  /** Quick sniff on the file name / first bytes. */
  canImport(path: string, head: string): boolean;
  import(ctx: ConnectorContext, path: string, opts?: ImportOptions): AsyncGenerator<RawUsageEvent>;
}

export interface ImportOptions {
  /** Plan key to attribute the usage to (e.g. `pro`, `plus`). */
  plan?: string;
  /** Model to assume when the export does not record one. */
  model?: string;
  /** Estimate token counts from text length when the export carries none (explicit opt-in). */
  estimate?: boolean;
}

export type Connector = LocalConnector | ApiConnector | ImportConnector;

export const noopLogger: Logger = { debug: () => {}, info: () => {}, warn: () => {} };
