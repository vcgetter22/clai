import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readCredentialsFile } from '@claii/server';
import { HOSTED_URL } from '../hosted.js';
import { runLogin, type LoginContext, type LoginDeps } from './login.js';

function fakeStore() {
  const settings = new Map<string, string>();
  return {
    getSetting: async (k: string) => settings.get(k),
    setSetting: async (k: string, v: string) => void settings.set(k, v),
  };
}

const noSleep = (): Promise<void> => Promise.resolve();

function jsonRes(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

let home: string;
let ctx: LoginContext;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'clai-login-test-'));
  ctx = { env: { CLAI_HOME: home } as NodeJS.ProcessEnv, store: fakeStore() };
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe('runLogin', () => {
  it('completes the device flow on the first poll and saves the credential', async () => {
    const opened: string[] = [];
    const fetchImpl = (async (url: string | URL | Request) => {
      const u = String(url);
      if (u.endsWith('/api/auth/device')) {
        return jsonRes(200, { deviceCode: 'dc1', userCode: 'ABCD-EFGH', verificationUrl: 'https://clai.cobank.ai/#/device?code=ABCD-EFGH', interval: 1, expiresIn: 60 });
      }
      if (u.endsWith('/api/auth/device/token')) {
        return jsonRes(200, { token: 'clai_mem_x', actorKey: 'jane@acme.com', orgId: 'org_1', role: 'member' });
      }
      throw new Error(`unexpected fetch ${u}`);
    }) as typeof fetch;
    const deps: LoginDeps = { fetch: fetchImpl, openBrowser: (u) => opened.push(u), readToken: async () => '', sleep: noSleep };

    const result = await runLogin({}, ctx, deps, () => {});

    expect(result).toEqual({ ok: true, server: HOSTED_URL });
    expect(opened).toEqual(['https://clai.cobank.ai/#/device?code=ABCD-EFGH']);
    expect(readCredentialsFile(ctx.env)['sync']).toEqual({ server: HOSTED_URL, token: 'clai_mem_x' });
    expect(await ctx.store.getSetting('sync.server')).toBe(HOSTED_URL);
  });

  it('sends scope=admin with --admin', async () => {
    let body: string | undefined;
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith('/api/auth/device')) {
        body = init?.body as string;
        return jsonRes(200, { deviceCode: 'dc1', userCode: 'CODE', verificationUrl: 'https://x/#/device?code=CODE', interval: 1, expiresIn: 60 });
      }
      return jsonRes(200, { token: 't', actorKey: 'a@b.com', orgId: null, role: 'admin' });
    }) as typeof fetch;
    const deps: LoginDeps = { fetch: fetchImpl, openBrowser: () => {}, readToken: async () => '', sleep: noSleep };

    await runLogin({ admin: true }, ctx, deps, () => {});

    expect(body).toBe(JSON.stringify({ scope: 'admin' }));
  });

  it('keeps polling through authorization_pending (428) until the token is issued', async () => {
    let pollCount = 0;
    const fetchImpl = (async (url: string | URL | Request) => {
      const u = String(url);
      if (u.endsWith('/api/auth/device')) return jsonRes(200, { deviceCode: 'dc1', userCode: 'CODE', verificationUrl: 'https://x/#/device?code=CODE', interval: 1, expiresIn: 60 });
      if (u.endsWith('/api/auth/device/token')) {
        pollCount += 1;
        if (pollCount < 3) return jsonRes(428, { error: 'authorization_pending' });
        return jsonRes(200, { token: 'clai_mem_y', actorKey: 'jane@acme.com', orgId: null, role: 'member' });
      }
      throw new Error(`unexpected fetch ${u}`);
    }) as typeof fetch;
    const deps: LoginDeps = { fetch: fetchImpl, openBrowser: () => {}, readToken: async () => '', sleep: noSleep };

    const result = await runLogin({ server: 'https://team.example.com' }, ctx, deps, () => {});

    expect(result).toEqual({ ok: true, server: 'https://team.example.com' });
    expect(pollCount).toBe(3);
  });

  it('aborts when the server reports the code expired', async () => {
    const fetchImpl = (async (url: string | URL | Request) => {
      const u = String(url);
      if (u.endsWith('/api/auth/device')) return jsonRes(200, { deviceCode: 'dc1', userCode: 'CODE', verificationUrl: 'https://x/#/device?code=CODE', interval: 1, expiresIn: 60 });
      if (u.endsWith('/api/auth/device/token')) return jsonRes(400, { error: 'expired' });
      throw new Error(`unexpected fetch ${u}`);
    }) as typeof fetch;
    const deps: LoginDeps = { fetch: fetchImpl, openBrowser: () => {}, readToken: async () => '', sleep: noSleep };

    const result = await runLogin({}, ctx, deps, () => {});

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/expired/i);
    expect(readCredentialsFile(ctx.env)['sync']).toBeUndefined();
  });

  it('aborts when the server reports the login denied', async () => {
    const fetchImpl = (async (url: string | URL | Request) => {
      const u = String(url);
      if (u.endsWith('/api/auth/device')) return jsonRes(200, { deviceCode: 'dc1', userCode: 'CODE', verificationUrl: 'https://x/#/device?code=CODE', interval: 1, expiresIn: 60 });
      if (u.endsWith('/api/auth/device/token')) return jsonRes(403, { error: 'denied' });
      throw new Error(`unexpected fetch ${u}`);
    }) as typeof fetch;
    const deps: LoginDeps = { fetch: fetchImpl, openBrowser: () => {}, readToken: async () => '', sleep: noSleep };

    const result = await runLogin({}, ctx, deps, () => {});

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/denied/i);
  });

  it('falls back to a pasted token when the server has no device flow (404)', async () => {
    const fetchImpl = (async (url: string | URL | Request) => {
      const u = String(url);
      if (u.endsWith('/api/auth/device')) return new Response('404 Not Found', { status: 404 });
      throw new Error(`unexpected fetch ${u}`);
    }) as typeof fetch;
    const deps: LoginDeps = { fetch: fetchImpl, openBrowser: () => {}, readToken: async () => 'clai_mem_pasted', sleep: noSleep };

    const result = await runLogin({ server: 'http://127.0.0.1:4791' }, ctx, deps, () => {});

    expect(result).toEqual({ ok: true, server: 'http://127.0.0.1:4791' });
    expect(readCredentialsFile(ctx.env)['sync']).toEqual({ server: 'http://127.0.0.1:4791', token: 'clai_mem_pasted' });
  });

  it('fails the 404 fallback cleanly when nothing is pasted', async () => {
    const fetchImpl = (async () => new Response('404 Not Found', { status: 404 })) as typeof fetch;
    const deps: LoginDeps = { fetch: fetchImpl, openBrowser: () => {}, readToken: async () => '', sleep: noSleep };

    const result = await runLogin({ server: 'http://127.0.0.1:4791' }, ctx, deps, () => {});

    expect(result.ok).toBe(false);
  });

  it('resets sync.last_ts when logging into a different server than before', async () => {
    await ctx.store.setSetting('sync.server', 'https://old.example.com');
    await ctx.store.setSetting('sync.last_ts', '2026-01-01T00:00:00.000Z');
    const fetchImpl = (async (url: string | URL | Request) => {
      const u = String(url);
      if (u.endsWith('/api/auth/device')) return jsonRes(200, { deviceCode: 'dc1', userCode: 'CODE', verificationUrl: 'https://x', interval: 1, expiresIn: 60 });
      return jsonRes(200, { token: 'clai_mem_z', actorKey: 'jane@acme.com', orgId: null, role: 'member' });
    }) as typeof fetch;
    const deps: LoginDeps = { fetch: fetchImpl, openBrowser: () => {}, readToken: async () => '', sleep: noSleep };

    await runLogin({ server: 'https://new.example.com' }, ctx, deps, () => {});

    expect(await ctx.store.getSetting('sync.last_ts')).toBe('');
    expect(await ctx.store.getSetting('sync.server')).toBe('https://new.example.com');
  });

  it('leaves sync.last_ts alone when logging into the same server again', async () => {
    await ctx.store.setSetting('sync.server', HOSTED_URL);
    await ctx.store.setSetting('sync.last_ts', '2026-01-01T00:00:00.000Z');
    const fetchImpl = (async (url: string | URL | Request) => {
      const u = String(url);
      if (u.endsWith('/api/auth/device')) return jsonRes(200, { deviceCode: 'dc1', userCode: 'CODE', verificationUrl: 'https://x', interval: 1, expiresIn: 60 });
      return jsonRes(200, { token: 'clai_mem_z', actorKey: 'jane@acme.com', orgId: null, role: 'member' });
    }) as typeof fetch;
    const deps: LoginDeps = { fetch: fetchImpl, openBrowser: () => {}, readToken: async () => '', sleep: noSleep };

    await runLogin({}, ctx, deps, () => {});

    expect(await ctx.store.getSetting('sync.last_ts')).toBe('2026-01-01T00:00:00.000Z');
  });
});
