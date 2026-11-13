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
      orderItems: [], movements: [], tariffRules: [], logs: [],
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

  it('requires filer status for buyers and integer minor-unit order totals', async () => {
    const { domain } = await harness();
    await expect(domain.users.create({ email: 'bad@example.com', role: 'buyer' })).rejects.toThrow('filerStatus');
    await expect(domain.orders.createWithItems(
      { userId: 'buyer-1', totalMinor: 12.5 },
      [{ productId: 'p-1', quantity: 1, unitPriceMinor: 12 }]
    )).rejects.toThrow('integer');
  });

  it('creates an order and its items atomically using integer minor units', async () => {
    const { adapter, domain } = await harness();
    const result = await domain.orders.createWithItems(
      { userId: 'buyer-1', totalMinor: 3750 },
      [{ productId: 'p-1', quantity: 3, unitPriceMinor: 1250 }]
    );
    expect(result.order.totalMinor).toBe(3750);
    expect(result.order.currency).toBe('PKR');
    expect(await adapter.count('orderItems', { orderId: result.order.id })).toBe(1);
  });

  it('reconciles on-hand stock from append-only movements', async () => {
    const { adapter, domain } = await harness();
    await domain.stockMovements.append({ sku: 'SKU-1', warehouseId: 'WH-1', reason: 'opening_balance', quantityDelta: 10 });
    await domain.stockMovements.append({ sku: 'SKU-1', warehouseId: 'WH-1', reason: 'sale', quantityDelta: -3, orderId: 'order-1' });
    await domain.stockMovements.append({ sku: 'SKU-1', warehouseId: 'WH-1', reason: 'restock', quantityDelta: 5, adminActionId: 'restock-1' });
    expect(await domain.stockMovements.reconcile('SKU-1', 'WH-1', 12)).toMatchObject({
      ledgerOnHand: 12, expectedOnHand: 12, matches: true, movementCount: 3, hubCode: 'WH-1'
    });
    const stored = await adapter.find('movements', { sku: 'SKU-1' });
    expect(stored[1]).toMatchObject({ hubCode: 'WH-1', type: 'OUT', qty: 3, reason: 'sale', refType: 'order', refId: 'order-1', actorId: 'system' });
    await expect(adapter.update('movements', 'missing', { quantityDelta: 0 })).rejects.toThrow('append-only');
    await expect(adapter.remove('movements', 'missing')).rejects.toThrow('append-only');
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
