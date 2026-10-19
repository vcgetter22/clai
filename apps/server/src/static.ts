import { createRequire } from 'node:module';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Context } from 'hono';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
};

/**
 * Locate the built dashboard: `$CLAI_DASHBOARD_DIR`, then the installed `@claii/dashboard`
 * package, then a `dashboard/` folder next to this module (the single-file engine bundle that
 * clai for Mac ships, see scripts/bundle-engine.mjs).
 */
export function dashboardDistDir(env: NodeJS.ProcessEnv = process.env): string | null {
  const candidates: string[] = [];
  if (env['CLAI_DASHBOARD_DIR']) candidates.push(resolve(env['CLAI_DASHBOARD_DIR']));
  try {
    const req = createRequire(import.meta.url);
    candidates.push(join(dirname(req.resolve('@claii/dashboard/package.json')), 'dist'));
  } catch {
    // Not installed alongside: the bundled engine.
  }
  candidates.push(join(dirname(fileURLToPath(import.meta.url)), 'dashboard'));
  return candidates.find((dir) => existsSync(join(dir, 'index.html'))) ?? null;
}

/** Minimal, safe static file handler with SPA fallback. */
export function serveDashboard(root: string | null) {
  return (c: Context): Response => {
    if (!root) {
      return c.html(
        '<!doctype html><meta charset="utf-8"><title>clai</title><body style="font-family:system-ui;padding:2rem;max-width:40rem"><h1>clai API is running</h1><p>The dashboard bundle was not found. Build it with <code>npm run build -w @claii/dashboard</code> (or reinstall the package) and restart.</p><p>API: <a href="/api/health">/api/health</a></p></body>',
        503,
      );
    }
    const url = new URL(c.req.url);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === '/' || pathname === '') pathname = '/index.html';
    const file = resolve(root, '.' + normalize(pathname));
    if (!file.startsWith(resolve(root))) return c.text('Forbidden', 403);
    let target = file;
    if (!existsSync(target) || !statSync(target).isFile()) target = join(root, 'index.html');
    const ext = extname(target).toLowerCase();
    const body = readFileSync(target);
    const headers: Record<string, string> = { 'content-type': TYPES[ext] ?? 'application/octet-stream' };
    headers['cache-control'] = ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable';
    return new Response(body, { status: 200, headers });
  };
}
