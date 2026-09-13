import { describe, expect, it } from 'vitest';
import { CATALOG } from '@claii/core';
import { SqliteEventStore } from '@claii/store/sqlite';
import { createApi, mintToken } from './api.js';

function teamApi() {
  const store = new SqliteEventStore(':memory:');
  const api = createApi({ store, catalog: CATALOG, mode: 'team', version: '0.2.0-test' });
  return { store, api };
}

describe('createApi team mode: hosted-extension additive fields (docs/dashboard-api.md)', () => {
  it('GET /health is public, includes auth: { kind: "token" }, and still has no db stats', async () => {
    const { api } = teamApi();
    const res = await api.request('/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body['auth']).toEqual({ kind: 'token' });
    expect(body['db']).toBeUndefined();
  });

  it('GET /whoami reports email only when actorKey looks like one, plus the inert self-hosted defaults', async () => {
    const { api, store } = teamApi();
    const admin = mintToken('admin');
    await store.insertToken({ tokenHash: admin.tokenHash, actorKey: 'admin', role: 'admin' });
    const resAdmin = await api.request('/whoami', { headers: { authorization: `Bearer ${admin.token}` } });
    expect(await resAdmin.json()).toMatchObject({
      actorKey: 'admin',
      email: null,
      orgId: null,
      orgs: [],
      plan: 'self-hosted',
      billingStatus: null,
      upgradeUrl: null,
      portalUrl: null,
      tosAccepted: true,
    });

    const member = mintToken('member');
    await store.insertToken({ tokenHash: member.tokenHash, actorKey: 'jane@acme.com', role: 'member' });
    const resMember = await api.request('/whoami', { headers: { authorization: `Bearer ${member.token}` } });
    const memberBody = (await resMember.json()) as Record<string, unknown>;
    expect(memberBody['email']).toBe('jane@acme.com');
  });

  it('an unauthenticated request to a route nothing here serves gets 404, not 401', async () => {
    // `clai login` tells a self-hosted clai-server apart from the hosted service by this exact
    // status code on POST /api/auth/device (which only the hosted service implements).
    const { api } = teamApi();
    const res = await api.request('/auth/device', { method: 'POST' });
    expect(res.status).toBe(404);
  });

  it('an unauthenticated request to a real, protected route still gets 401 (regression guard)', async () => {
    const { api } = teamApi();
    expect((await api.request('/summary')).status).toBe(401);
    expect((await api.request('/admin/tokens/deadbeef', { method: 'DELETE' })).status).toBe(401);
  });

  it('an authenticated request to an unknown route still 404s', async () => {
    const { api, store } = teamApi();
    const admin = mintToken('admin');
    await store.insertToken({ tokenHash: admin.tokenHash, actorKey: 'admin', role: 'admin' });
    const res = await api.request('/auth/device', { method: 'POST', headers: { authorization: `Bearer ${admin.token}` } });
    expect(res.status).toBe(404);
  });
});
