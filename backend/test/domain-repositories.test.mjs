import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import fileAdapterModule from '../repository/file-adapter.js';
import domainModule from '../repository/domain-repositories.js';

const { createFileAdapter } = fileAdapterModule;
const { createDomainRepositories } = domainModule;
let directory;
afterEach(async () => {
  if (directory) await fs.rm(directory, { recursive: true, force: true });
  directory = null;
});

async function harness(overrides = {}) {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'velosupply-domain-'));
  const adapter = createFileAdapter({
    filePath: path.join(directory, 'db.json'),
    loadInitial: async () => ({
      dataMode: 'test', users: [], products: [], warehouses: [], orders: [],
      orderItems: [], movements: [], tariffRules: [
        { id: 'GST-DEMO-1', code: 'PK-GST', version: 1, ratePct: 18, source: 'demo-estimate' },
        { id: 'DEL-KHI-DEMO-1', code: 'PK-DELIVERY-KARACHI', version: 1, amountPkr: 350, source: 'demo-estimate' },
        { id: 'DEL-LHE-DEMO-1', code: 'PK-DELIVERY-LAHORE', version: 1, amountPkr: 400, source: 'demo-estimate' },
        { id: 'FREE-DEL-DEMO-1', code: 'PK-FREE-DELIVERY-THRESHOLD', version: 1, amountPkr: 150000, source: 'demo-estimate' }
      ], logs: [],
      newsletter: [], rewardClaims: [], metrics: {}, telemetry: { tick: 0 },
      sre: { audit: [], incidents: [], alerts: [], healthChecks: [], loginAttempts: [] },
      ...overrides
    })
  });
  await adapter.initialize();
  return { adapter, domain: createDomainRepositories(adapter) };
}

