'use strict';

const { AsyncLocalStorage } = require('node:async_hooks');
const { randomUUID } = require('node:crypto');
const {
  COLLECTION_NAMES,
  INDEXES,
  COLLECTION_VALIDATORS,
  APPEND_ONLY_COLLECTIONS,
  canonicalCollectionName,
  assertAppendOnlyTransition,
  STATE_PATHS,
  clone,
  normalizeStateShape,
  recordsForState,
  applyRecordsToState,
  extractMetadata,
  documentId,
  stripMongoId
} = require('./collection-map');

const META_COLLECTION = 'application_meta';
const BACKUP_COLLECTION = 'migrationBackups';
const STORAGE_SCHEMA_VERSION = 1;
const TTL_COLLECTIONS = new Set(['healthChecks', 'idempotencyKeys', 'loginAttempts']);

function toMongoDocument(name, record) {
  const document = clone(record);
  document._id = documentId(document);
  delete document._idOriginal;
  if (TTL_COLLECTIONS.has(name) && typeof document.at === 'string') {
    const parsed = new Date(document.at);
    if (!Number.isNaN(parsed.getTime())) document.at = parsed;
  }
  return document;
}

function fromMongoDocument(name, document) {
  const result = stripMongoId(document);
  if (!result.id && document._id !== undefined) result.id = String(document._id);
  if (TTL_COLLECTIONS.has(name) && result.at instanceof Date) result.at = result.at.toISOString();
  return result;
}

function cleanMetadataDocument(document) {
  const result = clone(document);
  delete result._id;
  delete result.storageSchemaVersion;
  delete result.migration;
  delete result.updatedAt;
  return result;
}

class MongoAdapter {
  constructor(options) {
    if (!options || !options.client || !options.database) {
      throw new Error('mongoAdapter requires a connected MongoClient and database');
    }
    this.client = options.client;
    this.database = options.database;
    this.legacyCollectionName = options.legacyCollectionName || 'application_state';
    this.transactionContext = new AsyncLocalStorage();
    this.lastCollectionJson = new Map();
    this.lastMetadataJson = null;
    this.migration = null;
    this.kind = 'mongodb';
    this.supportsTransactions = true;
  }

  collection(name) {
    const canonical = canonicalCollectionName(name);
    if (!COLLECTION_NAMES.includes(canonical)) throw new Error('Unknown repository collection: ' + name);
    return this.database.collection(canonical);
  }

  async createIndexes() {
    if (typeof this.database.listCollections === 'function' && typeof this.database.createCollection === 'function') {
      for (const [name, validator] of Object.entries(COLLECTION_VALIDATORS)) {
        const cursor = this.database.listCollections({ name }, { nameOnly: true });
        if (!(await cursor.hasNext())) {
          try {
            await this.database.createCollection(name, {
              validator,
              validationLevel: 'strict',
              validationAction: 'error'
            });
          } catch (error) {
            if (error.code !== 48 && error.codeName !== 'NamespaceExists') throw error;
          }
        }
      }
    }
    for (const [name, indexes] of Object.entries(INDEXES)) {
      await this.collection(name).createIndexes(indexes);
    }
  }

  async withTransaction(callback) {
    const session = this.client.startSession();
    try {
      let result;
      await session.withTransaction(async () => {
        result = await this.transactionContext.run(session, () => callback({ session, repository: this }));
      });
      return result;
    } finally {
      await session.endSession();
    }
  }

  async initialize(options = {}) {
    await this.createIndexes();
    const metaCollection = this.collection(META_COLLECTION);
    const existingMeta = await metaCollection.findOne({ _id: 'primary' });
    if (existingMeta) return this;

    const legacyCollection = this.database.collection(this.legacyCollectionName);
    const legacy = await legacyCollection.findOne({ _id: 'primary' });
    const namesToCheck = COLLECTION_NAMES.filter((name) => name !== META_COLLECTION && name !== BACKUP_COLLECTION);
    const counts = await Promise.all(namesToCheck.map((name) => this.collection(name).countDocuments({})));
    const collectionRecordsExist = counts.some((count) => count > 0);

    if (legacy && legacy.state && typeof legacy.state === 'object' && !Array.isArray(legacy.state)) {
      if (collectionRecordsExist) {
        throw new Error('Multi-collection records already exist without application_meta; refusing to overwrite during legacy migration.');
      }

      const backupId = 'legacy:' + this.legacyCollectionName + ':primary';
      await this.collection(BACKUP_COLLECTION).replaceOne(
        { _id: backupId },
        {
          _id: backupId,
          sourceCollection: this.legacyCollectionName,
          sourceId: 'primary',
          backedUpAt: new Date(),
          sourceDocument: legacy
        },
        { upsert: true }
      );

      this.migration = {
        status: 'migrated',
        source: this.legacyCollectionName,
        sourceId: 'primary',
        backupId,
        completedAt: new Date().toISOString()
      };
      await this.writeState(legacy.state, { migration: this.migration });
      return this;
    }

    if (collectionRecordsExist) {
      throw new Error('Multi-collection records exist but application_meta is missing; refusing to initialize an ambiguous database.');
    }
    if (!options.fallbackState) {
      throw new Error('No legacy application_state document or fallbackState was provided.');
    }

    this.migration = { status: 'initialized', source: null, completedAt: new Date().toISOString() };
    await this.writeState(options.fallbackState, { migration: this.migration });
    return this;
  }

