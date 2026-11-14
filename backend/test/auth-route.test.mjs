import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';
import supertest from 'supertest';

const require = createRequire(import.meta.url);
const { createFileAdapter } = require('../repository/file-adapter.js');
const { createDomainRepositories } = require('../repository/domain-repositories.js');
const jwt = require('jsonwebtoken');
const serverModule = require('../server.js');

let temporaryDirectory;
let adminToken;
let adapter;

async function setup() {
  temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'velosupply-auth-route-'));
  adapter = createFileAdapter({
    filePath: path.join(temporaryDirectory, 'db.json'),
    loadInitial: async () => ({
      schemaVersion: 3,
      dataMode: 'test',
      users: [{
        id: 'ADMIN-1',
        name: 'Test Administrator',
        email: 'admin@example.com',
        role: 'admin',
        passwordHash: 'not-used-by-admin-bearer-tests',
        isActive: true,
        deletedAt: null
      }],
      warehouses: [],
      products: [],
      orders: [],
      orderItems: [],
      stock: [],
      movements: [],
      tariffRules: [],
      invoices: [],
      returns: [],
      refunds: [],
      payments: [],
      auditLogs: [],
      idempotencyKeys: [],
      loginAttempts: [],
      newsletter: [],
      rewardClaims: [],
      metrics: { gmv24h: 0, activeOrders: 0, fulfillmentHealth: 0, packetsPerSec: 0, avgLatencyMs: 0, threatsBlocked: 0, detectionTimeMs: 0, efficiencyScore: 0, hubCapacities: [] },
      telemetry: { tick: 0, updatedAt: new Date().toISOString() },
      sre: { audit: [], incidents: [], alerts: [], healthChecks: [], loginAttempts: [] }
    })
  });
  await adapter.initialize();
  process.env.ADMIN_REGISTRATION_KEY = 'test-admin-invite';
  process.env.OPERATOR_REGISTRATION_KEY = 'test-operator-invite';
  serverModule.configureForTests(await adapter.readState(), adapter);
  serverModule.app.set('trust proxy', true);
  adminToken = jwt.sign({ sub: 'ADMIN-1', role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  process.env.ADMIN_REGISTRATION_KEY = 'test-admin-invite';
  process.env.OPERATOR_REGISTRATION_KEY = 'test-operator-invite';
  return { adapter, adminToken };
}

function forwarded(request, value = '192.0.2.44') {
  return request.set('X-Forwarded-For', value);
}

async function registerBuyer(email = 'buyer@example.com') {
  return forwarded(supertest(serverModule.app).post('/api/auth/register'))
    .send({
      name: 'Test Buyer',
      email,
      role: 'user',
      password: 'BuyerPass123'
    });
}

afterEach(async () => {
  if (temporaryDirectory) await fs.rm(temporaryDirectory, { recursive: true, force: true });
  temporaryDirectory = null;
  process.env.ADMIN_REGISTRATION_KEY = '';
  process.env.OPERATOR_REGISTRATION_KEY = '';
});

describe('collection-backed authentication and account routes', () => {
  it('registers a frontend-compatible buyer as the buyer domain role and audits it', async () => {
    const { adapter } = await setup();
    const response = await registerBuyer();

    expect(response.status).toBe(201);
    expect(response.body.user).toMatchObject({
      email: 'buyer@example.com',
      role: 'user'
    });
    expect(response.body.token).toBeTruthy();

    const stored = await adapter.find('users', { email: 'buyer@example.com' });
    expect(stored).toHaveLength(1);
    expect(stored[0].role).toBe('buyer');
    expect(stored[0].filerStatus).toBe('unverified');
    expect(stored[0].passwordHash).not.toBe('BuyerPass123');
    expect(await adapter.count('auditLogs', { action: 'user.register', targetId: stored[0].id })).toBe(1);
  });

  it('serves the administrator user list from the users collection without password hashes', async () => {
    const { adapter, adminToken } = await setup();
    const registered = await registerBuyer();
    expect(registered.status).toBe(201);

    const response = await forwarded(supertest(serverModule.app).get('/api/admin/users'))
      .set('Authorization', 'Bearer ' + adminToken);
    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(2);
    expect(response.body.map((user) => user.email).sort()).toEqual(['admin@example.com', 'buyer@example.com']);
    expect(response.body.every((user) => !Object.prototype.hasOwnProperty.call(user, 'passwordHash'))).toBe(true);
    expect(response.body.find((user) => user.email === 'buyer@example.com').role).toBe('user');

    expect(await adapter.count('users')).toBe(2);
  });

  it('enforces invitation keys and the single-administrator rule inside the repository transaction', async () => {
    await setup();

    const missingInvite = await forwarded(supertest(serverModule.app).post('/api/auth/register'))
      .send({
        name: 'Another Admin',
        email: 'admin2@example.com',
        role: 'admin',
        password: 'AdminPass123'
      });
    expect(missingInvite.status).toBe(403);

    const secondAdmin = await forwarded(supertest(serverModule.app).post('/api/auth/register'))
      .send({
        name: 'Another Admin',
        email: 'admin2@example.com',
        role: 'admin',
        password: 'AdminPass123',
        registrationInviteCode: 'test-admin-invite'
      });
    expect(secondAdmin.status).toBe(409);
    expect(secondAdmin.body.error).toBe('ADMIN_EXISTS');

    const operator = await forwarded(supertest(serverModule.app).post('/api/auth/register'))
      .send({
        name: 'Operations User',
        email: 'operator@example.com',
        role: 'operator',
        password: 'OperatorPass123',
        registrationInviteCode: 'test-operator-invite'
      });
    expect(operator.status).toBe(201);
    expect(operator.body.user.role).toBe('operator');
    expect(await adapter.count('users', { role: 'admin' })).toBe(1);
    expect(await adapter.count('users', { role: 'operator' })).toBe(1);
  });

  it('persists failed login attempts, locks after five failures and clears attempts on success', async () => {
    const { adapter } = await setup();
    const registered = await registerBuyer('lockout@example.com');
    expect(registered.status).toBe(201);

    for (let index = 0; index < 5; index += 1) {
      const failed = await forwarded(supertest(serverModule.app).post('/api/auth/login'), '192.0.2.55')
        .send({ email: 'lockout@example.com', password: 'WrongPassword123' });
      expect(failed.status).toBe(401);
    }
    expect(await adapter.count('loginAttempts', { email: 'lockout@example.com' })).toBe(5);

    const locked = await forwarded(supertest(serverModule.app).post('/api/auth/login'), '192.0.2.55')
      .send({ email: 'lockout@example.com', password: 'BuyerPass123' });
    expect(locked.status).toBe(423);

    const other = await registerBuyer('recovery@example.com');
    expect(other.status).toBe(201);
    const failedOnce = await forwarded(supertest(serverModule.app).post('/api/auth/login'), '192.0.2.56')
      .send({ email: 'recovery@example.com', password: 'WrongPassword123' });
    expect(failedOnce.status).toBe(401);

    const success = await forwarded(supertest(serverModule.app).post('/api/auth/login'), '192.0.2.56')
      .send({ email: 'recovery@example.com', password: 'BuyerPass123' });
    expect(success.status).toBe(200);
    expect(success.body.user.role).toBe('user');
    expect(await adapter.count('loginAttempts', { email: 'recovery@example.com' })).toBe(0);
    expect(await adapter.count('auditLogs', { action: 'user.login' })).toBe(1);
  });

  it('blocks demoting or deleting the last administrator and persists administrative audit events', async () => {
    const { adapter, adminToken } = await setup();
    const demote = await forwarded(supertest(serverModule.app).patch('/api/admin/users/ADMIN-1'))
      .set('Authorization', 'Bearer ' + adminToken)
      .send({ role: 'user' });
    expect(demote.status).toBe(400);
    const remove = await forwarded(supertest(serverModule.app).delete('/api/admin/users/ADMIN-1'))
      .set('Authorization', 'Bearer ' + adminToken);
    expect(remove.status).toBe(400); // self-delete is rejected before the last-admin repository guard

    const domain = createDomainRepositories(adapter);
    await expect(domain.users.changeRole('ADMIN-1', 'buyer', { id: 'SUPPORT-ADMIN', role: 'admin' }))
      .rejects.toMatchObject({ code: 'LAST_ADMIN' });
    await expect(domain.users.softDelete('ADMIN-1', { id: 'SUPPORT-ADMIN', role: 'admin' }))
      .rejects.toMatchObject({ code: 'LAST_ADMIN' });
    expect(await adapter.count('users', { role: 'admin', isActive: true })).toBe(1);
  });

  it('revokes a deleted buyer token on the next request by reading the persisted account', async () => {
    const { adminToken, adapter } = await setup();
    const registered = await registerBuyer('revoked@example.com');
    expect(registered.status).toBe(201);
    const buyerId = registered.body.user.id;

    const deletion = await forwarded(supertest(serverModule.app).delete('/api/admin/users/' + buyerId))
      .set('Authorization', 'Bearer ' + adminToken);
    expect(deletion.status).toBe(200);
    expect(deletion.body.user.isActive).toBe(false);

    const revokedRequest = await forwarded(supertest(serverModule.app).get('/api/orders'))
      .set('Authorization', 'Bearer ' + registered.body.token);
    expect(revokedRequest.status).toBe(401);
    expect(revokedRequest.body.error).toBe('Invalid or expired token');

    const suspended = await registerBuyer('suspended@example.com');
    expect(suspended.status).toBe(201);
    await adapter.update('users', suspended.body.user.id, { status: 'suspended' });
    const suspendedRequest = await forwarded(supertest(serverModule.app).get('/api/orders'))
      .set('Authorization', 'Bearer ' + suspended.body.token);
    expect(suspendedRequest.status).toBe(401);
    expect(suspendedRequest.body.error).toBe('Invalid or expired token');
  });
});
