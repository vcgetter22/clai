import { homedir } from 'node:os';
import { join } from 'node:path';

/** clai keeps everything under one directory: `$CLAI_HOME` or `~/.clai`. */
export function claiHome(env: NodeJS.ProcessEnv = process.env): string {
  return env['CLAI_HOME'] && env['CLAI_HOME'].trim() ? env['CLAI_HOME'] : join(homedir(), '.clai');
}

export function defaultDbPath(env: NodeJS.ProcessEnv = process.env): string {
  return env['CLAI_DB'] && env['CLAI_DB'].trim() ? env['CLAI_DB'] : join(claiHome(env), 'clai.db');
}

export function credentialsPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(claiHome(env), 'credentials.json');
}

export function pricingOverridePath(env: NodeJS.ProcessEnv = process.env): string {
  return join(claiHome(env), 'pricing.json');
}