  async readState() {
    const metaDocument = await this.collection(META_COLLECTION).findOne({ _id: 'primary' });
    if (!metaDocument) throw new Error('MongoDB repository is not initialized; application_meta/primary is missing.');
    const state = normalizeStateShape(cleanMetadataDocument(metaDocument));

    const records = await Promise.all(Object.keys(STATE_PATHS).map(async (name) => {
      const found = await this.find(name, {});
      return [name, found];
    }));
    for (const [name, rows] of records) applyRecordsToState(state, name, rows);

    this.lastCollectionJson.clear();
    for (const [name] of records) {
      this.lastCollectionJson.set(name, JSON.stringify(recordsForState(state, name) || []));
    }
    this.lastMetadataJson = JSON.stringify(extractMetadata(state));
    return state;
  }

  async writeState(nextState, control = {}) {
    const state = normalizeStateShape(nextState);
    const changedCollections = [];
    for (const name of Object.keys(STATE_PATHS)) {
      const records = recordsForState(state, name) || [];
      const serialized = JSON.stringify(records);
      if (this.lastCollectionJson.get(name) !== serialized) {
        if (APPEND_ONLY_COLLECTIONS.has(canonicalCollectionName(name))) {
          const previous = JSON.parse(this.lastCollectionJson.get(name) || '[]');
          assertAppendOnlyTransition(name, previous, records);
        }
        changedCollections.push({ name, records, serialized });
      }
    }

    const metadata = extractMetadata(state);
    const metadataJson = JSON.stringify(metadata);
    const metadataChanged = this.lastMetadataJson !== metadataJson || Boolean(control.migration);
    if (!changedCollections.length && !metadataChanged) return;

    await this.withTransaction(async ({ session }) => {
      for (const entry of changedCollections) {
        const collection = this.collection(entry.name);
        if (APPEND_ONLY_COLLECTIONS.has(canonicalCollectionName(entry.name))) {
          const previous = JSON.parse(this.lastCollectionJson.get(entry.name) || '[]');
          const appended = entry.records.slice(previous.length);
          if (appended.length) {
            await collection.insertMany(appended.map((record) => toMongoDocument(entry.name, record)), {
              ordered: true,
              session
            });
          }
          continue;
        }
        await collection.deleteMany({}, { session });
        if (entry.records.length) {
          await collection.insertMany(entry.records.map((record) => toMongoDocument(entry.name, record)), {
            ordered: true,
            session
          });
        }
      }
      const existing = await this.collection(META_COLLECTION).findOne({ _id: 'primary' }, { session });
      const migration = control.migration || existing?.migration || this.migration || null;
      const metaDocument = {
        _id: 'primary',
        ...metadata,
        storageSchemaVersion: STORAGE_SCHEMA_VERSION,
        ...(migration ? { migration } : {}),
        updatedAt: new Date()
      };
      await this.collection(META_COLLECTION).replaceOne(
        { _id: 'primary' },
        metaDocument,
        { upsert: true, session }
      );
    });

    for (const entry of changedCollections) this.lastCollectionJson.set(entry.name, entry.serialized);
    this.lastMetadataJson = metadataJson;
  }

  transactionOptions(options = {}) {
    const session = options.session || this.transactionContext.getStore();
    return session ? { ...options, session } : options;
  }

  async findById(name, id, options = {}) {
    const document = await this.collection(name).findOne({ _id: String(id) }, this.transactionOptions(options));
    return document ? fromMongoDocument(name, document) : null;
  }

  async find(name, filter = {}, options = {}) {
    const findOptions = {};
    const effectiveOptions = this.transactionOptions(options);
    if (effectiveOptions.session) findOptions.session = effectiveOptions.session;
    if (options.projection) findOptions.projection = options.projection;
    let cursor = this.collection(name).find(filter, findOptions);
    if (options.sort) cursor = cursor.sort(options.sort);
    if (Number.isFinite(options.skip) && options.skip > 0) cursor = cursor.skip(options.skip);
    if (Number.isFinite(options.limit) && options.limit >= 0) cursor = cursor.limit(options.limit);
    const rows = await cursor.toArray();
    return rows.map((row) => fromMongoDocument(name, row));
  }

  async insert(name, record, options = {}) {
    const input = clone(record);
    if (!input.id && !input._id && !input.code && !input.key && !(input.sku && input.hubCode)) input.id = randomUUID();
    const document = toMongoDocument(name, input);
    await this.collection(name).insertOne(document, this.transactionOptions(options));
    return fromMongoDocument(name, document);
  }

  async update(name, id, changes, options = {}) {
    if (APPEND_ONLY_COLLECTIONS.has(canonicalCollectionName(name))) {
      const error = new Error(name + ' is append-only; updates are not permitted');
      error.code = 'IMMUTABLE_COLLECTION';
      throw error;
    }
    const cleanChanges = clone(changes);
    delete cleanChanges._id;
    await this.collection(name).updateOne(
      { _id: String(id) },
      { $set: cleanChanges, $setOnInsert: { _id: String(id) } },
      { upsert: Boolean(options.upsert), ...this.transactionOptions(options) }
    );
    return this.findById(name, id, options);
  }

  async remove(name, id, options = {}) {
    if (APPEND_ONLY_COLLECTIONS.has(canonicalCollectionName(name))) {
      const error = new Error(name + ' is append-only; deletes are not permitted');
      error.code = 'IMMUTABLE_COLLECTION';
      throw error;
    }
    const result = await this.collection(name).deleteOne({ _id: String(id) }, this.transactionOptions(options));
    return result.deletedCount || 0;
  }

  async count(name, filter = {}, options = {}) {
    return this.collection(name).countDocuments(filter, this.transactionOptions(options));
  }
}

function createMongoAdapter(options) {
  return new MongoAdapter(options);
}

module.exports = {
  MongoAdapter,
  createMongoAdapter,
  STORAGE_SCHEMA_VERSION,
  toMongoDocument,
  fromMongoDocument
};
