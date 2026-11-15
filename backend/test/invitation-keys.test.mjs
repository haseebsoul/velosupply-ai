import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import fileAdapterModule from '../repository/file-adapter.js';
import domainModule from '../repository/domain-repositories.js';

const { createFileAdapter } = fileAdapterModule;
const { createDomainRepositories } = domainModule;
let directory;

afterEach(async () => {
  if (directory) await fs.rm(directory, { recursive: true, force: true });
  directory = null;
});

async function harness() {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'velosupply-invitations-'));
  const adapter = createFileAdapter({
    filePath: path.join(directory, 'db.json'),
    loadInitial: async () => ({
      users: [], invitations: [], products: [], warehouses: [], suppliers: [],
      stock: [], movements: [], orders: [], orderItems: [], tariffRules: [],
      purchaseOrders: [], messages: [], logs: [], newsletter: [], rewardClaims: [],
      idempotencyKeys: [], simulationRuns: [], settings: [],
      sre: { incidents: [], alerts: [], audit: [], healthChecks: [], loginAttempts: [] }
    })
  });
  await adapter.initialize();
  return { adapter, domain: createDomainRepositories(adapter) };
}

function invitation(id, role, codeHash, overrides = {}) {
  const createdAt = new Date().toISOString();
  return {
    id, role, codeHash, codeHint: 'TEST', createdBy: 'ADMIN-ISSUER',
    maxUses: 1, usedCount: 0,
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
    status: 'active', createdAt, updatedAt: createdAt,
    ...overrides
  };
}

function registration(id, email, role) {
  return {
    id, name: 'Test User', email, role, passwordHash: 'not-a-real-password-hash',
    isActive: true, deletedAt: null, actorId: id, actorRole: role
  };
}

describe('database-backed invitation keys', () => {
  it('redeems a matching single-use invitation once and records the account and audit events atomically', async () => {
    const { adapter, domain } = await harness();
    const hash = 'a'.repeat(64);
    const created = await domain.invitationKeys.create(invitation('INV-OPS-1', 'operator', hash), {
      id: 'ADMIN-ISSUER', role: 'admin'
    });

    const user = await domain.users.createFromInvitation(registration('USER-OPS-1', 'ops@example.com', 'operator'), hash);
    expect(user).toMatchObject({ id: 'USER-OPS-1', role: 'operator', email: 'ops@example.com' });
    expect(await adapter.findById('invitations', created.id)).toMatchObject({ usedCount: 1, status: 'used' });
    expect(await adapter.count('auditLogs', { action: 'invitation.redeem' })).toBe(1);
    expect(await adapter.count('users', { email: 'ops@example.com' })).toBe(1);

    await expect(domain.users.createFromInvitation(
      registration('USER-OPS-2', 'other@example.com', 'operator'), hash
    )).rejects.toMatchObject({ code: 'INVALID_INVITATION' });
    expect(await adapter.count('users', { email: 'other@example.com' })).toBe(0);
  });

  it('rejects role mismatch, expiration and revocation without creating users', async () => {
    const { adapter, domain } = await harness();
    const roleHash = 'b'.repeat(64);
    const expiredHash = 'c'.repeat(64);
    const revokedHash = 'd'.repeat(64);
    await domain.invitationKeys.create(invitation('INV-ADMIN-1', 'admin', roleHash), {
      id: 'ADMIN-ISSUER', role: 'admin'
    });
    await adapter.insert('invitations', invitation('INV-EXPIRED', 'operator', expiredHash, {
      expiresAt: new Date(Date.now() - 1000).toISOString()
    }));
    await domain.invitationKeys.create(invitation('INV-REVOKED', 'operator', revokedHash), {
      id: 'ADMIN-ISSUER', role: 'admin'
    });
    await domain.invitationKeys.revoke('INV-REVOKED', { id: 'ADMIN-ISSUER', role: 'admin' });

    await expect(domain.users.createFromInvitation(
      registration('USER-WRONG', 'wrong@example.com', 'operator'), roleHash
    )).rejects.toMatchObject({ code: 'INVALID_INVITATION' });
    await expect(domain.users.createFromInvitation(
      registration('USER-EXPIRED', 'expired@example.com', 'operator'), expiredHash
    )).rejects.toMatchObject({ code: 'INVALID_INVITATION' });
    await expect(domain.users.createFromInvitation(
      registration('USER-REVOKED', 'revoked@example.com', 'operator'), revokedHash
    )).rejects.toMatchObject({ code: 'INVALID_INVITATION' });
    expect(await adapter.count('users')).toBe(0);
  });

  it('supports multiple invited administrators while preserving the last-admin guard', async () => {
    const { domain } = await harness();
    const firstHash = 'e'.repeat(64);
    const secondHash = 'f'.repeat(64);
    await domain.invitationKeys.create(invitation('INV-ADMIN-2', 'admin', firstHash), {
      id: 'SYSTEM', role: 'system'
    });
    await domain.invitationKeys.create(invitation('INV-ADMIN-3', 'admin', secondHash), {
      id: 'ADMIN-1', role: 'admin'
    });
    const first = await domain.users.createFromInvitation(registration('ADMIN-1', 'admin1@example.com', 'admin'), firstHash);
    const second = await domain.users.createFromInvitation(registration('ADMIN-2', 'admin2@example.com', 'admin'), secondHash);
    expect(first.role).toBe('admin');
    expect(second.role).toBe('admin');

    await domain.users.changeRole(first.id, 'operator', { id: second.id, role: 'admin' });
    await expect(domain.users.changeRole(second.id, 'operator', { id: second.id, role: 'admin' }))
      .rejects.toMatchObject({ code: 'LAST_ADMIN' });
  });

  it('refuses duplicate hashed codes and revocation of non-active invitations', async () => {
    const { domain } = await harness();
    const hash = '9'.repeat(64);
    await domain.invitationKeys.create(invitation('INV-DUP-1', 'operator', hash), {
      id: 'ADMIN-ISSUER', role: 'admin'
    });
    await expect(domain.invitationKeys.create(invitation('INV-DUP-2', 'operator', hash), {
      id: 'ADMIN-ISSUER', role: 'admin'
    })).rejects.toMatchObject({ code: 'DUPLICATE_INVITATION' });
    await domain.invitationKeys.revoke('INV-DUP-1', { id: 'ADMIN-ISSUER', role: 'admin' });
    await expect(domain.invitationKeys.revoke('INV-DUP-1', { id: 'ADMIN-ISSUER', role: 'admin' }))
      .rejects.toMatchObject({ code: 'INVITATION_NOT_ACTIVE' });
  });
});
