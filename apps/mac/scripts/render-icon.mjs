#!/usr/bin/env node
/**
 * Renders Resources/AppIcon.svg to Resources/AppIcon.png (1024x1024, transparent corners) with a
 * headless Chromium. Run after editing the SVG; the packaging script turns the PNG into an .icns.
 *   npx -y playwright@1 install chromium   (once, if no Chromium is around)
 *   node apps/mac/scripts/render-icon.mjs
 */
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const svgPath = join(here, '../Resources/AppIcon.svg');
const outPath = process.argv[2] ?? join(here, '../Resources/AppIcon.png');

let playwright;
try {
  playwright = createRequire(import.meta.url)('playwright');
} catch {
  playwright = createRequire(join(execSync('npm root -g').toString().trim(), 'noop.js'))('playwright');
}

const browser = await playwright.chromium.launch();
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 });
await page.setContent(`<html><body style="margin:0;background:transparent">${readFileSync(svgPath, 'utf8')}</body></html>`);
writeFileSync(outPath, await page.locator('svg').screenshot({ omitBackground: true }));
await browser.close();
console.log(`wrote ${outPath}`);
