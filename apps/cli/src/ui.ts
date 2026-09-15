import pc from 'picocolors';
import { formatTokens, formatUsd, pct } from '@claii/core';

export { formatTokens, formatUsd, pct };

/**
 * Terminal style layer. Palette per docs/design-principles.md rule 2: one accent (ledger green,
 * spent on headings, bars and the ok glyph), amber for warnings, red for critical, dim for
 * everything secondary. No other colors. picocolors honours NO_COLOR / FORCE_COLOR and non-TTY
 * output by itself; `progress()` additionally switches itself off when stderr is not a terminal.
 */
export const accent = pc.green;
const amber = pc.yellow;
const red = pc.red;

export type Align = 'l' | 'r';

const ANSI = /\x1b\[[0-9;]*m/g;

export function stripAnsi(s: string): string {
  return s.replace(ANSI, '');
}

/** Visible width (ANSI stripped). Box-drawing and braille glyphs used here are all width 1. */
export function width(s: string): number {
  return stripAnsi(s).length;
}

export function termWidth(): number {
  const cols = process.stdout.columns;
  return cols && cols > 0 ? cols : 100;
}

function pad(s: string, w: number, a: Align): string {
  const fill = ' '.repeat(Math.max(0, w - width(s)));
  return a === 'r' ? fill + s : s + fill;
}

/** Compact table: bold header, thin rule, right-aligned numeric columns via `align`. */
export function table(header: string[], rows: (string | number)[][], align?: Align[]): string {
  const cells = rows.map((r) => r.map((c) => (typeof c === 'number' ? String(c) : c)));
  const widths = header.map((h, i) => Math.max(width(h), ...cells.map((r) => width(r[i] ?? ''))));
  const al = (i: number) => align?.[i] ?? 'l';
  const line = (r: string[]) => '  ' + r.map((c, i) => pad(c, widths[i]!, al(i))).join('   ');
  const out = [pc.bold(line(header)), pc.dim('  ' + widths.map((w) => '─'.repeat(w)).join('   '))];
  for (const r of cells) out.push(line(r));
  return out.join('\n');
}

const RULE_WIDTH = () => Math.min(termWidth(), 72);

/** Command title: accent, a thin rule to the right, optional dim meta (range, time zone, elapsed). */
export function heading(title: string, meta?: string): string {
  const tail = meta ? ' ' + pc.dim(meta) : '';
  const n = Math.max(3, RULE_WIDTH() - width(title) - (meta ? width(meta) + 1 : 0) - 1);
  return pc.bold(accent(title)) + ' ' + pc.dim('─'.repeat(n)) + tail;
}

/** Sub-section title inside a command: bold, with a short rule. */
export function section(title: string): string {
  return pc.bold(title) + ' ' + pc.dim('─'.repeat(Math.max(3, 40 - width(title) - 1)));
}

/**
 * One colour per provider, held constant across `report` views (design rule 5), mirroring the
 * dashboard's series palette (apps/dashboard/src/colors.ts): Anthropic is the ledger green,
 * OpenAI blue, Google amber, Cursor magenta, GitHub grey, Mistral cyan; everything else muted.
 */
export type Paint = (s: string) => string;
const PROVIDER_PAINT: Record<string, Paint> = {
  anthropic: pc.green,
  openai: pc.blue,
  google: pc.yellow,
  cursor: pc.magenta,
  github: pc.gray,
  mistral: pc.cyan,
};

export function providerPaint(provider: string): Paint {
  return PROVIDER_PAINT[provider] ?? pc.dim;
}

/** Provider for a provider id, a source id or a model key (same inference as the dashboard). */
export function providerOf(key: string): string {
  const k = key.toLowerCase();
  if (k in PROVIDER_PAINT || k === 'xai' || k === 'other') return k;
  if (k.startsWith('claude') || k === 'anthropic-admin' || k === 'claude-export') return 'anthropic';
  if (/^(gpt|o[1-9]|codex|chatgpt|text-embedding|davinci|openai)/.test(k)) return 'openai';
  if (k.startsWith('gemini') || k.startsWith('models/')) return 'google';
  if (k.includes('cursor')) return 'cursor';
  if (k.includes('copilot')) return 'github';
  if (k.startsWith('grok')) return 'xai';
  if (/^(mistral|mixtral|codestral|ministral|magistral|devstral)/.test(k)) return 'mistral';
  return 'other';
}

export function rule(w = Math.min(termWidth(), 72)): string {
  return pc.dim('─'.repeat(Math.max(1, w)));
}

/** Label/value lines, keys dimmed and padded to one column. */
export function kvLines(pairs: [string, string][]): string[] {
  const w = Math.max(0, ...pairs.map(([k]) => width(k)));
  return pairs.map(([k, v]) => `${pc.dim(pad(k, w, 'l'))}  ${v}`);
}

export function kv(pairs: [string, string][]): string {
  return kvLines(pairs)
    .map((l) => '  ' + l)
    .join('\n');
}

export function ok(s: string): string {
  return accent('✓ ') + s;
}
export function warn(s: string): string {
  return amber('! ') + s;
}
export function fail(s: string): string {
  return red('✗ ') + s;
}
export function dim(s: string): string {
  return pc.dim(s);
}
export function bold(s: string): string {
  return pc.bold(s);
}

/** Share bar on one scale: filled part in the accent (or a provider colour), remainder dimmed. */
export function bar(share: number, w = 20, paint: Paint = accent): string {
  const n = Math.round(Math.max(0, Math.min(1, share)) * w);
  return paint('█'.repeat(n)) + pc.dim('░'.repeat(w - n));
}

/** Motion is for terminals only: off when piped, in CI, with TERM=dumb or CLAI_NO_MOTION=1. */
export function motionEnabled(): boolean {
  return Boolean(process.stdout.isTTY) && !process.env['CI'] && process.env['TERM'] !== 'dumb' && !process.env['CLAI_NO_MOTION'];
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Print a block once, revealed: `frame(t)` renders the block with values scaled by `t` (bars
 * filling, figures counting up), redrawn in place from t=0 to t=1 over about a quarter second,
 * ending on the exact final block. Design rule 8: motion explains change the first time a value
 * appears, nothing loops. Falls back to printing `frame(1)` once when motion is off or the block
 * is wider than the terminal (where in-place redraws would misalign).
 */
export async function reveal(frame: (t: number) => string, opts: { enabled?: boolean; durationMs?: number; steps?: number; stream?: ProgressStream } = {}): Promise<void> {
  const stream = opts.stream ?? process.stdout;
  const final = frame(1);
  const fits = final.split('\n').every((l) => width(l) <= termWidth());
  if (!(opts.enabled ?? motionEnabled()) || !fits) {
    stream.write(final + '\n');
    return;
  }
  const steps = opts.steps ?? 8;
  const pause = (opts.durationMs ?? 260) / steps;
  let lines = 0;
  for (let i = 1; i <= steps; i++) {
    const t = 1 - Math.pow(1 - i / steps, 3); // ease-out
    const text = i === steps ? final : frame(t);
    if (lines) stream.write(`\x1b[${lines}A\x1b[J`);
    stream.write(text + '\n');
    lines = text.split('\n').length;
    if (i < steps) await sleep(pause);
  }
}

/**
 * A card with rounded corners around pre-rendered lines (a ledger card, not a decoration: use it
 * once per command for the figures that matter). Width follows the content, capped to the
 * terminal; lines wider than the cap are cut.
 */
export function box(lines: string[], opts: { title?: string; pad?: number } = {}): string {
  const padding = opts.pad ?? 1;
  const cap = Math.max(24, termWidth() - 2);
  const content = Math.max(...lines.map(width), opts.title ? width(opts.title) + 3 : 0, 1);
  const inner = Math.min(content + padding * 2, cap);
  const cut = (l: string) => (width(l) > inner - padding ? stripAnsi(l).slice(0, inner - padding - 1) + '…' : l);
  const top = opts.title ? pc.dim('╭─ ') + pc.bold(opts.title) + pc.dim(' ' + '─'.repeat(Math.max(0, inner - width(opts.title) - 3)) + '╮') : pc.dim('╭' + '─'.repeat(inner) + '╮');
  const body = lines.map((raw) => {
    const l = cut(raw);
    return pc.dim('│') + ' '.repeat(padding) + l + ' '.repeat(Math.max(0, inner - padding - width(l))) + pc.dim('│');
  });
  return [top, ...body, pc.dim('╰' + '─'.repeat(inner) + '╯')].join('\n');
}

export function printJson(v: unknown): void {
  process.stdout.write(JSON.stringify(v, null, 2) + '\n');
}

export function severityGlyph(s: string): string {
  switch (s) {
    case 'critical':
      return red('●');
    case 'warning':
      return amber('●');
    case 'opportunity':
      return accent('●');
    default:
      return pc.dim('●');
  }
}

export function durationHuman(ms: number): string {
  if (ms < 60e3) return `${Math.round(ms / 1000)}s`;
  if (ms < 3600e3) return `${Math.round(ms / 60e3)}m`;
  return `${(ms / 3600e3).toFixed(1)}h`;
}

/** Elapsed time for progress lines: 850ms, 1.2s, 1m 05s. */
export function elapsed(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60e3) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60e3);
  const s = Math.round((ms % 60e3) / 1000);
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

export function count(n: number): string {
  return n.toLocaleString('en-US');
}

/** Cut a plain string to `n` visible characters with an ellipsis; leaves shorter strings alone. */
export function truncate(s: string, n: number): string {
  return width(s) <= n ? s : stripAnsi(s).slice(0, Math.max(0, n - 1)) + '…';
}

/** `~` for the home directory in paths shown to the user. */
export function homePath(p: string, home: string): string {
  return home && p.startsWith(home) ? '~' + p.slice(home.length) : p;
}

export interface Progress {
  /** Replace the label; the elapsed time keeps counting. */
  update(label: string): void;
  /** Clear the line. Commands print their own result lines on stdout afterwards. */
  stop(): void;
  readonly elapsedMs: number;
}

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export interface ProgressStream {
  isTTY?: boolean;
  write(s: string): unknown;
}

/**
 * One-line progress indicator on stderr: glyph, label, elapsed time, redrawn in place while a
 * command works (design rule 8: motion explains change; it stops the moment the work ends and
 * leaves nothing behind). Off when stderr is not a terminal, in CI, with TERM=dumb, or when the
 * caller passes `enabled: false` (--quiet, --json). stdout is never touched, so pipes stay clean.
 */
export function progress(label: string, opts: { enabled?: boolean; stream?: ProgressStream; intervalMs?: number } = {}): Progress {
  const stream = opts.stream ?? process.stderr;
  const enabled = opts.enabled ?? (Boolean(stream.isTTY) && !process.env['CI'] && process.env['TERM'] !== 'dumb');
  const started = Date.now();
  let text = label;
  let frame = 0;
  let lastLen = 0;
  let timer: NodeJS.Timeout | null = null;
  const render = () => {
    const s = `${accent(FRAMES[frame]!)} ${text} ${pc.dim('· ' + elapsed(Date.now() - started))}`;
    stream.write('\r' + s + ' '.repeat(Math.max(0, lastLen - width(s))));
    lastLen = width(s);
  };
  if (enabled) {
    render();
    timer = setInterval(() => {
      frame = (frame + 1) % FRAMES.length;
      render();
    }, opts.intervalMs ?? 80);
    timer.unref?.();
  }
  return {
    update(next) {
      text = next;
      if (enabled) render();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
      if (enabled && lastLen) stream.write('\r' + ' '.repeat(lastLen) + '\r');
      lastLen = 0;
    },
    get elapsedMs() {
      return Date.now() - started;
    },
  };
}
