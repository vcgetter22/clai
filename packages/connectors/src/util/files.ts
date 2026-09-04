import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { StateStore } from '../types.js';

export interface FileState {
  size: number;
  mtimeMs: number;
  /** Byte offset up to which the file has been fully processed (line-aligned). */
  offset: number;
}

export function walk(dir: string, pred: (name: string, full: string) => boolean, out: string[] = [], depth = 0): string[] {
  if (depth > 12 || !existsSync(dir)) return out;
  let entries: import('node:fs').Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name.startsWith('.git')) continue;
      walk(full, pred, out, depth + 1);
    } else if (e.isFile() && pred(e.name, full)) {
      out.push(full);
    }
  }
  return out;
}

export function readFileState(state: StateStore, file: string): FileState | undefined {
  const raw = state.get(`file:${file}`);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as FileState;
  } catch {
    return undefined;
  }
}

export function writeFileState(state: StateStore, file: string, fs: FileState): void {
  state.set(`file:${file}`, JSON.stringify(fs));
}

/**
 * Yield complete lines of a file starting at `offset`, tracking the byte offset after each
 * yielded line so callers can persist incremental progress. A trailing partial line (no newline)
 * is not yielded; its bytes are excluded from the returned offset so it is re-read next time.
 */
export async function* readLinesFrom(file: string, offset: number): AsyncGenerator<{ line: string; end: number }> {
  const fh = await open(file, 'r');
  try {
    const stat = await fh.stat();
    if (offset >= stat.size) return;
    const stream = createReadStream(file, { fd: fh.fd, start: offset, autoClose: false, highWaterMark: 1 << 20, encoding: 'utf8' });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    let pos = offset;
    let pending: string | null = null;
    let pendingEnd = 0;
    // readline does not expose byte offsets; compute from UTF-8 byte length of each line + newline.
    for await (const line of rl) {
      const bytes = Buffer.byteLength(line, 'utf8') + 1; // assume \n (CRLF files: crlfDelay merges, count 1 - handled below)
      if (pending !== null) yield { line: pending, end: pendingEnd };
      pending = line;
      pos += bytes;
      pendingEnd = pos;
    }
    if (pending !== null) {
      // Determine whether the last line was newline-terminated by checking the file's final byte.
      const buf = Buffer.alloc(1);
      const { bytesRead } = await fh.read(buf, 0, 1, stat.size - 1);
      const terminated = bytesRead === 1 && buf[0] === 0x0a;
      if (terminated) yield { line: pending, end: Math.min(pendingEnd, stat.size) };
      // else: partial trailing line; skip so it is re-read once complete.
    }
  } finally {
    await fh.close();
  }
}

export function fileMeta(file: string): { size: number; mtimeMs: number } | null {
  try {
    const s = statSync(file);
    return { size: s.size, mtimeMs: s.mtimeMs };
  } catch {
    return null;
  }
}

export function safeJson<T = unknown>(line: string): T | null {
  try {
    return JSON.parse(line) as T;
  } catch {
    return null;
  }
}

export function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v !== '' && Number.isFinite(Number(v)) ? Number(v) : 0;
}

export function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length ? v : undefined;
}
