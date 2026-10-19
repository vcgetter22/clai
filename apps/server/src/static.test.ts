import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dashboardDistDir } from './static.js';

describe('dashboardDistDir', () => {
  it('prefers CLAI_DASHBOARD_DIR when it holds a built dashboard', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clai-dash-'));
    writeFileSync(join(dir, 'index.html'), '<!doctype html>');
    expect(dashboardDistDir({ CLAI_DASHBOARD_DIR: dir })).toBe(dir);
  });

  it('skips a CLAI_DASHBOARD_DIR without an index.html', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clai-dash-'));
    expect(dashboardDistDir({ CLAI_DASHBOARD_DIR: dir })).not.toBe(dir);
  });
});
