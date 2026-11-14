import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';
import supertest from 'supertest';

const require = createRequire(import.meta.url);
const { createFileAdapter } = require('../repository/file-adapter.js');
const bcrypt = require('bcryptjs');
const serverModule = require('../server.js');
let temporaryDirectory;

async function setup() {
  temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'velosupply-checkout-route-'));
  const adapter = createFileAdapter({
    filePath: path.join(temporaryDirectory, 'db.json'),
    loadInitial: async () => ({
      schemaVersion: 3,
      dataMode: 'test',
      users: [{
        id: 'USER-ADMIN', name: 'Demo Admin', email: 'admin@example.com',
        role: 'admin', passwordHash: await bcrypt.hash('AdminPassword123', 10),
        isActive: true, deletedAt: null
      }, {
        id: 'USER-OPS', name: 'Demo Operator', email: 'operator@example.com',
        role: 'operator', passwordHash: await bcrypt.hash('Operator123', 10),
        isActive: true, deletedAt: null
      }],
      warehouses: [{
        id: 'WH-KHI', code: 'HUB-KHI', name: 'Port Qasim Hub',
        city: 'Karachi', seedOrigin: true
      }],
      products: [{
        id: 'PROD-1', sku: 'SKU-1', name: 'Hybrid Solar Inverter',
        category: 'Power', priceExGstPkr: 1000, stock: 10,
        warehouse_hub: 'HUB-KHI', reorder_threshold: 2, status: 'optimal'
      }],
      stock: [],
      orders: [],
      orderItems: [],
      movements: [],
      tariffRules: [
        { id: 'T-GST', code: 'PK-GST', version: 1, ratePct: 18, source: 'demo-estimate' },
        { id: 'T-DEL', code: 'PK-DELIVERY-KARACHI', version: 1, amountPkr: 350, source: 'demo-estimate' },
        { id: 'T-FREE', code: 'PK-FREE-DELIVERY-THRESHOLD', version: 1, amountPkr: 150000, source: 'demo-estimate' }
      ],
      invoices: [],
      returns: [],
      auditLogs: [],
      idempotencyKeys: [],
      logs: [],
      newsletter: [],
      rewardClaims: [],
      metrics: { gmv24h: 0, activeOrders: 0, fulfillmentHealth: 0, packetsPerSec: 0, avgLatencyMs: 0, threatsBlocked: 0, detectionTimeMs: 0, efficiencyScore: 0, hubCapacities: [] },
      telemetry: { tick: 0, updatedAt: new Date().toISOString() },
      sre: { audit: [], incidents: [], alerts: [], healthChecks: [], loginAttempts: [] }
    })
  });
  await adapter.initialize();
  const state = await adapter.readState();
  serverModule.configureForTests(state, adapter);
  return { adapter };
}

afterEach(async () => {
  if (temporaryDirectory) await fs.rm(temporaryDirectory, { recursive: true, force: true });
  temporaryDirectory = null;
});

