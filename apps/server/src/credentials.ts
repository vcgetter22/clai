import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { credentialsPath } from '@claii/store';
import type { ApiConnector } from '@claii/connectors';

export type CredentialsFile = Record<string, Record<string, string>>;

/** Credentials live in `$CLAI_HOME/credentials.json` (mode 0600), never in the database. */
export function readCredentialsFile(env: NodeJS.ProcessEnv = process.env): CredentialsFile {
  const p = credentialsPath(env);
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as CredentialsFile;
  } catch {
    return {};
  }
}

export function writeCredentials(id: string, creds: Record<string, string>, env: NodeJS.ProcessEnv = process.env): void {
  const p = credentialsPath(env);
  mkdirSync(dirname(p), { recursive: true, mode: 0o700 });
  const all = readCredentialsFile(env);
  all[id] = { ...(all[id] ?? {}), ...creds };
  writeFileSync(p, JSON.stringify(all, null, 2), { mode: 0o600 });
  try {
    chmodSync(p, 0o600);
  } catch {
    /* windows */
  }
}

export function deleteCredentials(id: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const p = credentialsPath(env);
  const all = readCredentialsFile(env);
  if (!all[id]) return false;
  delete all[id];
  writeFileSync(p, JSON.stringify(all, null, 2), { mode: 0o600 });
  return true;
}

/** Resolve credentials for a connector from the file, then environment variables. */
export function resolveCredentials(connector: ApiConnector, env: NodeJS.ProcessEnv = process.env): { creds: Record<string, string>; missing: string[]; source: 'file' | 'env' | 'mixed' | 'none' } {
  const file = readCredentialsFile(env)[connector.id] ?? {};
  const creds: Record<string, string> = {};
  const missing: string[] = [];
  let fromFile = 0;
  let fromEnv = 0;
  for (const spec of connector.credentials) {
    const v = file[spec.key] ?? (spec.envVar ? env[spec.envVar] : undefined);
    if (v) {
      creds[spec.key] = v;
      if (file[spec.key]) fromFile++;
      else fromEnv++;
    } else if (!spec.optional && !spec.help?.toLowerCase().includes('optional') && !spec.label.toLowerCase().includes('optional')) {
      missing.push(spec.key);
    }
  }
  const source = fromFile && fromEnv ? 'mixed' : fromFile ? 'file' : fromEnv ? 'env' : 'none';
  return { creds, missing, source };
}

export function maskSecret(v: string): string {
  if (v.length <= 8) return '****';
  return `${v.slice(0, 6)}...${v.slice(-4)}`;
}
