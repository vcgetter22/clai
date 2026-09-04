import { createRequire } from 'node:module';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve } from 'node:path';
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

/** Locate the built dashboard (apps/dashboard/dist) via the workspace package. */
export function dashboardDistDir(): string | null {
  try {
    const req = createRequire(import.meta.url);
    const pkg = req.resolve('@claii/dashboard/package.json');
    const dist = join(dirname(pkg), 'dist');
    return existsSync(join(dist, 'index.html')) ? dist : null;
  } catch {
    return null;
  }
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
