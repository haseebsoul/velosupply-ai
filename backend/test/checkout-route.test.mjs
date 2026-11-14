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

async function setup(dataMode = 'test') {
  temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'velosupply-checkout-route-'));
  const adapter = createFileAdapter({
    filePath: path.join(temporaryDirectory, 'db.json'),
    loadInitial: async () => ({
      schemaVersion: 3,
      dataMode,
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
      }, {
        id: 'WH-LHE', code: 'HUB-LHE', name: 'Sundar Hub',
        city: 'Lahore', seedOrigin: true
      }],
      products: [{
        id: 'PROD-1', sku: 'SKU-1', name: 'Hybrid Solar Inverter',
        category: 'Power', priceExGstPkr: 1000, stock: 10, supplierId: 'SUP-1', leadDays: 7,
        warehouse_hub: 'HUB-KHI', reorder_threshold: 2, status: 'optimal'
      }],
      stock: [],
      suppliers: [{ id: 'SUP-1', name: 'Demo Supplier', city: 'Karachi', leadDays: 7, reliabilityScore: 90, status: 'active', demoRecord: true }],
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
  it('requires a buyer session for production checkout while demo guest checkout remains compatible', async () => {
    const { adapter } = await setup('production');
    const response = await supertest(serverModule.app)
      .post('/api/checkout')
      .set('Idempotency-Key', 'production-guest-checkout-001')
      .send({
        customerName: 'Guest Buyer',
        customerEmail: 'guest@example.com',
        city: 'Karachi',
        address: 'Block 7, Karachi',
        paymentMethod: 'COD',
        items: [{ sku: 'SKU-1', qty: 1 }]
      });
    expect(response.status).toBe(401);
    expect(response.body.error).toBe('Buyer authentication is required for production checkout');
    expect(await adapter.count('orders')).toBe(0);
  });

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

  it('creates a draft restock PO and only receives inventory after approve, ship and receive', async () => {
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

    expect(response.status).toBe(201);
    const po = response.body.purchaseOrder;
    expect(po).toMatchObject({ status: 'draft', supplierId: 'SUP-1', hubCode: 'HUB-KHI', totalPkr: 2000 });
    expect(po.lines).toEqual([expect.objectContaining({ sku: 'SKU-1', qty: 2 })]);
    expect((await adapter.find('stock', { sku: 'SKU-1', hubCode: 'HUB-KHI' }))[0]).toMatchObject({ onHand: 10, reserved: 0 });
    expect(await adapter.count('movements', { sku: 'SKU-1', hubCode: 'HUB-KHI' })).toBe(0);

    const approved = await supertest(serverModule.app)
      .patch('/api/purchase-orders/' + po.id + '/status')
      .set('Authorization', 'Bearer ' + login.body.token)
      .set('Idempotency-Key', 'po-approve-001')
      .send({ status: 'approved' });
    expect(approved.status).toBe(200);
    const shipped = await supertest(serverModule.app)
      .patch('/api/purchase-orders/' + po.id + '/status')
      .set('Authorization', 'Bearer ' + login.body.token)
      .set('Idempotency-Key', 'po-ship-001')
      .send({ status: 'shipped' });
    expect(shipped.status).toBe(200);
    const received = await supertest(serverModule.app)
      .patch('/api/purchase-orders/' + po.id + '/status')
      .set('Authorization', 'Bearer ' + login.body.token)
      .set('Idempotency-Key', 'po-receive-001')
      .send({ status: 'received' });

    expect(received.status).toBe(200);
    expect((await adapter.find('stock', { sku: 'SKU-1', hubCode: 'HUB-KHI' }))[0]).toMatchObject({ onHand: 12, reserved: 0 });
    const movements = await adapter.find('movements', { sku: 'SKU-1', hubCode: 'HUB-KHI' });
    expect(movements.map((movement) => movement.type)).toEqual(['RECEIVE', 'RECEIVE']);
    expect(movements[1]).toMatchObject({ qty: 2, reason: 'purchase_order_received', refId: po.id });
    expect(await adapter.count('auditLogs', { action: 'purchase_order.create' })).toBe(1);
    expect(await adapter.count('auditLogs', { action: 'purchase_order.received' })).toBe(1);
  });

  it('registers a buyer in the users collection with explicit unverified filer status and audit', async () => {
    const { adapter } = await setup();
    const response = await supertest(serverModule.app)
      .post('/api/auth/register')
      .send({ name: 'New Buyer', email: 'newbuyer@example.com', password: 'Password123' });

    expect(response.status).toBe(201);
    expect(response.body.user).toMatchObject({ role: 'user', filerStatus: 'unverified', isActive: true });
    expect(await adapter.count('users', { email: 'newbuyer@example.com', role: 'buyer' })).toBe(1);
    expect(await adapter.count('auditLogs', { action: 'user.register' })).toBe(1);
  });

  it('soft-deletes accounts through repository operations without deleting order history', async () => {
    const { adapter } = await setup();
    await adapter.insert('orders', {
      id: 'ORDER-HISTORY-1', buyerId: 'USER-OPS', userId: 'USER-OPS',
      currency: 'PKR', totalMinor: 12000
    });
    const operatorLogin = await supertest(serverModule.app)
      .post('/api/auth/login')
      .send({ email: 'operator@example.com', password: 'Operator123' });
    const adminLogin = await supertest(serverModule.app)
      .post('/api/auth/login')
      .send({ email: 'admin@example.com', password: 'AdminPassword123' });
    expect(operatorLogin.status).toBe(200);
    expect(adminLogin.status).toBe(200);

    const deleted = await supertest(serverModule.app)
      .delete('/api/admin/users/USER-OPS')
      .set('Authorization', 'Bearer ' + adminLogin.body.token);
    expect(deleted.status).toBe(200);
    expect(await adapter.findById('users', 'USER-OPS')).toMatchObject({ isActive: false });
    expect(await adapter.count('orders', { userId: 'USER-OPS' })).toBe(1);

    const revokedSession = await supertest(serverModule.app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer ' + operatorLogin.body.token);
    expect(revokedSession.status).toBe(401);
  });

  it('routes hub transfer through paired ledger events and updates both stock rows', async () => {
    const { adapter } = await setup();
    const login = await supertest(serverModule.app)
      .post('/api/auth/login')
      .send({ email: 'operator@example.com', password: 'Operator123' });
    expect(login.status).toBe(200);

    const response = await supertest(serverModule.app)
      .post('/api/inventory/transfer')
      .set('Authorization', 'Bearer ' + login.body.token)
      .set('Idempotency-Key', 'transfer-route-001')
      .send({
        sku: 'SKU-1',
        fromHubCode: 'HUB-KHI',
        toHubCode: 'HUB-LHE',
        quantity: 3,
        reason: 'hub_rebalance'
      });

    expect(response.status).toBe(201);
    expect(response.body.transfer.transferOut.type).toBe('TRANSFER_OUT');
    expect(response.body.transfer.transferIn.type).toBe('TRANSFER_IN');
    expect(await adapter.findById('stock', 'SKU-1:HUB-KHI')).toMatchObject({ onHand: 7, reserved: 0 });
    expect(await adapter.findById('stock', 'SKU-1:HUB-LHE')).toMatchObject({ onHand: 3, reserved: 0 });
    expect(await adapter.count('movements', { refId: response.body.transfer.refId })).toBe(2);
    expect(await adapter.count('auditLogs', { action: 'inventory.transfer' })).toBe(1);
  });

  it('cancels an HTTP checkout by releasing the original reservation', async () => {
    const { adapter } = await setup();
    const checkout = await supertest(serverModule.app)
      .post('/api/checkout')
      .set('Idempotency-Key', 'cancel-route-checkout-001')
      .send({
        customerName: 'Hira Javed',
        customerEmail: 'hira@example.com',
        city: 'Karachi',
        address: 'Block 7, Karachi',
        paymentMethod: 'COD',
        items: [{ sku: 'SKU-1', qty: 2 }]
      });
    expect(checkout.status).toBe(201);

    const admin = await supertest(serverModule.app)
      .post('/api/auth/login')
      .send({ email: 'admin@example.com', password: 'AdminPassword123' });
    expect(admin.status).toBe(200);

    const response = await supertest(serverModule.app)
      .post('/api/orders/' + checkout.body.order.id + '/cancel')
      .set('Authorization', 'Bearer ' + admin.body.token)
      .set('Idempotency-Key', 'cancel-route-order-001')
      .send({});

    expect(response.status).toBe(200);
    expect(response.body.order.status).toBe('CANCELLED');
    expect((await adapter.find('stock', { sku: 'SKU-1', hubCode: 'HUB-KHI' }))[0]).toMatchObject({ onHand: 10, reserved: 0 });
    expect(await adapter.count('movements', { type: 'RELEASE', refId: checkout.body.order.id })).toBe(1);
    expect(await adapter.count('auditLogs', { action: 'order.cancel' })).toBe(1);
  });

  it('exposes only the buyer own orders and invoices through /api/me routes', async () => {
    const { adapter } = await setup();
    const registered = await supertest(serverModule.app)
      .post('/api/auth/register')
      .send({
        name: 'Hira Javed',
        email: 'hira@example.com',
        role: 'buyer',
        password: 'BuyerPassword123'
      });
    expect(registered.status).toBe(201);
    const token = registered.body.token;

    const checkout = await supertest(serverModule.app)
      .post('/api/checkout')
      .set('Authorization', 'Bearer ' + token)
      .set('Idempotency-Key', 'buyer-order-001')
      .send({
        customerName: 'Hira Javed',
        customerEmail: 'hira@example.com',
        city: 'Karachi',
        address: 'Block 7, Karachi',
        paymentMethod: 'COD',
        items: [{ sku: 'SKU-1', qty: 1 }]
      });
    expect(checkout.status).toBe(201);

    const orders = await supertest(serverModule.app)
      .get('/api/me/orders')
      .set('Authorization', 'Bearer ' + token);
    expect(orders.status).toBe(200);
    expect(orders.body).toHaveLength(1);
    expect(orders.body[0].id).toBe(checkout.body.order.id);

    const orderDetail = await supertest(serverModule.app)
      .get('/api/me/orders/' + checkout.body.order.id)
      .set('Authorization', 'Bearer ' + token);
    expect(orderDetail.status).toBe(200);
    const invoices = await supertest(serverModule.app)
      .get('/api/me/invoices')
      .set('Authorization', 'Bearer ' + token);
    expect(invoices.status).toBe(200);
    expect(invoices.body).toHaveLength(1);

    const invoiceDetail = await supertest(serverModule.app)
      .get('/api/me/invoices/' + invoices.body[0].id)
      .set('Authorization', 'Bearer ' + token);
    expect(invoiceDetail.status).toBe(200);
    expect(invoiceDetail.body.invoice.orderId).toBe(checkout.body.order.id);
    expect(await adapter.count('invoices', { buyerId: registered.body.user.id })).toBe(1);

    const logsAccess = await supertest(serverModule.app)
      .get('/api/logs')
      .set('Authorization', 'Bearer ' + token);
    const threatsAccess = await supertest(serverModule.app)
      .get('/api/threats')
      .set('Authorization', 'Bearer ' + token);
    expect(logsAccess.status).toBe(403);
    expect(threatsAccess.status).toBe(403);

    const cancelled = await supertest(serverModule.app)
      .post('/api/me/orders/' + checkout.body.order.id + '/cancel')
      .set('Authorization', 'Bearer ' + token)
      .set('Idempotency-Key', 'buyer-cancel-001')
      .send({});
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.order.status).toBe('CANCELLED');
    expect(await adapter.count('movements', { type: 'RELEASE', refId: checkout.body.order.id })).toBe(1);
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