describe('domain repositories and immutable ledgers', () => {
  it('soft-deletes a buyer without deleting their historical orders', async () => {
    const { adapter, domain } = await harness();
    const buyer = await domain.users.create({
      email: 'buyer@example.com', role: 'buyer', filerStatus: 'filer', name: 'Buyer'
    });
    await adapter.insert('orders', { id: 'order-1', userId: buyer.id, totalMinor: 2500, currency: 'PKR' });
    const deleted = await domain.users.softDelete(buyer.id, '2026-11-13T00:00:00.000Z');
    expect(deleted.isActive).toBe(false);
    expect(deleted.deletedAt).toBe('2026-11-13T00:00:00.000Z');
    expect(await adapter.count('orders', { userId: buyer.id })).toBe(1);
  });

  it('requires filer status for buyers and validates whole-PKR order inputs', async () => {
    const { domain } = await harness();
    await expect(domain.users.create({ email: 'bad@example.com', role: 'buyer' })).rejects.toThrow('filerStatus');
    await expect(domain.orders.createWithItems(
      { buyerId: 'buyer-1', city: 'Karachi' },
      [{ sku: 'SKU-1', name: 'Router', qty: 1, unitExGstPkr: -1 }]
    )).rejects.toThrow('unitExGstPkr');
  });

  it('creates products only against an existing warehouse and requires the supplied batch hash', async () => {
    const { adapter, domain } = await harness();
    await expect(domain.products.create({
      sku: 'SKU-MISSING', name: 'Router', batchHash: 'sha256:abc', originWarehouseId: 'MISSING'
    })).rejects.toThrow('existing warehouse');
    const warehouse = await domain.warehouses.create({ code: 'HUB-KHI', name: 'Port Qasim Hub', city: 'Karachi' });
    const product = await domain.products.create({
      sku: 'SKU-OK', name: 'Router', batchHash: 'sha256:abc', originWarehouseId: warehouse.id
    });
    expect(product.originWarehouseId).toBe(warehouse.id);
    expect(await adapter.count('products', { sku: 'SKU-OK' })).toBe(1);
  });

  it('calculates PKR lines, GST, and city delivery fees using SRS rounding', async () => {
    const { adapter, domain } = await harness();
    const result = await domain.orders.createWithItems(
      { buyerId: 'buyer-1', city: 'Karachi', paymentMethod: 'COD' },
      [{ sku: 'SKU-1', name: 'Router', qty: 3, unitExGstPkr: 12500 }]
    );
    expect(result.order.price).toEqual({ currency: 'PKR', subtotalExMinor: 3750000, gstMinor: 675000, deliveryFeeMinor: 35000, totalMinor: 4460000, simulated: true });
    expect(result.order.items).toEqual([{ sku: 'SKU-1', name: 'Router', qty: 3, unitPriceMinor: 1250000 }]);
    expect(Number.isSafeInteger(result.order.price.totalMinor)).toBe(true);
    expect(result.order.price.simulated).toBe(true);
    expect(await adapter.count('orderItems', { orderId: result.order.id })).toBe(1);
  });

  it('refuses to quote when sourced tariff rules are missing', async () => {
    const { adapter, domain } = await harness();
    const state = await adapter.readState();
    state.tariffRules = [];
    await adapter.writeState(state);
    await expect(domain.orders.createWithItems(
      { buyerId: 'buyer-1', city: 'Karachi' },
      [{ sku: 'SKU-1', name: 'Router', qty: 1, unitExGstPkr: 1000 }]
    )).rejects.toThrow('sourced tariff rules');
  });

  it('applies free delivery only when subtotal is above Rs 150,000', async () => {
    const { domain } = await harness();
    const result = await domain.orders.createWithItems(
      { buyerId: 'buyer-1', city: 'Lahore' },
      [{ sku: 'SKU-1', name: 'Server Rack', qty: 1, unitExGstPkr: 150001 }]
    );
    expect(result.order.price.deliveryFeeMinor).toBe(0);
  });

  it('places a canonical PKR checkout with a reservation, separate order item, invoice and audit entry', async () => {
    const { adapter, domain } = await harness({
      warehouses: [{ id: 'HUB-KHI', code: 'HUB-KHI', name: 'Port Qasim Hub', city: 'Karachi', seedOrigin: true }],
      products: [{
        id: 'PROD-1', sku: 'SKU-1', name: 'Hybrid Solar Inverter',
        priceExGstPkr: 1000, price: 1000, stock: 10,
        warehouse_hub: 'HUB-KHI', status: 'active'
      }]
    });
    const result = await domain.orders.checkout({
      buyerId: 'buyer-1', buyerEmail: 'buyer@example.com', customerName: 'Buyer',
      city: 'Karachi', address: 'Street 1, Karachi', paymentMethod: 'COD',
      items: [{ sku: 'SKU-1', qty: 2 }], idempotencyKey: 'checkout-001'
    });
    expect(result.order).toMatchObject({
      buyerId: 'buyer-1', city: 'Karachi', status: 'PLACED',
      paymentState: 'pending_cod', splitShipment: false,
      hubs: ['HUB-KHI'], currency: 'PKR'
    });
    expect(result.order.price.totalMinor).toBe(271000);
    expect(result.items).toHaveLength(1);
    expect(result.invoice.orderId).toBe(result.order.id);
    expect(await adapter.count('orderItems', { orderId: result.order.id })).toBe(1);
    expect(await adapter.count('invoices', { orderId: result.order.id })).toBe(1);
    expect(await adapter.count('auditLogs', { action: 'order.create' })).toBe(1);
    const stock = await adapter.find('stock', { sku: 'SKU-1', hubCode: 'HUB-KHI' });
    expect(stock[0]).toMatchObject({ onHand: 10, reserved: 2 });
    const movements = await adapter.find('movements', { sku: 'SKU-1', hubCode: 'HUB-KHI' });
    expect(movements.map((entry) => entry.type)).toEqual(['RECEIVE', 'RESERVE']);
  });

  it('returns the original checkout response for the same idempotency key and rejects changed payloads', async () => {
    const { adapter, domain } = await harness({
      warehouses: [{ id: 'HUB-KHI', code: 'HUB-KHI', name: 'Port Qasim Hub', city: 'Karachi', seedOrigin: true }],
      products: [{
        id: 'PROD-1', sku: 'SKU-1', name: 'Hybrid Solar Inverter',
        priceExGstPkr: 1000, stock: 10, warehouse_hub: 'HUB-KHI', status: 'active'
      }]
    });
    const input = {
      buyerId: 'buyer-1', city: 'Karachi', address: 'Street 1, Karachi',
      paymentMethod: 'COD', items: [{ sku: 'SKU-1', qty: 2 }], idempotencyKey: 'checkout-002'
    };
    const first = await domain.orders.checkout(input);
    const repeated = await domain.orders.checkout(input);
    expect(repeated.order.id).toBe(first.order.id);
    await expect(domain.orders.checkout({
      ...input, items: [{ sku: 'SKU-1', qty: 3 }]
    })).rejects.toMatchObject({ code: 'KEY_REUSED' });
    expect(await adapter.count('orders')).toBe(1);
    expect(await adapter.count('movements')).toBe(2);
  });

  it('rolls back checkout reservation and all records when inventory is insufficient', async () => {
    const { adapter, domain } = await harness({
      warehouses: [{ id: 'HUB-KHI', code: 'HUB-KHI', name: 'Port Qasim Hub', city: 'Karachi', seedOrigin: true }],
      products: [{
        id: 'PROD-1', sku: 'SKU-1', name: 'Hybrid Solar Inverter',
        priceExGstPkr: 1000, stock: 1, warehouse_hub: 'HUB-KHI', status: 'active'
      }]
    });
    await expect(domain.orders.checkout({
      buyerId: 'buyer-1', city: 'Karachi', address: 'Street 1, Karachi',
      paymentMethod: 'COD', items: [{ sku: 'SKU-1', qty: 2 }], idempotencyKey: 'checkout-003'
    })).rejects.toMatchObject({ code: 'OUT_OF_STOCK' });
    expect(await adapter.count('orders')).toBe(0);
    expect(await adapter.count('orderItems')).toBe(0);
    expect(await adapter.count('invoices')).toBe(0);
    expect(await adapter.count('movements')).toBe(0);
    expect((await adapter.find('stock', { sku: 'SKU-1', hubCode: 'HUB-KHI' }))[0].reserved).toBe(0);
  });

  it('releases reserved inventory when a buyer cancels a placed order', async () => {
    const { adapter, domain } = await harness({
      warehouses: [{ id: 'HUB-KHI', code: 'HUB-KHI', name: 'Port Qasim Hub', city: 'Karachi', seedOrigin: true }],
      products: [{
        id: 'PROD-1', sku: 'SKU-1', name: 'Hybrid Solar Inverter',
        priceExGstPkr: 1000, stock: 10, warehouse_hub: 'HUB-KHI', status: 'active'
      }]
    });
    const placed = await domain.orders.checkout({
      buyerId: 'buyer-1', city: 'Karachi', address: 'Street 1, Karachi',
      paymentMethod: 'COD', items: [{ sku: 'SKU-1', qty: 2 }], idempotencyKey: 'cancel-001'
    });
    const confirmed = await domain.orders.advanceStatus(placed.order.id, 'CONFIRMED', { id: 'operator-1', role: 'operator' });
    expect(confirmed.status).toBe('CONFIRMED');
    const cancelled = await domain.orders.advanceStatus(placed.order.id, 'CANCELLED', { id: 'buyer-1', role: 'buyer' });
    expect(cancelled.status).toBe('CANCELLED');
    expect(await adapter.findById('stock', 'SKU-1:HUB-KHI')).toMatchObject({ onHand: 10, reserved: 0 });
    expect(await adapter.count('movements', { type: 'RELEASE', refId: placed.order.id })).toBe(1);
    expect(await adapter.count('auditLogs', { action: 'order.cancel' })).toBe(1);
  });

  it('ships reserved stock on dispatch and books a received return through RETURN_IN', async () => {
    const { adapter, domain } = await harness({
      warehouses: [{ id: 'HUB-KHI', code: 'HUB-KHI', name: 'Port Qasim Hub', city: 'Karachi', seedOrigin: true }],
      products: [{
        id: 'PROD-1', sku: 'SKU-1', name: 'Hybrid Solar Inverter',
        priceExGstPkr: 1000, stock: 10, warehouse_hub: 'HUB-KHI', status: 'active'
      }]
    });
    const placed = await domain.orders.checkout({
      buyerId: 'buyer-1', city: 'Karachi', address: 'Street 1, Karachi',
      paymentMethod: 'COD', items: [{ sku: 'SKU-1', qty: 2 }], idempotencyKey: 'return-001'
    });
    for (const status of ['CONFIRMED', 'PICKING', 'PACKED', 'DISPATCHED', 'DELIVERED']) {
      await domain.orders.advanceStatus(placed.order.id, status, { id: 'operator-1', role: 'operator' });
    }
    expect(await adapter.findById('stock', 'SKU-1:HUB-KHI')).toMatchObject({ onHand: 8, reserved: 0 });
    const requested = await domain.orders.requestReturn(placed.order.id, { reason: 'Damaged packaging' }, { id: 'buyer-1', role: 'buyer' });
    const approved = await domain.orders.decideReturn(requested.return.id, 'approved', { id: 'operator-1', role: 'operator' });
    expect(approved.status).toBe('approved');
    const received = await domain.orders.receiveReturn(requested.return.id, 'HUB-KHI', { id: 'operator-1', role: 'operator' });
    expect(received.order.status).toBe('RETURNED');
    expect(await adapter.findById('stock', 'SKU-1:HUB-KHI')).toMatchObject({ onHand: 10, reserved: 0 });
    expect(await adapter.count('movements', { type: 'SHIP', refId: placed.order.id })).toBe(1);
    expect(await adapter.count('movements', { type: 'RETURN_IN', refId: requested.return.id })).toBe(1);
    expect(await adapter.count('auditLogs', { action: 'return.receive' })).toBe(1);
  });

  it('rejects illegal order state transitions without changing order state', async () => {
    const { domain } = await harness({
      warehouses: [{ id: 'HUB-KHI', code: 'HUB-KHI', name: 'Port Qasim Hub', city: 'Karachi', seedOrigin: true }],
      products: [{
        id: 'PROD-1', sku: 'SKU-1', name: 'Hybrid Solar Inverter',
        priceExGstPkr: 1000, stock: 10, warehouse_hub: 'HUB-KHI', status: 'active'
      }]
    });
    const placed = await domain.orders.checkout({
      buyerId: 'buyer-1', city: 'Karachi', address: 'Street 1, Karachi',
      paymentMethod: 'COD', items: [{ sku: 'SKU-1', qty: 1 }], idempotencyKey: 'state-001'
    });
    await expect(domain.orders.advanceStatus(placed.order.id, 'DISPATCHED', { id: 'operator-1', role: 'operator' }))
      .rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
  });

  it('snapshots both legacy on-hand and reserved balances before a first adjustment movement', async () => {
    const { adapter, domain } = await harness({
      warehouses: [{ id: 'WH-KHI', code: 'KHI', name: 'Karachi Hub', seedOrigin: true }],
      products: [{
        id: 'PROD-LEGACY', sku: 'LEGACY-1', name: 'Legacy stock item',
        priceExGstPkr: 1000, stock: 5, reserved: 2, available: 3,
        warehouse_hub: 'KHI', status: 'active'
      }],
      stock: [{ id: 'LEGACY-1:KHI', sku: 'LEGACY-1', hubCode: 'KHI', onHand: 5, reserved: 2 }]
    });
    await domain.stockMovements.adjust({
      sku: 'LEGACY-1', hubCode: 'KHI', targetOnHand: 6,
      reason: 'cycle_count', actorId: 'operator-1', actorRole: 'operator'
    });
    const movements = await adapter.find('movements', { sku: 'LEGACY-1', hubCode: 'KHI' });
    expect(movements.map((movement) => movement.type)).toEqual(['RECEIVE', 'RESERVE', 'ADJUST']);
    expect(await domain.stockMovements.reconcile('LEGACY-1', 'KHI', 6, 2)).toMatchObject({
      onHand: 6, reserved: 2, available: 4, matches: true, movementCount: 3
    });
    expect(await adapter.findById('stock', 'LEGACY-1:KHI')).toMatchObject({ onHand: 6, reserved: 2 });
  });

  it('creates draft purchase orders and writes RECEIVE only after shipment and receipt', async () => {
    const { adapter, domain } = await harness({
      warehouses: [{ id: 'WH-KHI', code: 'HUB-KHI', name: 'Port Qasim Hub', seedOrigin: true }],
      suppliers: [{ id: 'SUP-1', name: 'Demo Supplier', leadDays: 7, reliabilityScore: 90 }],
      products: [{
        id: 'PROD-1', sku: 'SKU-1', name: 'Hybrid Solar Inverter',
        priceExGstPkr: 1000, supplierId: 'SUP-1', stock: 10,
        warehouse_hub: 'HUB-KHI', status: 'active'
      }],
      stock: [{ id: 'SKU-1:HUB-KHI', sku: 'SKU-1', hubCode: 'HUB-KHI', onHand: 10, reserved: 0 }]
    });
    const po = await domain.purchaseOrders.createDraft({
      sku: 'SKU-1', hubCode: 'HUB-KHI', qty: 2,
      actorId: 'operator-1', actorRole: 'operator', idempotencyKey: 'po-domain-001'
    });
    expect(po).toMatchObject({ status: 'draft', supplierId: 'SUP-1', totalPkr: 2000 });
    expect(await adapter.count('movements')).toBe(0);
    expect((await adapter.find('stock', { sku: 'SKU-1', hubCode: 'HUB-KHI' }))[0].onHand).toBe(10);

    const approved = await domain.purchaseOrders.transition(po.id, 'approved', {
      id: 'operator-1', role: 'operator'
    }, 'po-domain-approve-001');
    expect(approved.status).toBe('approved');
    const shipped = await domain.purchaseOrders.transition(po.id, 'shipped', {
      id: 'operator-1', role: 'operator'
    }, 'po-domain-ship-001');
    expect(shipped.status).toBe('shipped');
    const received = await domain.purchaseOrders.transition(po.id, 'received', {
      id: 'operator-1', role: 'operator'
    }, 'po-domain-receive-001');
    expect(received.status).toBe('received');
    expect((await adapter.find('stock', { sku: 'SKU-1', hubCode: 'HUB-KHI' }))[0]).toMatchObject({ onHand: 12, reserved: 0 });
    const movements = await adapter.find('movements', { sku: 'SKU-1', hubCode: 'HUB-KHI' });
    expect(movements.map((movement) => movement.type)).toEqual(['RECEIVE', 'RECEIVE']);
    expect(movements[1]).toMatchObject({ qty: 2, refType: 'purchase_order', refId: po.id });
    expect(await adapter.count('auditLogs', { action: 'purchase_order.create' })).toBe(1);
    expect(await adapter.count('auditLogs', { action: 'purchase_order.received' })).toBe(1);
  });

  it('requires administrator approval for purchase orders above Rs 2,000,000', async () => {
    const { domain } = await harness({
      warehouses: [{ id: 'WH-KHI', code: 'HUB-KHI', name: 'Port Qasim Hub', seedOrigin: true }],
      suppliers: [{ id: 'SUP-1', name: 'Demo Supplier', leadDays: 7, reliabilityScore: 90 }],
      products: [{
        id: 'PROD-1', sku: 'SKU-1', name: 'Hybrid Solar Inverter',
        priceExGstPkr: 1000, supplierId: 'SUP-1', stock: 10,
        warehouse_hub: 'HUB-KHI', status: 'active'
      }],
      stock: [{ id: 'SKU-1:HUB-KHI', sku: 'SKU-1', hubCode: 'HUB-KHI', onHand: 10, reserved: 0 }]
    });
    const po = await domain.purchaseOrders.createDraft({
      sku: 'SKU-1', hubCode: 'HUB-KHI', qty: 2001,
      actorId: 'operator-1', actorRole: 'operator', idempotencyKey: 'po-domain-large-001'
    });
    expect(po.totalPkr).toBe(2001000);
    await expect(domain.purchaseOrders.transition(po.id, 'approved', {
      id: 'operator-1', role: 'operator'
    }, 'po-domain-large-approve-operator')).rejects.toMatchObject({ code: 'ADMIN_APPROVAL_REQUIRED' });
    const approved = await domain.purchaseOrders.transition(po.id, 'approved', {
      id: 'admin-1', role: 'admin'
    }, 'po-domain-large-approve-admin');
    expect(approved.status).toBe('approved');
  });

  it('reconciles on-hand stock from append-only movements', async () => {
    const { adapter, domain } = await harness();
    await domain.stockMovements.append({ sku: 'SKU-1', hubCode: 'WH-1', type: 'RECEIVE', reason: 'opening_balance', qty: 10, refType: 'opening_balance', refId: 'open-1' });
    await domain.stockMovements.append({ sku: 'SKU-1', hubCode: 'WH-1', type: 'RESERVE', reason: 'checkout', qty: 3, adminActionId: 'reserve-1' });
    await domain.stockMovements.append({ sku: 'SKU-1', hubCode: 'WH-1', type: 'SHIP', reason: 'sale', qty: 3, orderId: 'order-1' });
    await domain.stockMovements.append({ sku: 'SKU-1', hubCode: 'WH-1', type: 'RECEIVE', reason: 'restock', qty: 5, adminActionId: 'restock-1' });
    expect(await domain.stockMovements.reconcile('SKU-1', 'WH-1', 12, 0)).toMatchObject({
      onHand: 12, reserved: 0, available: 12, expectedOnHand: 12, expectedReserved: 0, matches: true, movementCount: 4
    });
    const stored = await adapter.find('movements', { sku: 'SKU-1' });
    expect(stored[2]).toMatchObject({ hubCode: 'WH-1', type: 'SHIP', qty: 3, reason: 'sale', refType: 'order', refId: 'order-1', actorId: 'system' });
    await expect(adapter.update('movements', 'missing', { quantityDelta: 0 })).rejects.toThrow('append-only');
    await expect(adapter.remove('movements', 'missing')).rejects.toThrow('append-only');
  });

  it('moves stock between hubs with paired movements and synchronized stock rows in one transaction', async () => {
    const { adapter, domain } = await harness({
      warehouses: [
        { id: 'WH-KHI', code: 'KHI', name: 'Karachi Hub', seedOrigin: true },
        { id: 'WH-LHE', code: 'LHE', name: 'Lahore Hub', seedOrigin: true }
      ],
      stock: [
        { id: 'SKU-2:KHI', sku: 'SKU-2', hubCode: 'KHI', onHand: 8, reserved: 0 },
        { id: 'SKU-2:LHE', sku: 'SKU-2', hubCode: 'LHE', onHand: 0, reserved: 0 }
      ]
    });
    await domain.stockMovements.append({ sku: 'SKU-2', hubCode: 'KHI', type: 'RECEIVE', reason: 'opening_balance', qty: 8, refType: 'opening_balance', refId: 'opening-2' });
    const transfer = await domain.stockMovements.transfer({ sku: 'SKU-2', fromHubCode: 'KHI', toHubCode: 'LHE', qty: 3, reason: 'hub_transfer', actorId: 'operator-1' });
    expect(transfer.transferOut.type).toBe('TRANSFER_OUT');
    expect(transfer.transferIn.type).toBe('TRANSFER_IN');
    expect(await domain.stockMovements.reconcile('SKU-2', 'KHI', 5, 0)).toMatchObject({ matches: true, onHand: 5 });
    expect(await domain.stockMovements.reconcile('SKU-2', 'LHE', 3, 0)).toMatchObject({ matches: true, onHand: 3 });
    expect(await adapter.findById('stock', 'SKU-2:KHI')).toMatchObject({ onHand: 5 });
    expect(await adapter.findById('stock', 'SKU-2:LHE')).toMatchObject({ onHand: 3 });
    expect(await adapter.count('movements', { refId: transfer.refId })).toBe(2);
    expect(await adapter.count('auditLogs', { action: 'inventory.transfer' })).toBe(1);
  });

  it('rejects audit log updates and deletes and rejects replacement through writeState', async () => {
    const { adapter, domain } = await harness();
    const row = await domain.auditLogs.append({ actorId: 'admin-1', action: 'product.archive' });
    await expect(adapter.update('auditLogs', row.id, { action: 'tampered' })).rejects.toThrow('append-only');
    await expect(adapter.remove('auditLogs', row.id)).rejects.toThrow('append-only');
    const state = await adapter.readState();
    state.sre.audit[0].action = 'tampered';
    await expect(adapter.writeState(state)).rejects.toThrow('cannot be changed');
  });
});
