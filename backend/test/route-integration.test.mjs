import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';
import supertest from 'supertest';

process.env.JWT_SECRET = 'velosupply-route-integration-test-secret-2026';
const require = createRequire(import.meta.url);
const jwt = require('jsonwebtoken');
const { createFileAdapter } = require('../repository/file-adapter.js');
const server = require('../server.js');
let tempDir;

const admin = { id: 'ADMIN-1', name: 'Admin', email: 'admin@example.com', role: 'admin', isActive: true, passwordHash: 'unused' };
const buyer = { id: 'BUYER-1', name: 'Buyer', email: 'buyer@example.com', role: 'buyer', filerStatus: 'unverified', isActive: true, passwordHash: 'unused' };
const adminAuth = { Authorization: 'Bearer ' + jwt.sign({ sub: admin.id, role: admin.role }, process.env.JWT_SECRET) };
const buyerAuth = { Authorization: 'Bearer ' + jwt.sign({ sub: buyer.id, role: buyer.role }, process.env.JWT_SECRET) };

async function setup() {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'velosupply-routes-'));
  const products = [
    { id: 'PROD-1', sku: 'SKU-1', name: 'Hybrid Solar Inverter', category: 'Power', description: 'Test product one', priceExGstPkr: 1000, stock: 10, reorder_threshold: 2, warehouse_hub: 'HUB-KHI', originWarehouseId: 'WH-KHI', status: 'optimal' },
    { id: 'PROD-2', sku: 'SKU-2', name: 'Battery Controller', category: 'Power', description: 'Test product two', priceExGstPkr: 1200, stock: 10, reorder_threshold: 2, warehouse_hub: 'HUB-KHI', originWarehouseId: 'WH-KHI', status: 'optimal' }
  ];
  const adapter = createFileAdapter({
    filePath: path.join(tempDir, 'db.json'),
    loadInitial: async () => ({
      schemaVersion: 3, dataMode: 'test',
      users: [admin, buyer],
      warehouses: [{ id: 'WH-KHI', code: 'HUB-KHI', name: 'Karachi Hub', city: 'Karachi', status: 'online', capacity: 1000, latency: 10, seedOrigin: false }],
      products,
      stock: products.map((p) => ({ id: p.sku + ':HUB-KHI', sku: p.sku, hubCode: 'HUB-KHI', onHand: p.stock, reserved: 0 })),
      orders: [], orderItems: [], movements: [], tariffRules: [
        { id: 'T-GST', code: 'PK-GST', version: 1, ratePct: 18, source: 'demo-estimate' },
        { id: 'T-DEL', code: 'PK-DELIVERY-KARACHI', version: 1, amountPkr: 350, source: 'demo-estimate' },
        { id: 'T-FREE', code: 'PK-FREE-DELIVERY-THRESHOLD', version: 1, amountPkr: 150000, source: 'demo-estimate' }
      ],
      invoices: [], returns: [], refunds: [], auditLogs: [], idempotencyKeys: [],
      logs: [], newsletter: [], rewardClaims: [],
      metrics: { gmv24h: 0, activeOrders: 0, fulfillmentHealth: 0, packetsPerSec: 0, avgLatencyMs: 0, threatsBlocked: 0, detectionTimeMs: 0, efficiencyScore: 0, hubCapacities: [] },
      telemetry: { tick: 0, updatedAt: new Date().toISOString() },
      sre: { audit: [], incidents: [], alerts: [], healthChecks: [], loginAttempts: [] }
    })
  });
  await adapter.initialize();
  server.configureForTests(await adapter.readState(), adapter);
  return { adapter };
}
afterEach(async () => {
  if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
  tempDir = null;
});
async function placeOrder(items = [{ sku: 'SKU-1', qty: 2 }], key = 'order-' + Date.now() + '-' + Math.random()) {
  return supertest(server.app).post('/api/checkout').set(buyerAuth).set('Idempotency-Key', key).send({
    customerName: buyer.name, customerEmail: buyer.email, city: 'Karachi', address: 'Block 7, Karachi',
    paymentMethod: 'COD', items
  });
}

