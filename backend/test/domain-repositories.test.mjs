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

async function harness() {
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
      sre: { audit: [], incidents: [], alerts: [], healthChecks: [], loginAttempts: [] }
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
    expect(result.order.price).toEqual({ currency: 'PKR', subtotalExMinor: 3750000, gstMinor: 675000, deliveryFeeMinor: 35000, totalMinor: 4460000 });
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

  it('moves stock between hubs with paired movements in one transaction', async () => {
    const { adapter, domain } = await harness();
    await domain.stockMovements.append({ sku: 'SKU-2', hubCode: 'KHI', type: 'RECEIVE', reason: 'opening_balance', qty: 8, refType: 'opening_balance', refId: 'opening-2' });
    const transfer = await domain.stockMovements.transfer({ sku: 'SKU-2', fromHubCode: 'KHI', toHubCode: 'LHE', qty: 3, reason: 'hub_transfer', actorId: 'operator-1' });
    expect(transfer.transferOut.type).toBe('TRANSFER_OUT');
    expect(transfer.transferIn.type).toBe('TRANSFER_IN');
    expect(await domain.stockMovements.reconcile('SKU-2', 'KHI', 5, 0)).toMatchObject({ matches: true, onHand: 5 });
    expect(await domain.stockMovements.reconcile('SKU-2', 'LHE', 3, 0)).toMatchObject({ matches: true, onHand: 3 });
    expect(await adapter.count('movements', { refId: transfer.refId })).toBe(2);
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
