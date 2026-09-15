import { createInterface } from 'node:readline/promises';
import type { Command } from 'commander';
import { writeCredentials } from '@claii/server';
import { openBrowser } from '../browser.js';
import { openContext, type GlobalOptions } from '../context.js';
import { HOSTED_URL } from '../hosted.js';
import { dim, fail, heading, ok, printJson, progress, type Progress } from '../ui.js';

/** The slice of `CliContext` this command touches, kept structural (not `SqliteEventStore`) so tests can pass a plain fake. */
export interface LoginContext {
  env: NodeJS.ProcessEnv;
  store: {
    getSetting(key: string): Promise<string | undefined>;
    setSetting(key: string, value: string): Promise<void>;
  };
}

interface DeviceStartResponse {
  deviceCode: string;
  userCode: string;
  verificationUrl: string;
  interval: number;
  expiresIn: number;
}

interface DeviceTokenSuccess {
  token: string;
  actorKey: string;
  orgId: string | null;
  role: string;
}

/** Everything `runLogin` needs from the outside world, injected so tests never touch the network, a real browser or a real TTY. */
export interface LoginDeps {
  fetch: typeof fetch;
  openBrowser: (url: string) => void;
  /** Prompt on stdout, read a line from stdin (used for the self-hosted paste-a-token fallback). */
  readToken: (question: string) => Promise<string>;
  sleep: (ms: number) => Promise<void>;
  /** Progress line while polling for the browser approval; optional so tests can omit it. */
  progress?: (label: string) => Progress;
}

export function defaultLoginDeps(): LoginDeps {
  return {
    fetch: (...args) => fetch(...args),
    openBrowser,
    readToken: async (question: string) => {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try {
        return (await rl.question(question)).trim();
      } finally {
        rl.close();
      }
    },
    sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
    progress: (label) => progress(label),
  };
}

export interface LoginOptions {
  server?: string;
  admin?: boolean;
}

export type LoginResult = { ok: true; server: string } | { ok: false; error: string };

/** Store the credential the same way regardless of how it was obtained (device flow or pasted). */
async function finalizeLogin(server: string, token: string, ctx: LoginContext): Promise<void> {
  const prevServer = await ctx.store.getSetting('sync.server');
  writeCredentials('sync', { server, token }, ctx.env);
  await ctx.store.setSetting('sync.server', server);
  // A cursor from a different server doesn't mean anything here; resume from scratch.
  if (prevServer && prevServer !== server) await ctx.store.setSetting('sync.last_ts', '');
}

async function pasteTokenFallback(server: string, ctx: LoginContext, deps: LoginDeps, out: (line: string) => void): Promise<LoginResult> {
  out(dim(`  No device login at ${server} (looks like a self-hosted clai-server). Falling back to a pasted token.`));
  out(dim('  Ask your clai admin for a member token (minted with POST /api/admin/tokens; see docs/team-server.md).'));
  const token = await deps.readToken('Paste your token: ');
  if (!token) return { ok: false, error: 'No token provided.' };
  await finalizeLogin(server, token, ctx);
  out(ok('Signed in.'));
  out(dim('  Run:'));
  out('    clai sync');
  return { ok: true, server };
}

/** The whole flow, factored out of the Commander action so tests can drive it directly with fake deps. */
export async function runLogin(opts: LoginOptions, ctx: LoginContext, deps: LoginDeps = defaultLoginDeps(), out: (line: string) => void = (l) => console.log(l)): Promise<LoginResult> {
  const server = (opts.server ?? ctx.env['CLAI_SYNC_SERVER'] ?? HOSTED_URL).replace(/\/$/, '');
  out(heading('clai login'));
  out(dim(`  Server: ${server}`));
  try {
    const startRes = await deps.fetch(`${server}/api/auth/device`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scope: opts.admin ? 'admin' : 'member' }),
    });
    if (startRes.status === 404) return pasteTokenFallback(server, ctx, deps, out);
    if (!startRes.ok) {
      const body = await startRes.text().catch(() => '');
      throw new Error(`Server responded ${startRes.status}: ${body.slice(0, 300)}`);
    }
    const start = (await startRes.json()) as DeviceStartResponse;

    out(ok(`Confirmation code: ${start.userCode}`));
    out(dim(`  Opening ${start.verificationUrl} in your browser…`));
    out(dim('  If it does not open, visit that URL yourself and enter the code above.'));
    deps.openBrowser(start.verificationUrl);

    const intervalMs = Math.max(start.interval, 1) * 1000;
    const deadline = Date.now() + Math.max(start.expiresIn, 1) * 1000;
    const spin = deps.progress?.('waiting for approval in the browser');
    try {
      return await pollForToken();
    } finally {
      spin?.stop();
    }

    async function pollForToken(): Promise<LoginResult> {
    for (;;) {
      await deps.sleep(intervalMs);
      if (Date.now() > deadline) return fail1('The login request expired. Run `clai login` again.', out);

      const pollRes = await deps.fetch(`${server}/api/auth/device/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ deviceCode: start.deviceCode }),
      });
      if (pollRes.status === 200) {
        const success = (await pollRes.json()) as DeviceTokenSuccess;
        await finalizeLogin(server, success.token, ctx);
        out(ok(`Signed in as ${success.actorKey} (${success.role}).`));
        out(dim('  Run:'));
        out('    clai sync');
        return { ok: true, server };
      }
      const body = (await pollRes.json().catch(() => ({}))) as { error?: string };
      if (pollRes.status === 428 || body.error === 'authorization_pending') continue;
      if (body.error === 'expired') return fail1('The login request expired. Run `clai login` again.', out);
      if (body.error === 'denied') return fail1('Login was denied.', out);
      throw new Error(`Server responded ${pollRes.status}: ${body.error ?? JSON.stringify(body)}`);
    }
    }
  } catch (err) {
    return fail1((err as Error).message, out);
  }
}

function fail1(message: string, out: (line: string) => void): { ok: false; error: string } {
  out(fail(message));
  return { ok: false, error: message };
}

export function registerLogin(program: Command, deps: LoginDeps = defaultLoginDeps()): void {
  program
    .command('login')
    .description('Sign in to the hosted clai service (or a self-hosted team server) and save a sync token')
    .option('--server <url>', `server URL (default ${HOSTED_URL}; or CLAI_SYNC_SERVER)`)
    .option('--admin', 'request an admin-scoped token', false)
    .action(async (opts: LoginOptions, cmd: Command) => {
      const ctx = openContext(cmd.optsWithGlobals() as GlobalOptions);
      try {
        const result = await runLogin(opts, ctx, deps);
        if (ctx.json) printJson(result.ok ? { server: result.server } : { error: result.error });
        if (!result.ok) process.exitCode = 1;
      } finally {
        await ctx.close();
      }
    });
}
