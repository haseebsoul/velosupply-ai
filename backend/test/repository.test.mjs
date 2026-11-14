import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import fileAdapterModule from '../repository/file-adapter.js';
import mapModule from '../repository/collection-map.js';
import mongoAdapterModule from '../repository/mongo-adapter.js';

const { createFileAdapter } = fileAdapterModule;
const { recordsForState, extractMetadata } = mapModule;
const { createMongoAdapter } = mongoAdapterModule;

let temporaryDirectory;
afterEach(async () => {
  if (temporaryDirectory) await fs.rm(temporaryDirectory, { recursive: true, force: true });
  temporaryDirectory = null;
});

async function createTempAdapter(initialState) {
  temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'velosupply-repository-'));
  const filePath = path.join(temporaryDirectory, 'db.json');
  const adapter = createFileAdapter({ filePath, loadInitial: async () => initialState });
  await adapter.initialize();
  return { adapter, filePath };
}

class FakeCollection {
  constructor() {
    this.documents = new Map();
    this.indexes = [];
  }
  async createIndexes(indexes) { this.indexes.push(...indexes); return indexes.map((index) => index.name); }
  async findOne(filter) {
    const row = [...this.documents.values()].find((document) => Object.entries(filter).every(([key, value]) => document[key] === value));
    return row ? structuredClone(row) : null;
  }
  async countDocuments(filter = {}) {
    return [...this.documents.values()].filter((document) => Object.entries(filter).every(([key, value]) => document[key] === value)).length;
  }
  find(filter = {}) {
    let rows = [...this.documents.values()].filter((document) => Object.entries(filter).every(([key, value]) => document[key] === value));
    const cursor = {
      sort(sort) {
        const [[field, direction]] = Object.entries(sort);
        rows.sort((a, b) => (a[field] < b[field] ? -1 : a[field] > b[field] ? 1 : 0) * direction);
        return cursor;
      },
      skip(count) { rows = rows.slice(count); return cursor; },
      limit(count) { rows = rows.slice(0, count); return cursor; },
      async toArray() { return structuredClone(rows); }
    };
    return cursor;
  }
  async deleteMany(filter = {}) {
    const keys = [...this.documents.entries()].filter(([, document]) => Object.entries(filter).every(([key, value]) => document[key] === value)).map(([key]) => key);
    for (const key of keys) this.documents.delete(key);
    return { deletedCount: keys.length };
  }
  async insertMany(documents) {
    for (const document of documents) {
      if (this.documents.has(document._id)) throw new Error('duplicate');
      this.documents.set(document._id, structuredClone(document));
    }
    return { insertedCount: documents.length };
  }
  async insertOne(document, options = {}) {
    this.lastSession = options.session || null;
    if (this.documents.has(document._id)) throw new Error('duplicate');
    this.documents.set(document._id, structuredClone(document));
    return { insertedId: document._id };
  }
  async replaceOne(filter, document, options = {}) {
    const key = filter._id;
    if (!this.documents.has(key) && !options.upsert) return { matchedCount: 0 };
    this.documents.set(key, structuredClone(document));
    return { matchedCount: 1, upsertedCount: options.upsert ? 1 : 0 };
  }
  async updateOne(filter, update, options = {}) {
    const key = filter._id;
    const previous = this.documents.get(key);
    if (!previous && !options.upsert) return { matchedCount: 0 };
    const next = { ...(previous || {}), ...(update.$setOnInsert && !previous ? update.$setOnInsert : {}), ...(update.$set || {}) };
    this.documents.set(key, next);
    return { matchedCount: previous ? 1 : 0, upsertedCount: previous ? 0 : 1 };
  }
  async deleteOne(filter) {
    const existed = this.documents.delete(filter._id);
    return { deletedCount: existed ? 1 : 0 };
  }
}

class FakeClient {
  startSession() {
    return {
      withTransaction: async (callback) => callback(),
      endSession: async () => {}
    };
  }
}

class FakeDatabase {
  constructor() { this.collections = new Map(); }
  collection(name) {
    if (!this.collections.has(name)) this.collections.set(name, new FakeCollection());
    return this.collections.get(name);
  }
  listCollections(filter = {}) {
    return { hasNext: async () => this.collections.has(filter.name) };
  }
  async createCollection(name, options = {}) {
    if (this.collections.has(name)) {
      const error = new Error('NamespaceExists');
      error.code = 48;
      throw error;
    }
    const collection = new FakeCollection();
    collection.options = options;
    this.collections.set(name, collection);
    return collection;
  }
}