describe('collection-backed catalog and warehouse routes', () => {
  it('creates, updates, adjusts stock and archives a product with movement/audit history', async () => {
    const { adapter } = await setup();
    const denied = await supertest(server.app).post('/api/admin/products').send({});
    expect(denied.status).toBe(401);

    const created = await supertest(server.app).post('/api/admin/products').set(adminAuth).send({
      sku: 'SKU-NEW', batchHash: 'a'.repeat(64), originWarehouseId: 'WH-KHI',
      name: 'New Power Module', category: 'Power', description: 'Created through route',
      priceExGstPkr: 2500, initialStock: 4, reorder_threshold: 1
    });
    expect(created.status).toBe(201);
    const id = created.body.product.id;
    expect(created.body.product.stock).toBe(4);
    expect(await adapter.count('stock', { sku: 'SKU-NEW', hubCode: 'HUB-KHI' })).toBe(1);
    expect(await adapter.count('movements', { sku: 'SKU-NEW', type: 'RECEIVE' })).toBe(1);
    expect(await adapter.count('auditLogs', { action: 'product.create' })).toBe(1);

    const updated = await supertest(server.app).patch('/api/admin/products/' + id).set(adminAuth)
      .send({ priceExGstPkr: 2700, reorder_threshold: 5 });
    expect(updated.status).toBe(200);
    expect(updated.body.product).toMatchObject({ priceExGstPkr: 2700, reorder_threshold: 5 });

    const stockUpdate = await supertest(server.app).patch('/api/inventory/' + id).set(adminAuth)
      .set('Idempotency-Key', 'route-stock-adjust-1')
      .send({ stock: 6, reason: 'cycle_count', priceExGstPkr: 2750 });
    expect(stockUpdate.status).toBe(200);
    expect(stockUpdate.body.product).toMatchObject({ stock: 6, priceExGstPkr: 2750 });
    expect(await adapter.count('movements', { sku: 'SKU-NEW', type: 'ADJUST' })).toBe(1);
    expect(await adapter.count('auditLogs', { action: 'inventory.adjust' })).toBe(1);

    const archived = await supertest(server.app).delete('/api/admin/products/' + id).set(adminAuth);
    expect(archived.status).toBe(200);
    expect((await adapter.findById('products', id)).archivedAt).toBeTruthy();
    expect((await supertest(server.app).get('/api/products')).body.some((p) => p.id === id)).toBe(false);
    expect((await supertest(server.app).get('/api/admin/products?includeArchived=true').set(adminAuth)).body.some((p) => p.id === id)).toBe(true);
    expect(await adapter.count('auditLogs', { action: 'product.update' })).toBe(1);
    expect(await adapter.count('auditLogs', { action: 'product.archive' })).toBe(1);
  });

  it('creates and updates warehouses through their domain repository with audit entries', async () => {
    const { adapter } = await setup();
    const created = await supertest(server.app).post('/api/admin/warehouses').set(adminAuth).send({
      code: 'HUB-LHE', name: 'Lahore Hub', city: 'Lahore', status: 'online', capacity: 500, latency: 15
    });
    expect(created.status).toBe(201);
    const id = created.body.warehouse.id;
    const updated = await supertest(server.app).patch('/api/admin/warehouses/' + id).set(adminAuth)
      .send({ status: 'degraded', capacity: 600 });
    expect(updated.status).toBe(200);
    expect(updated.body.warehouse).toMatchObject({ status: 'degraded', capacity: 600 });
    expect(await adapter.count('auditLogs', { action: 'warehouse.create' })).toBe(1);
    expect(await adapter.count('auditLogs', { action: 'warehouse.update' })).toBe(1);
  });
});

