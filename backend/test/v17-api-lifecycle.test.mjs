import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';
import supertest from 'supertest';

const require = createRequire(import.meta.url);
const bcrypt = require('bcryptjs');
const { createFileAdapter } = require('../repository/file-adapter.js');
const server = require('../server.js');
let tempDir;

async function setup() {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'velosupply-v17-api-'));
  const adapter = createFileAdapter({
    filePath: path.join(tempDir, 'db.json'),
    loadInitial: async () => ({
      schemaVersion: 3, dataMode: 'test',
      users: [
        { id: 'ADMIN-1', name: 'Test Admin', email: 'admin@example.com', role: 'admin', passwordHash: await bcrypt.hash('AdminPassword123', 10), isActive: true, deletedAt: null },
        { id: 'OPS-1', name: 'Test Operator', email: 'operator@example.com', role: 'operator', passwordHash: await bcrypt.hash('Operator123', 10), isActive: true, deletedAt: null }
      ],
      warehouses: [
        { id: 'WH-KHI', code: 'HUB-KHI', name: 'Karachi Hub', city: 'Karachi', status: 'online', capacity: 1000, seedOrigin: true },
        { id: 'WH-LHE', code: 'HUB-LHE', name: 'Lahore Hub', city: 'Lahore', status: 'online', capacity: 800, seedOrigin: true }
      ],
      products: [
        { id: 'PROD-1', sku: 'SKU-1', name: 'Hybrid Solar Inverter', category: 'Power', description: 'Test item', priceExGstPkr: 1000, stock: 10, supplierId: 'SUP-1', leadDays: 7, warehouse_hub: 'HUB-KHI', originWarehouseId: 'WH-KHI', reorder_threshold: 2, status: 'optimal' }
      ],
      stock: [], suppliers: [{ id: 'SUP-1', name: 'Test Supplier', city: 'Karachi', leadDays: 7, reliabilityScore: 90, status: 'active', demoRecord: true }],
      orders: [], orderItems: [], movements: [], invoices: [], returns: [], refunds: [], payments: [],
      tariffRules: [
        { id: 'T-GST', code: 'PK-GST', version: 1, ratePct: 18, source: 'demo-estimate' },
        { id: 'T-DEL', code: 'PK-DELIVERY-KARACHI', version: 1, amountPkr: 350, source: 'demo-estimate' },
        { id: 'T-FREE', code: 'PK-FREE-DELIVERY-THRESHOLD', version: 1, amountPkr: 150000, source: 'demo-estimate' }
      ],
      idempotencyKeys: [], auditLogs: [], logs: [], newsletter: [], rewardClaims: [], purchaseOrders: [],
      metrics: { gmv24h: 0, activeOrders: 0, fulfillmentHealth: 0, packetsPerSec: 0, avgLatencyMs: 0, threatsBlocked: 0, detectionTimeMs: 0, efficiencyScore: 0, hubCapacities: [] },
      telemetry: { tick: 0, updatedAt: new Date().toISOString() },
      sre: { audit: [], incidents: [], alerts: [], healthChecks: [], loginAttempts: [] }
    })
  });
  await adapter.initialize();
  server.configureForTests(await adapter.readState(), adapter);
  return { adapter };
}

async function adminToken() {
  const response = await supertest(server.app).post('/api/auth/login')
    .send({ email: 'admin@example.com', password: 'AdminPassword123' });
  expect(response.status).toBe(200);
  return response.body.token;
}

afterEach(async () => {
  if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
  tempDir = null;
});

