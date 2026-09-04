import { createHash } from 'node:crypto';

/** Deterministic 24-hex-char id from natural key parts. */
export function stableId(parts: readonly (string | number | null | undefined)[]): string {
  const h = createHash('sha256');
  h.update(parts.map((p) => (p === undefined || p === null ? '' : String(p))).join(''));
  return h.digest('hex').slice(0, 24);
}

export function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

/** Short, non-reversible fingerprint for emails/paths shown in shared views when privacy mode is on. */
export function fingerprint(s: string): string {
  return sha256(s.trim().toLowerCase()).slice(0, 10);
}
