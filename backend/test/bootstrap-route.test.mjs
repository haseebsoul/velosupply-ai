import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';
import supertest from 'supertest';

const require = createRequire(import.meta.url);
const { createFileAdapter } = require('../repository/file-adapter.js');
const serverModule = require('../server.js');

let temporaryDirectory;

async function setup(users = []) {
  temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'velosupply-bootstrap-route-'));
  const adapter = createFileAdapter({
    filePath: path.join(temporaryDirectory, 'db.json'),
    loadInitial: async () => ({
      schemaVersion: 3,
      dataMode: 'test',
      users,
      invitations: [],
      products: [],
      warehouses: [],
      suppliers: [],
      stock: [],
      orders: [],
      orderItems: [],
      movements: [],
      purchaseOrders: [],
      tariffRules: [],
      invoices: [],
      returns: [],
      auditLogs: [],
      idempotencyKeys: [],
      loginAttempts: [],
      healthChecks: [],
      logs: [],
      newsletter: [],
      rewardClaims: [],
      messages: [],
      alerts: [],
      incidents: [],
      settings: [],
      metrics: { gmv24h: 0, activeOrders: 0, fulfillmentHealth: 0, packetsPerSec: 0, avgLatencyMs: 0, threatsBlocked: 0, detectionTimeMs: 0, efficiencyScore: 0, hubCapacities: [] },
      telemetry: { tick: 0, updatedAt: new Date().toISOString() },
      sre: { audit: [], incidents: [], alerts: [], healthChecks: [], loginAttempts: [] }
    })
  });
  await adapter.initialize();
  serverModule.configureForTests(await adapter.readState(), adapter);
  return adapter;
}

afterEach(async () => {
  if (temporaryDirectory) await fs.rm(temporaryDirectory, { recursive: true, force: true });
  temporaryDirectory = null;
});

describe('administrator bootstrap and role registration', () => {
  it('reports that initial Administrator setup is available when no active Admin exists', async () => {
    await setup();
    const response = await supertest(serverModule.app).get('/api/auth/bootstrap-status');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ hasAdmin: false, adminExists: false });
  });

  it('creates the first Administrator without a key and prevents a second Administrator', async () => {
    const adapter = await setup();
    const payload = {
      name: 'Workspace Owner',
      email: 'owner@example.com',
      password: 'OwnerPassword123',
      role: 'admin'
    };
    const first = await supertest(serverModule.app).post('/api/auth/register').send(payload);
    expect(first.status).toBe(201);
    expect(first.body.user.role).toBe('admin');
    expect(first.body.token).toEqual(expect.any(String));
    expect(await adapter.count('users', { role: 'admin', isActive: true })).toBe(1);

    const status = await supertest(serverModule.app).get('/api/auth/bootstrap');
    expect(status.status).toBe(200);
    expect(status.body).toEqual({ hasAdmin: true, adminExists: true });

    const second = await supertest(serverModule.app).post('/api/auth/register').send({
      ...payload,
      email: 'second-admin@example.com',
      registrationInviteCode: 'not-a-valid-public-admin-key'
    });
    expect(second.status).toBe(409);
    expect(second.body.error).toBe('ADMIN_EXISTS');
    expect(await adapter.count('users', { role: 'admin', isActive: true })).toBe(1);
  });

  it('keeps Buyer registration public and Operations registration invitation-only', async () => {
    await setup();
    const buyer = await supertest(serverModule.app).post('/api/auth/register').send({
      name: 'Buyer Account',
      email: 'buyer@example.com',
      password: 'BuyerPassword123',
      role: 'buyer'
    });
    expect(buyer.status).toBe(201);
    expect(buyer.body.user.role).toBe('buyer');

    const operator = await supertest(serverModule.app).post('/api/auth/register').send({
      name: 'Operations Account',
      email: 'operator@example.com',
      password: 'OperatorPassword123',
      role: 'operator'
    });
    expect(operator.status).toBe(403);
    expect(operator.body.error).toContain('invitation key');
  });

  it('does not expose any invitation secret from the public bootstrap status', async () => {
    await setup();
    const response = await supertest(serverModule.app).get('/api/auth/bootstrap-status');
    expect(response.status).toBe(200);
    expect(Object.keys(response.body).sort()).toEqual(['adminExists', 'hasAdmin']);
  });
});


describe('public Pakistan storefront data routes', () => {
  it('returns the SRS ROI estimate using the documented default assumptions', async () => {
    await setup();
    const response = await supertest(serverModule.app)
      .post('/api/public/roi')
      .send({
        orders: 100,
        avgOrderValuePkr: 20000,
        stockoutRatePct: 10,
        hoursPerDay: 1,
        hubs: 2
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      currency: 'PKR',
      monthlyRevenuePkr: 2000000,
      lostToStockoutsPkr: 200000,
      recoveredPkr: 130000,
      loadSheddingLossPkr: 21000,
      savedByQueuePkr: 8400,
      monthlyBenefitPkr: 138400,
      hoursSaved: 24,
      assumptions: {
        stockoutRecoveryFactor: 0.65,
        loadSheddingSavingsFactor: 0.4,
        idleStaffCostPerHourPkr: 350,
        growthPlanPricePkr: 39900
      }
    });
    expect(response.body.paybackMonths).toBeCloseTo(39900 / 138400);
  });

  it('rejects invalid ROI inputs rather than returning a fabricated estimate', async () => {
    await setup();
    const response = await supertest(serverModule.app)
      .post('/api/public/roi')
      .send({
        orders: -1,
        avgOrderValuePkr: 20000,
        stockoutRatePct: 10,
        hoursPerDay: 1,
        hubs: 2
      });
    expect(response.status).toBe(400);
  });

  it('returns honest empty workspace stats without fabricated catalog or activity records', async () => {
    await setup();
    const response = await supertest(serverModule.app).get('/api/public/stats');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      currency: 'PKR',
      unitsTracked: 0,
      gmv24hPkr: 0,
      activeOrders: 0,
      ordersFulfilledThisMonth: 0,
      onTimeDispatchRate: null,
      warehouses: [],
      activity: []
    });
  });
});