describe('collection repository adapters', () => {
  it('keeps file persistence atomic and implements collection CRUD', async () => {
    const initial = {
      schemaVersion: 2, dataMode: 'demo',
      users: [{ id: 'u-1', email: 'a@example.com', passwordHash: 'preserved-hash' }],
      products: [], warehouses: [], orders: [], logs: [], newsletter: [], rewardClaims: [],
      metrics: {}, telemetry: { tick: 0 }
    };
    const { adapter, filePath } = await createTempAdapter(initial);

    expect((await adapter.findById('users', 'u-1')).passwordHash).toBe('preserved-hash');
    await adapter.insert('users', { id: 'u-2', email: 'b@example.com' });
    await adapter.update('users', 'u-2', { status: 'active' });
    expect(await adapter.count('users')).toBe(2);
    expect(await adapter.find('users', { status: 'active' })).toHaveLength(1);

    await expect(adapter.withTransaction(async ({ repository }) => {
      await repository.insert('users', { id: 'u-3', email: 'c@example.com' });
      throw new Error('rollback');
    })).rejects.toThrow('rollback');

    expect(await adapter.findById('users', 'u-3')).toBeNull();
    expect(JSON.parse(await fs.readFile(filePath, 'utf8')).users).toHaveLength(2);
    expect(await adapter.remove('users', 'u-2')).toBe(1);
  });

  it('keeps unrelated concurrent file writes outside a transaction rollback', async () => {
    const { adapter } = await createTempAdapter({
      users: [], products: [], warehouses: [], orders: [], logs: [],
      newsletter: [], rewardClaims: [], metrics: {}, telemetry: { tick: 0 }
    });
    let entered;
    let release;
    const started = new Promise((resolve) => { entered = resolve; });
    const gate = new Promise((resolve) => { release = resolve; });

    const transaction = adapter.withTransaction(async ({ repository }) => {
      await repository.insert('users', { id: 'tx-user', email: 'tx@example.com' });
      expect(await repository.findById('users', 'tx-user')).not.toBeNull();
      entered();
      await gate;
      throw new Error('rollback');
    });

    await started;
    const outsideWrite = adapter.insert('users', { id: 'outside-user', email: 'outside@example.com' });
    release();
    await expect(transaction).rejects.toThrow('rollback');
    await outsideWrite;

    expect(await adapter.findById('users', 'tx-user')).toBeNull();
    expect(await adapter.findById('users', 'outside-user')).not.toBeNull();
  });

  it('projects legacy product quantities into stock rows without inventing movement events', () => {
    const records = recordsForState({
      products: [{ id: 'p-1', sku: 'SKU-1', stock: 4, warehouse_hub: 'HUB-1' }]
    }, 'stock');
    expect(records).toEqual([{
      id: 'SKU-1:HUB-1', sku: 'SKU-1', hubCode: 'HUB-1',
      onHand: 4, reserved: 0, projection: true
    }]);
  });

  it('keeps the local stock collection projection synchronized with product quantities', async () => {
    const { adapter } = await createTempAdapter({
      users: [], products: [{ id: 'p-1', sku: 'SKU-1', stock: 4, warehouse_hub: 'HUB-1' }],
      warehouses: [], orders: [], logs: [], newsletter: [], rewardClaims: [],
      metrics: {}, telemetry: { tick: 0 }
    });
    expect(await adapter.find('stock')).toEqual([{
      id: 'SKU-1:HUB-1', sku: 'SKU-1', hubCode: 'HUB-1',
      onHand: 4, reserved: 0, projection: true
    }]);
    const state = await adapter.readState();
    state.products[0].stock = 9;
    await adapter.writeState(state);
    expect((await adapter.find('stock'))[0].onHand).toBe(9);
  });

  it('keeps collection-owned arrays out of the metadata document', () => {
    const metadata = extractMetadata({
      users: [{ id: 'u-1' }], products: [], warehouses: [], orders: [], logs: [],
      newsletter: [], rewardClaims: [], metrics: { efficiencyScore: 12 },
      telemetry: { tick: 1 }, sre: { alerts: [{ id: 'a-1' }], audit: [] }
    });
    expect(metadata.users).toBeUndefined();
    expect(metadata.sre.alerts).toBeUndefined();
    expect(metadata.metrics.efficiencyScore).toBe(12);
  });

  it('automatically carries repository writes into the active Atlas transaction session', async () => {
    const database = new FakeDatabase();
    const adapter = createMongoAdapter({ client: new FakeClient(), database });
    await adapter.withTransaction(async ({ repository }) => {
      await repository.insert('users', { id: 'tx-user', email: 'tx@example.com' });
    });
    expect(database.collection('users').lastSession).not.toBeNull();
    expect(await adapter.findById('users', 'tx-user')).not.toBeNull();
  });

  it('backs up and migrates the old application_state document exactly once', async () => {
    const database = new FakeDatabase();
    const legacyState = {
      schemaVersion: 2, dataMode: 'production',
      users: [{ id: 'USER-1', email: 'legacy@example.com', role: 'user', passwordHash: '$2b$hash' }],
      products: [{ id: 'PROD-1', sku: 'SKU-1', stock: 7, warehouse_hub: 'HUB-1' }],
      warehouses: [{ id: 'HUB-1', code: 'HUB-1', name: 'Hub 1' }],
      orders: [{ id: 'ORD-1', buyerId: 'USER-1', items: [{ productId: 'PROD-1', quantity: 2 }] }], logs: [], newsletter: [], rewardClaims: [],
      metrics: { efficiencyScore: 0 }, telemetry: { tick: 0 }
    };
    database.collection('application_state').documents.set('primary', {
      _id: 'primary', state: structuredClone(legacyState), updatedAt: new Date()
    });
    const adapter = createMongoAdapter({ client: new FakeClient(), database });
    await adapter.initialize({ fallbackState: { dataMode: 'production' } });

    expect(adapter.migration.status).toBe('migrated');
    expect(await adapter.count('users')).toBe(1);
    expect(await adapter.count('products')).toBe(1);
    expect(await adapter.count('stock')).toBe(1);
    expect(await adapter.count('stockMovements')).toBe(0);
    expect(await adapter.count('orderItems')).toBe(1);
    const backup = await adapter.findById('migrationBackups', 'legacy:application_state:primary');
    expect(backup.sourceDocument.state.users[0].passwordHash).toBe('$2b$hash');

    const hydrated = await adapter.readState();
    expect(hydrated.users[0].passwordHash).toBe('$2b$hash');
    expect(hydrated.products[0].stock).toBe(7);
    expect(hydrated.products[0].originWarehouseId).toBe('HUB-1');
    expect(hydrated.users[0].role).toBe('buyer');
    expect(hydrated.users[0].filerStatus).toBe('unverified');
    expect(hydrated.orders[0].userId).toBe('USER-1');
    expect(hydrated.orderItems).toHaveLength(1);
    expect(hydrated.orderItems[0].priceStatus).toBe('legacy_unavailable');
    expect(hydrated.dataMode).toBe('production');

    const reloaded = createMongoAdapter({ client: new FakeClient(), database });
    await reloaded.initialize({ fallbackState: { dataMode: 'demo' } });
    expect((await reloaded.readState()).dataMode).toBe('production');
  });

  it('stores the stockMovements state alias in the canonical movements MongoDB collection', async () => {
    const database = new FakeDatabase();
    const adapter = createMongoAdapter({ client: new FakeClient(), database });
    await adapter.initialize({ fallbackState: {
      dataMode: 'production', users: [], products: [], warehouses: [], orders: [],
      orderItems: [], movements: [], tariffRules: [], logs: [], newsletter: [],
      rewardClaims: [], metrics: {}, telemetry: { tick: 0 }, sre: { audit: [] }
    } });
    await adapter.insert('movements', {
      id: 'MOV-1', sku: 'SKU-1', hubCode: 'WH-1', type: 'RECEIVE',
      qty: 5, reason: 'opening_balance', refType: 'opening_balance',
      refId: 'opening-1', actorId: 'system', at: '2026-11-13T00:00:00.000Z'
    });
    expect(await adapter.count('stockMovements')).toBe(1);
    expect(await adapter.count('movements')).toBe(1);
    expect(database.collection('movements').documents.has('MOV-1')).toBe(true);
    expect(database.collection('users').options.validationAction).toBe('error');
    expect(database.collection('stockMovements').options.validator.$jsonSchema.required).toContain('refId');
    expect(database.collection('stockMovements').documents.size).toBe(0);
    await expect(adapter.remove('movements', 'MOV-1')).rejects.toThrow('append-only');
  });

  it('stores large integer minor-unit amounts as BSON int64 values', async () => {
    const database = new FakeDatabase();
    const adapter = createMongoAdapter({ client: new FakeClient(), database });
    await adapter.initialize({ fallbackState: {
      dataMode: 'production', users: [], products: [], warehouses: [], orders: [],
      orderItems: [], movements: [], tariffRules: [], logs: [], newsletter: [],
      rewardClaims: [], metrics: {}, telemetry: { tick: 0 }, sre: { audit: [] }
    } });
    await adapter.insert('orders', { id: 'ORD-LONG', totalMinor: 5000000000, currency: 'PKR' });
    const stored = database.collection('orders').documents.get('ORD-LONG');
    expect(stored.totalMinor._bsontype === 'Long' || (Number.isInteger(stored.totalMinor.low) && Number.isInteger(stored.totalMinor.high))).toBe(true);
    expect(await adapter.findById('orders', 'ORD-LONG')).toMatchObject({ totalMinor: 5000000000 });
  });

  it('refuses to overwrite unmarked populated collections', async () => {
    const database = new FakeDatabase();
    database.collection('products').documents.set('PROD-1', { _id: 'PROD-1', id: 'PROD-1', sku: 'SKU-1' });
    const adapter = createMongoAdapter({ client: new FakeClient(), database });
    await expect(adapter.initialize({ fallbackState: { dataMode: 'production' } }))
      .rejects.toThrow('refusing to initialize an ambiguous database');
  });
});
