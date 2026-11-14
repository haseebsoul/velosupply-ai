'use strict';

const { AsyncLocalStorage } = require('node:async_hooks');
const { randomUUID } = require('node:crypto');
const { Long } = require('mongodb');
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

function convertMinorUnitsToLong(value) {
  if (Array.isArray(value)) return value.map(convertMinorUnitsToLong);
  if (!value || typeof value !== 'object' || value instanceof Date) return value;
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    if (/Minor$/.test(key) && typeof child === 'number' && Number.isSafeInteger(child)) {
      result[key] = Long.fromNumber(child);
    } else {
      result[key] = convertMinorUnitsToLong(child);
    }
  }
  return result;
}

function convertLongsToNumbers(value) {
  if (Array.isArray(value)) return value.map(convertLongsToNumbers);
  if (!value || typeof value !== 'object' || value instanceof Date) return value;
  if (value._bsontype && value._bsontype !== 'Long') return value;
  const isLong = value._bsontype === 'Long' || (Number.isInteger(value.low) && Number.isInteger(value.high) && typeof value.unsigned === 'boolean');
  if (isLong) {
    const longValue = value._bsontype === 'Long' ? value : Long.fromBits(value.low, value.high, value.unsigned);
    const number = longValue.toNumber();
    if (!Number.isSafeInteger(number)) throw new RangeError('MongoDB integer minor-unit value exceeds JavaScript safe integer range');
    return number;
  }
  const result = {};
  for (const [key, child] of Object.entries(value)) result[key] = convertLongsToNumbers(child);
  return result;
}

function toMongoDocument(name, record) {
  const document = convertMinorUnitsToLong(clone(record));
  document._id = documentId(document);
  delete document._idOriginal;
  if (TTL_COLLECTIONS.has(name) && typeof document.at === 'string') {
    const parsed = new Date(document.at);
    if (!Number.isNaN(parsed.getTime())) document.at = parsed;
  }
  return document;
}