describe('collection-backed order lifecycle, rollback and refund status', () => {
  it('places, reserves, assigns a warehouse, confirms, ships and delivers, then records a simulated refund decision', async () => {
    const { adapter } = await setup();
    const placed = await placeOrder();
    expect(placed.status).toBe(201);
    const orderId = placed.body.order.id;
    expect(placed.body.order.status).toBe('PLACED');
    expect(await adapter.count('movements', { type: 'RESERVE', refId: orderId })).toBe(1);

    const routed = await supertest(server.app).post('/api/orders/' + orderId + '/route').set(adminAuth);
    expect(routed.status).toBe(200);
    expect(routed.body.order.warehouse_hub).toBe('HUB-KHI');
    expect(await adapter.count('auditLogs', { action: 'order.route' })).toBe(1);

    for (const status of ['CONFIRMED', 'PICKING', 'PACKED', 'DISPATCHED', 'DELIVERED']) {
      const response = await supertest(server.app).patch('/api/orders/' + orderId + '/status')
        .set(adminAuth).send({ status });
      expect(response.status).toBe(200);
      expect(response.body.order.status).toBe(status);
    }
    expect((await adapter.findById('orders', orderId)).paymentState).toBe('paid');
    expect(await adapter.count('movements', { type: 'SHIP', refId: orderId })).toBe(1);
    expect(await adapter.findById('stock', 'SKU-1:HUB-KHI')).toMatchObject({ onHand: 8, reserved: 0 });

    const request = await supertest(server.app).post('/api/orders/' + orderId + '/refunds').set(buyerAuth)
      .set('Idempotency-Key', 'refund-route-1').send({ reason: 'Warranty return' });
    expect(request.status).toBe(201);
    expect(request.body).toMatchObject({
      simulated: true,
      refund: { status: 'requested', currency: 'PKR', simulated: true, providerStatus: 'not_configured' }
    });
    const refundId = request.body.refund.id;
    const decision = await supertest(server.app).post('/api/refunds/' + refundId + '/decision')
      .set(adminAuth).send({ decision: 'approved' });
    expect(decision.status).toBe(200);
    expect(decision.body.refund).toMatchObject({
      status: 'approved_simulated', simulated: true, providerStatus: 'not_configured', providerReference: null
    });
    expect((await adapter.findById('orders', orderId)).refundState).toBe('approved_simulated');
    expect(await adapter.count('auditLogs', { action: 'refund.request' })).toBe(1);
    expect(await adapter.count('auditLogs', { action: 'refund.approved' })).toBe(1);
    expect(await adapter.count('refunds', { orderId })).toBe(1);
  });

  it('releases reservations and records RELEASE plus audit when a buyer cancels', async () => {
    const { adapter } = await setup();
    const placed = await placeOrder([{ sku: 'SKU-1', qty: 2 }], 'cancel-route-1');
    expect(placed.status).toBe(201);
    const orderId = placed.body.order.id;
    const cancelled = await supertest(server.app).post('/api/orders/' + orderId + '/cancel').set(buyerAuth);
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.order.status).toBe('CANCELLED');
    expect(await adapter.count('movements', { type: 'RELEASE', refId: orderId })).toBe(1);
    expect((await adapter.findById('stock', 'SKU-1:HUB-KHI')).reserved).toBe(0);
    expect(await adapter.count('auditLogs', { action: 'order.cancel' })).toBe(1);
  });

  it('rolls back the first shipment line when a later line has inconsistent reservations', async () => {
    const { adapter } = await setup();
    const placed = await placeOrder([{ sku: 'SKU-1', qty: 2 }, { sku: 'SKU-2', qty: 1 }], 'dispatch-rollback-1');
    expect(placed.status).toBe(201);
    const orderId = placed.body.order.id;
    for (const status of ['CONFIRMED', 'PICKING', 'PACKED']) {
      const response = await supertest(server.app).patch('/api/orders/' + orderId + '/status')
        .set(adminAuth).send({ status });
      expect(response.status).toBe(200);
    }
    await adapter.update('stock', 'SKU-2:HUB-KHI', { reserved: 0 });

    const failed = await supertest(server.app).patch('/api/orders/' + orderId + '/status')
      .set(adminAuth).send({ status: 'DISPATCHED' });
    expect(failed.status).toBe(409);
    expect(failed.body.error).toBe('STOCK_MISMATCH');
    expect(await adapter.findById('stock', 'SKU-1:HUB-KHI')).toMatchObject({ onHand: 10, reserved: 2 });
    expect(await adapter.count('movements', { type: 'SHIP', refId: orderId })).toBe(0);
    expect((await adapter.findById('orders', orderId)).status).toBe('PACKED');
  });

  it('serializes concurrent checkout so only one request can reserve scarce units', async () => {
    const { adapter } = await setup();
    const [a, b] = await Promise.all([
      placeOrder([{ sku: 'SKU-1', qty: 6 }], 'race-checkout-a'),
      placeOrder([{ sku: 'SKU-1', qty: 6 }], 'race-checkout-b')
    ]);
    expect([a.status, b.status].filter((s) => s === 201)).toHaveLength(1);
    expect([a.status, b.status].filter((s) => s === 409)).toHaveLength(1);
    expect(await adapter.findById('stock', 'SKU-1:HUB-KHI')).toMatchObject({ onHand: 10, reserved: 6 });
    expect(await adapter.count('orders')).toBe(1);
    expect(await adapter.count('movements', { type: 'RESERVE' })).toBe(1);
  });

  it('does not accept refund requests before delivery', async () => {
    await setup();
    const placed = await placeOrder([{ sku: 'SKU-1', qty: 1 }], 'refund-too-early-1');
    const response = await supertest(server.app).post('/api/orders/' + placed.body.order.id + '/refunds')
      .set(buyerAuth).set('Idempotency-Key', 'refund-too-early-1').send({ reason: 'Please refund' });
    expect(response.status).toBe(409);
    expect(response.body.error).toBe('INVALID_TRANSITION');
  });
});
