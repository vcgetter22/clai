import { describe, expect, it } from 'vitest';
import { EventStore } from '@claii/store';
import { bootstrapTeam } from './app.js';
import { lookupToken } from './api.js';

describe('bootstrapTeam', () => {
  it('registers a provided CLAI_ADMIN_TOKEN verbatim (regression: require() in an ES module)', () => {
    const store = new EventStore(':memory:');
    const boot = bootstrapTeam(store, { CLAI_ADMIN_TOKEN: 'clai_adm_fixed', CLAI_ADMIN_EMAIL: 'ops@example.com' });
    expect(boot.adminTokenCreated).toBe('clai_adm_fixed');
    expect(lookupToken(store, 'clai_adm_fixed')).toMatchObject({ actorKey: 'ops@example.com', role: 'admin' });
    expect(bootstrapTeam(store, { CLAI_ADMIN_TOKEN: 'clai_adm_fixed' }).adminTokenCreated).toBeNull();
  });

  it('generates an admin token when none is provided', () => {
    const store = new EventStore(':memory:');
    const boot = bootstrapTeam(store, {});
    expect(boot.adminTokenCreated).toMatch(/^clai_adm_/);
    expect(lookupToken(store, boot.adminTokenCreated!)?.role).toBe('admin');
  });
});