function fromMongoDocument(name, document) {
  const result = stripMongoId(convertLongsToNumbers(document));
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
    this.expectedRevision = null;
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
    const existingContext = this.transactionContext.getStore();
    if (existingContext) {
      return callback({ session: existingContext.session, repository: this });
    }
    const session = this.client.startSession();
    let committedRevision = null;
    try {
      let result;
      const expectedRevision = this.expectedRevision;
      await session.withTransaction(async () => {
        const metaCollection = this.collection(META_COLLECTION);
        const existingMeta = await metaCollection.findOne({ _id: 'primary' }, { session });
        const actualRevision = existingMeta && Number.isSafeInteger(existingMeta.revision)
          ? existingMeta.revision : 0;

        if (expectedRevision !== null && actualRevision !== expectedRevision) {
          // Fail this stale request but allow a later retry to use the newest committed revision.
          this.expectedRevision = actualRevision;
          const error = new Error('Concurrent MongoDB write detected; reload state and retry.');
          error.code = 'WRITE_CONFLICT';
          error.status = 409;
          throw error;
        }

        const context = { session, dirty: false };
        result = await this.transactionContext.run(context, () => callback({ session, repository: this }));
        if (context.dirty && existingMeta) {
          const update = await metaCollection.updateOne(
            { _id: 'primary', revision: actualRevision },
            { $inc: { revision: 1 }, $set: { updatedAt: new Date() } },
            { session }
          );
          if (!update.matchedCount) {
            const error = new Error('Concurrent MongoDB metadata update detected.');
            error.code = 'WRITE_CONFLICT';
            error.status = 409;
            throw error;
          }
          committedRevision = actualRevision + 1;
        } else if (context.dirty && !existingMeta && expectedRevision !== null) {
          const error = new Error('MongoDB metadata disappeared during a repository write.');
          error.code = 'WRITE_CONFLICT';
          error.status = 409;
          throw error;
        } else if (existingMeta) {
          committedRevision = actualRevision;
        }
      });
      if (committedRevision !== null) this.expectedRevision = committedRevision;
      return result;
    } finally {
      await session.endSession();
    }
  }

  markTransactionDirty() {
    const context = this.transactionContext.getStore();
    if (!context) throw new Error('Repository mutation must run in a transaction');
    context.dirty = true;
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
    this.expectedRevision = Number.isSafeInteger(metaDocument.revision) ? metaDocument.revision : 0;

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

    const expectedRevision = this.expectedRevision;
    const nextRevision = (Number.isSafeInteger(expectedRevision) ? expectedRevision : 0) + 1;
    await this.withTransaction(async ({ session }) => {
      const metaCollection = this.collection(META_COLLECTION);
      const existing = await metaCollection.findOne({ _id: 'primary' }, { session });
      const actualRevision = existing && Number.isSafeInteger(existing.revision) ? existing.revision : 0;
      if ((expectedRevision === null && existing) ||
          (expectedRevision !== null && actualRevision !== expectedRevision)) {
        const error = new Error('Concurrent MongoDB state change detected; refresh state before retrying this write.');
        error.code = 'WRITE_CONFLICT';
        error.status = 409;
        throw error;
      }

      for (const entry of changedCollections) {
        const collection = this.collection(entry.name);
        const previous = JSON.parse(this.lastCollectionJson.get(entry.name) || '[]');
        if (APPEND_ONLY_COLLECTIONS.has(canonicalCollectionName(entry.name))) {
          const appended = entry.records.slice(previous.length);
          if (appended.length) {
            await collection.insertMany(appended.map((record) => toMongoDocument(entry.name, record)), {
              ordered: true,
              session
            });
          }
          continue;
        }

        const previousById = new Map(previous.map((record) => [documentId(record), record]));
        const nextIds = new Set();
        for (const record of entry.records) {
          const id = documentId(record);
          nextIds.add(id);
          if (JSON.stringify(previousById.get(id)) === JSON.stringify(record)) continue;
          const document = toMongoDocument(entry.name, record);
          await collection.replaceOne({ _id: document._id }, document, { upsert: true, session });
        }
        const removedIds = [...previousById.keys()].filter((id) => !nextIds.has(id));
        if (removedIds.length) {
          await collection.deleteMany({ _id: { $in: removedIds } }, { session });
        }
      }

      const migration = control.migration || existing?.migration || this.migration || null;
      const metaDocument = {
        _id: 'primary',
        ...metadata,
        storageSchemaVersion: STORAGE_SCHEMA_VERSION,
        revision: nextRevision,
        ...(migration ? { migration } : {}),
        updatedAt: new Date()
      };
      if (existing) {
        const result = await metaCollection.replaceOne(
          { _id: 'primary', revision: actualRevision },
          metaDocument,
          { session }
        );
        if (!result.matchedCount) {
          const error = new Error('Concurrent MongoDB metadata update detected.');
          error.code = 'WRITE_CONFLICT';
          error.status = 409;
          throw error;
        }
      } else {
        await metaCollection.insertOne(metaDocument, { session });
      }
    });

    this.expectedRevision = nextRevision;
    for (const entry of changedCollections) this.lastCollectionJson.set(entry.name, entry.serialized);
    this.lastMetadataJson = metadataJson;
  }

  transactionOptions(options = {}) {
    const context = this.transactionContext.getStore();
    const session = options.session || context?.session;
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
    if (!this.transactionContext.getStore() && !options.session) {
      return this.withTransaction(({ repository }) => repository.insert(name, record, options));
    }
    const input = clone(record);
    if (!input.id && !input._id && !input.code && !input.key && !(input.sku && input.hubCode)) input.id = randomUUID();
    const document = toMongoDocument(name, input);
    await this.collection(name).insertOne(document, this.transactionOptions(options));
    this.markTransactionDirty();
    return fromMongoDocument(name, document);
  }

  async update(name, id, changes, options = {}) {
    if (APPEND_ONLY_COLLECTIONS.has(canonicalCollectionName(name))) {
      const error = new Error(name + ' is append-only; updates are not permitted');
      error.code = 'IMMUTABLE_COLLECTION';
      throw error;
    }
    if (!this.transactionContext.getStore() && !options.session) {
      return this.withTransaction(({ repository }) => repository.update(name, id, changes, options));
    }
    const cleanChanges = convertMinorUnitsToLong(clone(changes));
    delete cleanChanges._id;
    const result = await this.collection(name).updateOne(
      { _id: String(id) },
      { $set: cleanChanges, $setOnInsert: { _id: String(id) } },
      { upsert: Boolean(options.upsert), ...this.transactionOptions(options) }
    );
    if (result.modifiedCount || result.upsertedCount) this.markTransactionDirty();
    return this.findById(name, id, options);
  }

  async remove(name, id, options = {}) {
    if (APPEND_ONLY_COLLECTIONS.has(canonicalCollectionName(name))) {
      const error = new Error(name + ' is append-only; deletes are not permitted');
      error.code = 'IMMUTABLE_COLLECTION';
      throw error;
    }
    if (!this.transactionContext.getStore() && !options.session) {
      return this.withTransaction(({ repository }) => repository.remove(name, id, options));
    }
    const result = await this.collection(name).deleteOne({ _id: String(id) }, this.transactionOptions(options));
    if (result.deletedCount) this.markTransactionDirty();
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
