#!/usr/bin/env node
/**
 * Renders the site's images from the app icon with a headless Chromium (Playwright):
 *   public/icon-180.png   apple-touch-icon and header logo
 *   public/og.png         1200x630 social card
 * Run after changing apps/mac/Resources/AppIcon.png:  node apps/site/scripts/render-assets.mjs
 */
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pub = join(here, '../public');
const icon = `data:image/png;base64,${readFileSync(join(here, '../../mac/Resources/AppIcon.png')).toString('base64')}`;

let playwright;
try {
  playwright = createRequire(import.meta.url)('playwright');
} catch {
  playwright = createRequire(join(execSync('npm root -g').toString().trim(), 'noop.js'))('playwright');
}

const browser = await playwright.chromium.launch();

// Touch icon: the app icon, its transparent margin trimmed to the squircle.
{
  const page = await browser.newPage({ viewport: { width: 180, height: 180 } });
  await page.setContent(`<body style="margin:0;background:transparent"><img src="${icon}" style="display:block;width:220px;height:220px;margin:-20px"></body>`);
  writeFileSync(join(pub, 'icon-180.png'), await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: 180, height: 180 } }));
  await page.close();
}

// Social card.
{
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await page.setContent(`<!doctype html><html><head><style>
    body { margin: 0; width: 1200px; height: 630px; overflow: hidden; font-family: "SF Pro Rounded", ui-rounded, "Nunito", "Segoe UI", system-ui, sans-serif;
      background: radial-gradient(circle at 85% 12%, rgba(201,245,228,.75), transparent 38%), radial-gradient(circle at 8% 110%, #083f33, transparent 55%), linear-gradient(120deg, #0e5444, #1e7a62 45%, #22a386 78%, #6fd9b8);
      color: #fff; position: relative; }
    .b { position: absolute; border-radius: 50%; background: radial-gradient(circle at 32% 28%, rgba(255,255,255,.75), rgba(255,255,255,.12) 38%, rgba(255,255,255,.04) 70%); box-shadow: inset 0 0 0 2px rgba(255,255,255,.35); }
    .wrap { position: absolute; left: 84px; top: 50%; transform: translateY(-50%); display: flex; gap: 48px; align-items: center; }
    img { width: 300px; height: 300px; filter: drop-shadow(0 24px 40px rgba(0,0,0,.25)); margin: -30px; }
    h1 { font-size: 92px; line-height: 1; margin: 0; letter-spacing: -3px; font-weight: 800; }
    p { font-size: 38px; line-height: 1.2; margin: 18px 0 0; font-weight: 650; max-width: 720px; opacity: .95; white-space: nowrap; }
    small { display: block; margin-top: 26px; font-size: 26px; font-weight: 600; opacity: .8; }
  </style></head><body>
    <span class="b" style="width:260px;height:260px;right:-70px;bottom:-90px"></span>
    <span class="b" style="width:90px;height:90px;right:250px;top:60px"></span>
    <span class="b" style="width:40px;height:40px;left:560px;bottom:70px"></span>
    <div class="wrap"><img src="${icon}"><div><h1>clai for Mac</h1><p>Your AI spend, live in the menu bar.</p><small>Free and open source · getclai.vercel.app</small></div></div>
  </body></html>`);
  writeFileSync(join(pub, 'og.png'), await page.screenshot());
  await page.close();
}

await browser.close();
console.log('wrote public/icon-180.png and public/og.png');
