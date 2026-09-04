import pc from 'picocolors';
import { formatTokens, formatUsd, pct } from '@claii/core';

export { formatTokens, formatUsd, pct };

export type Align = 'l' | 'r';

/** Render a compact terminal table. Strips ANSI when measuring widths. */
export function table(header: string[], rows: (string | number)[][], align?: Align[]): string {
  const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');
  const cells = rows.map((r) => r.map((c) => (typeof c === 'number' ? String(c) : c)));
  const widths = header.map((h, i) => Math.max(strip(h).length, ...cells.map((r) => strip(r[i] ?? '').length)));
  const pad = (s: string, w: number, a: Align) => {
    const len = strip(s).length;
    const fill = ' '.repeat(Math.max(0, w - len));
    return a === 'r' ? fill + s : s + fill;
  };
  const al = (i: number) => align?.[i] ?? 'l';
  const line = (r: string[]) => '  ' + r.map((c, i) => pad(c, widths[i]!, al(i))).join('   ');
  const out = [pc.bold(line(header)), pc.dim('  ' + widths.map((w) => '-'.repeat(w)).join('   '))];
  for (const r of cells) out.push(line(r));
  return out.join('\n');
}

export function heading(s: string): string {
  return pc.bold(pc.cyan(s));
}

export function kv(pairs: [string, string][]): string {
  const w = Math.max(...pairs.map(([k]) => k.length));
  return pairs.map(([k, v]) => `  ${pc.dim(k.padEnd(w))}  ${v}`).join('\n');
}

export function ok(s: string): string {
  return pc.green('✓ ') + s;
}
export function warn(s: string): string {
  return pc.yellow('! ') + s;
}
export function fail(s: string): string {
  return pc.red('✗ ') + s;
}
export function dim(s: string): string {
  return pc.dim(s);
}
export function bold(s: string): string {
  return pc.bold(s);
}

export function bar(share: number, width = 20): string {
  const n = Math.round(Math.max(0, Math.min(1, share)) * width);
  return pc.cyan('█'.repeat(n)) + pc.dim('░'.repeat(width - n));
}

export function printJson(v: unknown): void {
  process.stdout.write(JSON.stringify(v, null, 2) + '\n');
}

export function severityGlyph(s: string): string {
  switch (s) {
    case 'critical':
      return pc.red('●');
    case 'warning':
      return pc.yellow('●');
    case 'opportunity':
      return pc.green('●');
    default:
      return pc.blue('●');
  }
}

export function durationHuman(ms: number): string {
  if (ms < 60e3) return `${Math.round(ms / 1000)}s`;
  if (ms < 3600e3) return `${Math.round(ms / 60e3)}m`;
  return `${(ms / 3600e3).toFixed(1)}h`;
}
