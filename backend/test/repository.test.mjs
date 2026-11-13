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
  async insertOne(document) {
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

  it('projects legacy product quantities into stock rows without inventing movement events', () => {
    const records = recordsForState({
      products: [{ id: 'p-1', sku: 'SKU-1', stock: 4, warehouse_hub: 'HUB-1' }]
    }, 'stock');
    expect(records).toEqual([{
      id: 'SKU-1:HUB-1', sku: 'SKU-1', hubCode: 'HUB-1',
      onHand: 4, reserved: 0, projection: true
    }]);
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

  it('backs up and migrates the old application_state document exactly once', async () => {
    const database = new FakeDatabase();
    const legacyState = {
      schemaVersion: 2, dataMode: 'production',
      users: [{ id: 'USER-1', email: 'legacy@example.com', passwordHash: '$2b$hash' }],
      products: [{ id: 'PROD-1', sku: 'SKU-1', stock: 7, warehouse_hub: 'HUB-1' }],
      warehouses: [{ id: 'HUB-1', name: 'Hub 1' }],
      orders: [], logs: [], newsletter: [], rewardClaims: [],
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
    const backup = await adapter.findById('migrationBackups', 'legacy:application_state:primary');
    expect(backup.sourceDocument.state.users[0].passwordHash).toBe('$2b$hash');

    const hydrated = await adapter.readState();
    expect(hydrated.users[0].passwordHash).toBe('$2b$hash');
    expect(hydrated.products[0].stock).toBe(7);
    expect(hydrated.dataMode).toBe('production');

    const reloaded = createMongoAdapter({ client: new FakeClient(), database });
    await reloaded.initialize({ fallbackState: { dataMode: 'demo' } });
    expect((await reloaded.readState()).dataMode).toBe('production');
  });

  it('refuses to overwrite unmarked populated collections', async () => {
    const database = new FakeDatabase();
    database.collection('products').documents.set('PROD-1', { _id: 'PROD-1', id: 'PROD-1', sku: 'SKU-1' });
    const adapter = createMongoAdapter({ client: new FakeClient(), database });
    await expect(adapter.initialize({ fallbackState: { dataMode: 'production' } }))
      .rejects.toThrow('refusing to initialize an ambiguous database');
  });
});
