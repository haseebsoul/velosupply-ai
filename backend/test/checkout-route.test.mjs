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

async function setup() {
  temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'velosupply-checkout-route-'));
  const adapter = createFileAdapter({
    filePath: path.join(temporaryDirectory, 'db.json'),
    loadInitial: async () => ({
      schemaVersion: 3,
      dataMode: 'test',
      users: [],
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
