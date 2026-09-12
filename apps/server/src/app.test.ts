import { describe, expect, it } from 'vitest';
import { SqliteEventStore } from '@claii/store/sqlite';
import { bootstrapTeam } from './app.js';
import { lookupToken } from './api.js';

describe('bootstrapTeam', () => {
  it('registers a provided CLAI_ADMIN_TOKEN verbatim (regression: require() in an ES module)', async () => {
    const store = new SqliteEventStore(':memory:');
    const boot = await bootstrapTeam(store, { CLAI_ADMIN_TOKEN: 'clai_adm_fixed', CLAI_ADMIN_EMAIL: 'ops@example.com' });
    expect(boot.adminTokenCreated).toBe('clai_adm_fixed');
    expect(await lookupToken(store, 'clai_adm_fixed')).toMatchObject({ actorKey: 'ops@example.com', role: 'admin' });
    expect((await bootstrapTeam(store, { CLAI_ADMIN_TOKEN: 'clai_adm_fixed' })).adminTokenCreated).toBeNull();
  });

  it('generates an admin token when none is provided', async () => {
    const store = new SqliteEventStore(':memory:');
    const boot = await bootstrapTeam(store, {});
    expect(boot.adminTokenCreated).toMatch(/^clai_adm_/);
    expect((await lookupToken(store, boot.adminTokenCreated!))?.role).toBe('admin');
  });
});
