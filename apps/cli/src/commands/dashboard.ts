import { spawn } from 'node:child_process';
import type { Command } from 'commander';
import { dashboardDistDir, listen, runLocalScan } from '@claii/server';
import { openContext, type GlobalOptions } from '../context.js';
import { dim, heading, ok, warn } from '../ui.js';

function openBrowser(url: string): void {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
  } catch {
    /* ignore */
  }
}

export function registerDashboard(program: Command): void {
  program
    .command('dashboard')
    .alias('ui')
    .description('Open the local web dashboard (binds to 127.0.0.1; your data never leaves the machine)')
    .option('-p, --port <n>', 'port', '4321')
    .option('--host <host>', 'bind address', '127.0.0.1')
    .option('--no-open', 'do not open the browser')
    .option('--no-scan', 'skip the quick local scan on startup')
    .action(async (opts: { port: string; host: string; open: boolean; scan: boolean }, cmd: Command) => {
      const ctx = openContext(cmd.optsWithGlobals() as GlobalOptions);
      if (opts.scan) {
        ctx.log.info(dim('scanning local sources...'));
        const results = await runLocalScan(ctx.runner);
        const added = results.reduce((a, r) => a + r.inserted, 0);
        ctx.log.info(dim(`scan done: ${added} new events`));
      }
      const dist = dashboardDistDir();
      if (!dist) ctx.log.warn(warn('dashboard bundle not found; the API will run but the UI will show a build hint'));
      const { url, close } = await listen({
        store: ctx.store,
        catalog: ctx.catalog,
        mode: 'local',
        version: ctx.version,
        port: Number(opts.port) || 4321,
        host: opts.host,
        runner: ctx.runner,
        dashboardDir: dist,
      });
      console.log(heading('clai dashboard'));
      console.log(ok(`running at ${url}`));
      console.log(dim('  Press Ctrl+C to stop.'));
      if (opts.open) openBrowser(url);
      const shutdown = async () => {
        await close();
        ctx.close();
        process.exit(0);
      };
      process.on('SIGINT', () => void shutdown());
      process.on('SIGTERM', () => void shutdown());
      await new Promise(() => {});
    });
}