describe('Pakistan checkout HTTP route', () => {
  it('creates a PKR order, invoice, movements and separate order items through POST /api/checkout', async () => {
    const { adapter } = await setup();
    const payload = {
      customerName: 'Hira Javed',
      customerEmail: 'hira@example.com',
      city: 'Karachi',
      address: 'Block 7, Karachi',
      paymentMethod: 'COD',
      items: [{ sku: 'SKU-1', qty: 2 }]
    };
    const response = await supertest(serverModule.app)
      .post('/api/checkout')
      .set('Idempotency-Key', 'route-checkout-001')
      .send(payload);

    expect(response.status).toBe(201);
    expect(response.body.order).toMatchObject({
      city: 'Karachi', status: 'PLACED', paymentState: 'pending_cod', currency: 'PKR'
    });
    expect(response.body.order.price.totalMinor).toBe(271000);
    expect(response.body.invoice.orderId).toBe(response.body.order.id);
    expect(await adapter.count('orders')).toBe(1);
    expect(await adapter.count('orderItems', { orderId: response.body.order.id })).toBe(1);
    expect(await adapter.count('movements', { type: 'RESERVE' })).toBe(1);
    expect(await adapter.count('auditLogs', { action: 'order.create' })).toBe(1);
  });

  it('returns stored response for idempotent retry and 422 for a changed payload', async () => {
    await setup();
    const payload = {
      customerName: 'Hira Javed',
      customerEmail: 'hira@example.com',
      city: 'Karachi',
      address: 'Block 7, Karachi',
      paymentMethod: 'COD',
      items: [{ sku: 'SKU-1', qty: 2 }]
    };
    const first = await supertest(serverModule.app)
      .post('/api/checkout').set('Idempotency-Key', 'route-checkout-002').send(payload);
    const retry = await supertest(serverModule.app)
      .post('/api/checkout').set('Idempotency-Key', 'route-checkout-002').send(payload);
    const changed = await supertest(serverModule.app)
      .post('/api/checkout').set('Idempotency-Key', 'route-checkout-002')
      .send({ ...payload, items: [{ sku: 'SKU-1', qty: 3 }] });

    expect(first.status).toBe(201);
    expect(retry.status).toBe(201);
    expect(retry.body.order.id).toBe(first.body.order.id);
    expect(changed.status).toBe(422);
    expect(changed.body.error).toBe('KEY_REUSED');
  });

  it('routes stock adjustment through the ledger, enforces idempotency and audits the change', async () => {
    const { adapter } = await setup();
    const login = await supertest(serverModule.app)
      .post('/api/auth/login')
      .send({ email: 'operator@example.com', password: 'Operator123' });
    expect(login.status).toBe(200);

    const payload = { stock: 6, price: 1500, reason: 'cycle_count' };
    const first = await supertest(serverModule.app)
      .patch('/api/inventory/PROD-1')
      .set('Authorization', 'Bearer ' + login.body.token)
      .set('Idempotency-Key', 'adjust-route-001')
      .send(payload);
    expect(first.status).toBe(200);
    expect(first.body.product.stock).toBe(6);
    expect(first.body.product.priceExGstPkr).toBe(1500);

    const movements = await adapter.find('movements', { sku: 'SKU-1', hubCode: 'HUB-KHI' });
    expect(movements.map((movement) => movement.type)).toEqual(['RECEIVE', 'ADJUST']);
    expect((await adapter.find('stock', { sku: 'SKU-1', hubCode: 'HUB-KHI' }))[0]).toMatchObject({ onHand: 6, reserved: 0 });
    expect(await adapter.count('auditLogs', { action: 'inventory.adjust' })).toBe(1);

    const changedRetry = await supertest(serverModule.app)
      .patch('/api/inventory/PROD-1')
      .set('Authorization', 'Bearer ' + login.body.token)
      .set('Idempotency-Key', 'adjust-route-001')
      .send({ stock: 5, reason: 'cycle_count' });
    expect(changedRetry.status).toBe(422);
    expect(changedRetry.body.error).toBe('KEY_REUSED');
    expect(await adapter.count('movements', { sku: 'SKU-1', hubCode: 'HUB-KHI' })).toBe(2);
  });

  it('routes restock through a RECEIVE movement and synchronized stock projection', async () => {
    const { adapter } = await setup();
    const login = await supertest(serverModule.app)
      .post('/api/auth/login')
      .send({ email: 'operator@example.com', password: 'Operator123' });
    expect(login.status).toBe(200);

    const response = await supertest(serverModule.app)
      .post('/api/inventory/restock/PROD-1')
      .set('Authorization', 'Bearer ' + login.body.token)
      .set('Idempotency-Key', 'restock-route-001')
      .send({ quantity: 2 });

    expect(response.status).toBe(200);
    expect(response.body.product.stock).toBe(12);
    expect((await adapter.find('stock', { sku: 'SKU-1', hubCode: 'HUB-KHI' }))[0]).toMatchObject({ onHand: 12, reserved: 0 });
    expect(await adapter.count('movements', { type: 'RECEIVE', sku: 'SKU-1', hubCode: 'HUB-KHI' })).toBe(2);
    expect(await adapter.count('auditLogs', { action: 'inventory.restock' })).toBe(1);
  });

  it('registers a buyer in the users collection with explicit unverified filer status and audit', async () => {
    const { adapter } = await setup();
    const response = await supertest(serverModule.app)
      .post('/api/auth/register')
      .send({ name: 'New Buyer', email: 'newbuyer@example.com', password: 'Password123' });

    expect(response.status).toBe(201);
    expect(response.body.user).toMatchObject({ role: 'buyer', filerStatus: 'unverified', isActive: true });
    expect(await adapter.count('users', { email: 'newbuyer@example.com', role: 'buyer' })).toBe(1);
    expect(await adapter.count('auditLogs', { action: 'user.register' })).toBe(1);
  });

  it('soft-deletes accounts through repository operations without deleting order history', async () => {
    const { adapter } = await setup();
    await adapter.insert('orders', {
      id: 'ORDER-HISTORY-1', buyerId: 'USER-OPS', userId: 'USER-OPS',
      currency: 'PKR', totalMinor: 12000
    });
    const login = await supertest(serverModule.app)
      .post('/api/auth/login')
      .send({ email: 'admin@example.com', password: 'AdminPassword123' });
    expect(login.status).toBe(200);

    const deleted = await supertest(serverModule.app)
      .delete('/api/admin/users/USER-OPS')
      .set('Authorization', 'Bearer ' + login.body.token);
    expect(deleted.status).toBe(200);
    expect(await adapter.findById('users', 'USER-OPS')).toMatchObject({ isActive: false });
    expect(await adapter.count('orders', { userId: 'USER-OPS' })).toBe(1);

    const oldOperatorLogin = await supertest(serverModule.app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer ' + (await supertest(serverModule.app)
        .post('/api/auth/login').send({ email: 'operator@example.com', password: 'Operator123' })).body.token);
    expect(oldOperatorLogin.status).toBe(401);
  });

  it('rejects out-of-stock checkout without reserving or creating an order', async () => {
    const { adapter } = await setup();
    const response = await supertest(serverModule.app)
      .post('/api/checkout')
      .set('Idempotency-Key', 'route-checkout-003')
      .send({
        customerName: 'Hira Javed',
        customerEmail: 'hira@example.com',
        city: 'Karachi',
        address: 'Block 7, Karachi',
        paymentMethod: 'COD',
        items: [{ sku: 'SKU-1', qty: 20 }]
      });
    expect(response.status).toBe(409);
    expect(response.body.error).toBe('OUT_OF_STOCK');
    expect(await adapter.count('orders')).toBe(0);
    expect(await adapter.count('movements')).toBe(0);
    expect((await adapter.find('stock', { sku: 'SKU-1', hubCode: 'HUB-KHI' }))[0].reserved).toBe(0);
  });
});
