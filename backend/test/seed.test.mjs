import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import seedModule from '../seed.js';

const { seedDatabase, hasCurrentSchema } = seedModule;
let tempDirectory;

async function seedTemp() {
  tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'velosupply-pakistan-seed-'));
  const filePath = path.join(tempDirectory, 'db.json');
  const state = await seedDatabase({ filePath });
  return { filePath, state };
}

afterEach(async () => {
  if (tempDirectory) await fs.rm(tempDirectory, { recursive: true, force: true });
  tempDirectory = null;
});

function calculateLedger(rows) {
  return rows.reduce((balance, movement) => {
    if (['RECEIVE', 'TRANSFER_IN', 'RETURN_IN'].includes(movement.type)) balance.onHand += movement.qty;
    if (['SHIP', 'TRANSFER_OUT'].includes(movement.type)) {
      balance.onHand -= movement.qty;
      if (movement.type === 'SHIP') balance.reserved -= movement.qty;
    }
    if (movement.type === 'RESERVE') balance.reserved += movement.qty;
    if (movement.type === 'RELEASE') balance.reserved -= movement.qty;
    if (movement.type === 'ADJUST') balance.onHand += movement.qty;
    return balance;
  }, { onHand: 0, reserved: 0 });
}

describe('Pakistan Edition demo seed fixture', () => {
  it('matches the requested Pakistan users, hubs, products and supporting records', async () => {
    const { state } = await seedTemp();
    expect(hasCurrentSchema(state)).toBe(true);
    expect(state.dataMode).toBe('demo');
    expect(state.seedManifest).toMatchObject({ edition: 'Pakistan Edition', syntheticOnly: true });
    expect(state.warehouses.map((hub) => hub.code)).toEqual([
      'HUB-KHI', 'HUB-LHE', 'HUB-ISB', 'HUB-FSD', 'HUB-PEW', 'HUB-UET'
    ]);
    expect(state.products.map((product) => product.sku)).toEqual([
      'VS-INV-01', 'VS-BAT-01', 'VS-UPS-01', 'VS-RTR-01',
      'VS-NVR-01', 'VS-SWT-01', 'VS-RCK-01', 'VS-SCN-01',
      'VS-PRN-01', 'VS-LAP-01', 'VS-PNL-01', 'VS-CAB-01'
    ]);
    expect(state.products.slice(0, 6).every((product) => product.featured)).toBe(true);
    expect(state.users).toHaveLength(26);
    expect(state.users.filter((user) => user.role === 'admin')).toHaveLength(1);
    expect(state.users.filter((user) => user.role === 'operator')).toHaveLength(4);
    expect(state.users.filter((user) => user.role === 'buyer')).toHaveLength(21);
    expect(state.users.filter((user) => user.role === 'buyer').every((user) => user.filerStatus === 'unverified')).toBe(true);
    expect(state.suppliers).toHaveLength(5);
    expect(state.orders).toHaveLength(60);
    expect(state.orderItems).toHaveLength(60);
    expect(state.invoices).toHaveLength(60);
    expect(state.purchaseOrders).toHaveLength(8);
    expect(new Set(state.purchaseOrders.map((po) => po.status))).toEqual(new Set(['draft', 'approved', 'shipped', 'received']));
    expect(state.sre.incidents).toHaveLength(5);
    expect(state.sre.incidents.filter((incident) => incident.status === 'open')).toHaveLength(2);
    expect(state.sre.incidents.filter((incident) => incident.status === 'investigating')).toHaveLength(1);
    expect(state.sre.incidents.filter((incident) => incident.status === 'resolved')).toHaveLength(2);
    expect(state.sre.alerts).toHaveLength(8);
    expect(state.sre.alerts.filter((alert) => alert.status === 'firing')).toHaveLength(3);
    expect(state.sre.audit).toHaveLength(150);
    expect(state.messages).toHaveLength(6);
    expect(state.messages.some((message) => message.priority === 'urgent')).toBe(true);
  });

  it('keeps every stock projection reconciled to append-only order and receipt movements', async () => {
    const { state } = await seedTemp();
    expect(state.movements.every((movement) => movement.demoRecord)).toBe(true);
    expect(state.orders.every((order) => state.movements.some((movement) =>
      movement.type === 'RESERVE' && movement.refId === order.id
    ))).toBe(true);
    for (const row of state.stock) {
      const balance = calculateLedger(state.movements.filter((movement) =>
        movement.sku === row.sku && movement.hubCode === row.hubCode
      ));
      expect(balance).toEqual({ onHand: row.onHand, reserved: row.reserved });
      expect(row.onHand - row.reserved).toBeGreaterThanOrEqual(0);
    }
  });

  it('uses demo-estimate tariffs in PKR and marks every seeded business record as synthetic', async () => {
    const { state } = await seedTemp();
    expect(state.tariffRules.find((rule) => rule.code === 'PK-GST')).toMatchObject({
      ratePct: 18, source: 'demo-estimate'
    });
    expect(state.tariffRules.find((rule) => rule.code === 'PK-DELIVERY-KARACHI')).toMatchObject({
      amountPkr: 350, source: 'demo-estimate'
    });
    expect(state.settings.find((setting) => setting.key === 'currency').value).toBe('PKR');
    expect(state.settings.find((setting) => setting.key === 'lowDataModeDefault').value).toBe(true);
    expect(state.products.every((record) => record.demoRecord)).toBe(true);
    expect(state.orders.every((record) => record.demoRecord)).toBe(true);
    expect(state.purchaseOrders.every((record) => record.demoRecord)).toBe(true);
  });

  it('does not overwrite a production or unknown custom database with sample data', async () => {
    tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'velosupply-production-seed-'));
    const filePath = path.join(tempDirectory, 'db.json');
    const production = { schemaVersion: 2, dataMode: 'production', users: [{ id: 'REAL-USER' }] };
    await fs.writeFile(filePath, JSON.stringify(production));
    await expect(seedDatabase({ filePath, force: true })).rejects.toThrow('Refusing to overwrite a non-demo database');
    expect(await seedDatabase({ filePath })).toEqual(production);

    const customDemo = { schemaVersion: 2, dataMode: 'demo', users: [{ id: 'CUSTOM-DEMO' }] };
    await fs.writeFile(filePath, JSON.stringify(customDemo));
    expect(await seedDatabase({ filePath })).toEqual(customDemo);
  });

  it('returns the existing complete Pakistan demo fixture without regenerating it', async () => {
    const { filePath, state } = await seedTemp();
    const originalContents = await fs.readFile(filePath, 'utf8');
    const repeated = await seedDatabase({ filePath });
    expect(repeated.demoSeedVersion).toBe(state.demoSeedVersion);
    expect(await fs.readFile(filePath, 'utf8')).toBe(originalContents);
  });
});
