import { describe, expect, it } from 'vitest';
import { box, elapsed, homePath, kvLines, progress, stripAnsi, table, truncate, width } from './ui.js';

describe('ui', () => {
  it('table right-aligns numeric columns and measures widths without ANSI codes', () => {
    const out = stripAnsi(table(['source', 'spend'], [['claude-code', '$1,234.50'], ['codex', '$0.42']], ['l', 'r']));
    const lines = out.split('\n');
    expect(lines[0]).toBe('  source            spend'); // headers follow their column's alignment
    expect(lines[2]).toBe('  claude-code   $1,234.50');
    expect(lines[3]).toBe('  codex             $0.42');
  });

  it('box lines share one visible width and carry the title', () => {
    const out = box(kvLines([['spend', '$412.30'], ['this month', '$180.12']]), { title: 'last 30 days' });
    const lines = out.split('\n').map(stripAnsi);
    expect(lines[0]).toMatch(/^╭─ last 30 days ─+╮$/);
    expect(new Set(lines.map((l) => l.length)).size).toBe(1);
    expect(lines[1]).toContain('spend       $412.30');
    expect(lines.at(-1)).toMatch(/^╰─+╯$/);
  });

  it('formats elapsed time and home paths', () => {
    expect(elapsed(850)).toBe('850ms');
    expect(elapsed(1234)).toBe('1.2s');
    expect(elapsed(65_000)).toBe('1m 05s');
    expect(homePath('/Users/x/.clai/clai.db', '/Users/x')).toBe('~/.clai/clai.db');
    expect(homePath('/tmp/clai.db', '/Users/x')).toBe('/tmp/clai.db');
    expect(truncate('No Codex CLI sessions found', 12)).toBe('No Codex CL…');
    expect(truncate('short', 12)).toBe('short');
  });

  it('progress redraws in place on a terminal and clears itself on stop', () => {
    const writes: string[] = [];
    const p = progress('scanning', { stream: { isTTY: true, write: (s) => writes.push(s) }, intervalMs: 10_000 });
    p.update('scanning claude-code');
    p.stop();
    const text = writes.map(stripAnsi).join('');
    expect(text).toContain('⠋ scanning ·');
    expect(text).toContain('scanning claude-code ·');
    expect(writes.at(-1)).toMatch(/^\r +\r$/);
    expect(width(writes.at(-1)!)).toBeGreaterThan(0);
  });

  it('progress writes nothing when the stream is not a terminal or when disabled', () => {
    const writes: string[] = [];
    const quiet = progress('x', { stream: { isTTY: false, write: (s) => writes.push(s) } });
    quiet.update('y');
    quiet.stop();
    const off = progress('x', { enabled: false, stream: { isTTY: true, write: (s) => writes.push(s) } });
    off.stop();
    expect(writes).toEqual([]);
    expect(off.elapsedMs).toBeGreaterThanOrEqual(0);
  });
});