describe('v17 collection-backed catalog, payment and refund routes', () => {
  it('creates and updates a warehouse/product, writes opening stock, and blocks unsafe archive until empty', async () => {
    const { adapter } = await setup();
    const token = await adminToken();
    const auth = (request) => request.set('Authorization', 'Bearer ' + token);
    const warehouseResponse = await auth(supertest(server.app).post('/api/admin/warehouses')).send({
      code: 'HUB-ISB', name: 'Islamabad Hub', city: 'Islamabad', address: 'Test location', capacity: 500, status: 'offline'
    });
    expect(warehouseResponse.status).toBe(201);
    const warehouse = warehouseResponse.body.warehouse;

    const productResponse = await auth(supertest(server.app).post('/api/admin/products')).send({
      sku: 'SKU-NEW', name: 'New Network Router', category: 'Networking',
      description: 'Created by the v17 API route test', batchHash: 'sha256-test-batch-001',
      originWarehouseId: warehouse.id, priceExGstPkr: 2500, stock: 4, reorder_threshold: 1
    });
    expect(productResponse.status).toBe(201);
    const product = productResponse.body.product;
    expect(product).toMatchObject({ sku: 'SKU-NEW', warehouse_hub: 'HUB-ISB', stock: 4 });
    expect(await adapter.find('stock', { sku: 'SKU-NEW', hubCode: 'HUB-ISB' })).toMatchObject([{ onHand: 4, reserved: 0 }]);
    expect(await adapter.count('movements', { sku: 'SKU-NEW', type: 'RECEIVE' })).toBe(1);
    expect(await adapter.count('auditLogs', { action: 'product.create' })).toBe(1);

    const updated = await auth(supertest(server.app).put('/api/admin/products/' + product.id))
      .send({ priceExGstPkr: 2600, reorder_threshold: 2 });
    expect(updated.status).toBe(200);
    expect(updated.body.product).toMatchObject({ priceExGstPkr: 2600, reorder_threshold: 2 });

    const blockedWarehouse = await auth(supertest(server.app).delete('/api/admin/warehouses/' + warehouse.id));
    expect(blockedWarehouse.status).toBe(409);
    expect(blockedWarehouse.body.error).toBe('WAREHOUSE_IN_USE');

    const zeroStock = await auth(supertest(server.app).patch('/api/inventory/' + product.id))
      .set('Idempotency-Key', 'v17-test-stock-zero')
      .send({ stock: 0, reason: 'cycle_count' });
    expect(zeroStock.status).toBe(200);
    expect(zeroStock.body.product.stock).toBe(0);

    const archivedProduct = await auth(supertest(server.app).delete('/api/admin/products/' + product.id));
    expect(archivedProduct.status).toBe(200);
    expect(archivedProduct.body.product.archivedAt).toBeTruthy();
    const archivedWarehouse = await auth(supertest(server.app).delete('/api/admin/warehouses/' + warehouse.id));
    expect(archivedWarehouse.status).toBe(200);
    expect(archivedWarehouse.body.warehouse.archivedAt).toBeTruthy();
    expect(await adapter.count('auditLogs', { action: 'warehouse.archive' })).toBe(1);
    expect(await adapter.count('auditLogs', { action: 'product.archive' })).toBe(1);
  });

  it('keeps COD unpaid until manually recorded, then creates a non-provider refund after return receipt', async () => {
    const { adapter } = await setup();
    const token = await adminToken();
    const auth = (request) => request.set('Authorization', 'Bearer ' + token);
    const checkout = await supertest(server.app).post('/api/checkout')
      .set('Idempotency-Key', 'v17-refund-checkout')
      .send({
        customerName: 'Buyer Test', customerEmail: 'buyer@example.com',
        city: 'Karachi', address: 'Test delivery address',
        paymentMethod: 'COD', items: [{ sku: 'SKU-1', qty: 1 }]
      });
    expect(checkout.status).toBe(201);
    const order = checkout.body.order;

    for (const status of ['CONFIRMED', 'PICKING', 'PACKED']) {
      const response = await auth(supertest(server.app).patch('/api/orders/' + order.id + '/status')).send({ status });
      expect(response.status).toBe(200);
    }
    const dispatched = await auth(supertest(server.app).patch('/api/orders/' + order.id + '/status'))
      .set('Idempotency-Key', 'v17-dispatch-order')
      .send({ status: 'DISPATCHED' });
    expect(dispatched.status).toBe(200);
    const delivered = await auth(supertest(server.app).patch('/api/orders/' + order.id + '/status'))
      .send({ status: 'DELIVERED' });
    expect(delivered.status).toBe(200);
    expect(delivered.body.order.paymentState).toBe('pending_cod');

    const amountMinor = order.totalMinor ?? order.price.totalMinor;
    const collectionPayload = { amountMinor, externalReference: 'COD-RECEIPT-V17-001' };
    const collection = await auth(supertest(server.app).post('/api/orders/' + order.id + '/payment/record-cod'))
      .send(collectionPayload);
    expect(collection.status).toBe(200);
    expect(collection.body.order.paymentState).toBe('paid_manual');
    expect(collection.body.payment).toMatchObject({ status: 'manual_recorded', executionMode: 'manual', providerVerified: false });
    const retry = await auth(supertest(server.app).post('/api/orders/' + order.id + '/payment/record-cod'))
      .send(collectionPayload);
    expect(retry.status).toBe(200);
    expect(retry.body.payment.id).toBe(collection.body.payment.id);
    expect(await adapter.count('payments', { orderId: order.id })).toBe(1);

    const requestedReturn = await auth(supertest(server.app).post('/api/orders/' + order.id + '/return'))
      .send({ reason: 'Test return after delivery' });
    expect(requestedReturn.status).toBe(201);
    const returnId = requestedReturn.body.return.id;
    const approvedReturn = await auth(supertest(server.app).post('/api/returns/' + returnId + '/decision'))
      .send({ decision: 'approved' });
    expect(approvedReturn.status).toBe(200);
    const receivedReturn = await auth(supertest(server.app).post('/api/returns/' + returnId + '/receive'))
      .set('Idempotency-Key', 'v17-receive-return')
      .send({ hubCode: 'HUB-KHI' });
    expect(receivedReturn.status).toBe(200);
    expect(receivedReturn.body.refund).toMatchObject({
      returnId, orderId: order.id, amountMinor, currency: 'PKR',
      status: 'manual_pending', executionMode: 'manual', providerVerified: false
    });

    const recordedRefund = await auth(supertest(server.app).post('/api/refunds/' + receivedReturn.body.refund.id + '/record'))
      .send({ amountMinor, externalReference: 'BANK-REF-V17-001', method: 'bank_transfer' });
    expect(recordedRefund.status).toBe(200);
    expect(recordedRefund.body.refund).toMatchObject({ status: 'manual_recorded', providerVerified: false });
    expect(recordedRefund.body.providerVerified).toBe(false);
    expect(recordedRefund.body.message).toContain('no payment provider was called or verified');
    expect(await adapter.count('auditLogs', { action: 'refund.request' })).toBe(1);
    expect(await adapter.count('auditLogs', { action: 'refund.manual_recorded' })).toBe(1);
  });
});
