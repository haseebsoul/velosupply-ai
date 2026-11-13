'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { AsyncLocalStorage } = require('node:async_hooks');
const {
  STATE_PATHS,
  APPEND_ONLY_COLLECTIONS,
  canonicalCollectionName,
  assertAppendOnlyTransition,
  clone,
  getAtPath,
  setAtPath,
  normalizeStateShape,
  recordsForState,
  documentId,
  matchesFilter
} = require('./collection-map');

async function writeAtomic(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = filePath + '.' + process.pid + '.' + randomUUID() + '.tmp';
  await fs.writeFile(temporaryPath, JSON.stringify(data, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
  try {
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true });
    throw error;
  }
}

function createFileAdapter(options) {
  const filePath = options.filePath;
  const loadInitial = options.loadInitial;
  if (!filePath) throw new Error('fileAdapter requires filePath');
  if (typeof loadInitial !== 'function') throw new Error('fileAdapter requires loadInitial');

  let state = null;
  let queue = Promise.resolve();
  const transactionContext = new AsyncLocalStorage();

  async function flush() {
    await writeAtomic(filePath, state);
  }

  function serializeWrite(mutator) {
    if (transactionContext.getStore()) {
      mutator();
      return Promise.resolve();
    }
    const operation = queue.catch(() => {}).then(async () => {
      mutator();
      await flush();
    });
    queue = operation.catch(() => {});
    return operation;
  }

  function collectionPath(name) {
    const pathValue = STATE_PATHS[canonicalCollectionName(name)];
    if (!pathValue) throw new Error('Unsupported file repository collection: ' + name);
    return pathValue;
  }

  async function currentRecords(name) {
    if (!transactionContext.getStore()) await queue;
    const pathValue = collectionPath(name);
    const records = getAtPath(state, pathValue);
    return Array.isArray(records) ? records : [];
  }

  const adapter = {
    kind: 'file',
    filePath,

    async initialize() {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      try {
        state = normalizeStateShape(JSON.parse(await fs.readFile(filePath, 'utf8')));
        state.stock = recordsForState(state, 'stock');
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        state = normalizeStateShape(await loadInitial());
        state.stock = recordsForState(state, 'stock');
        await flush();
      }
      return adapter;
    },

    async readState() {
      await queue;
      return clone(state);
    },

    async writeState(nextState) {
      const next = normalizeStateShape(nextState);
      next.stock = recordsForState(next, 'stock');
      await serializeWrite(() => {
        for (const name of APPEND_ONLY_COLLECTIONS) {
          const pathValue = collectionPath(name);
          assertAppendOnlyTransition(name, getAtPath(state, pathValue), getAtPath(next, pathValue));
        }
        state = next;
      });
    },

    async findById(name, id) {
      const records = await currentRecords(name);
      return clone(records.find((item) => String(documentId(item)) === String(id)) || null);
    },

    async find(name, filter = {}, options = {}) {
      let records = (await currentRecords(name)).filter((item) => matchesFilter(item, filter));
      if (options.sort) {
        const fields = Object.entries(options.sort);
        records.sort((a, b) => {
          for (const [field, direction] of fields) {
            const av = field.split('.').reduce((v, k) => v == null ? undefined : v[k], a);
            const bv = field.split('.').reduce((v, k) => v == null ? undefined : v[k], b);
            if (av === bv) continue;
            if (av == null) return -1 * direction;
            if (bv == null) return 1 * direction;
            return (av < bv ? -1 : 1) * direction;
          }
          return 0;
        });
      }
      const skip = Math.max(0, Number(options.skip) || 0);
      if (skip) records = records.slice(skip);
      if (Number.isFinite(options.limit) && options.limit >= 0) records = records.slice(0, options.limit);
      return clone(records);
    },

    async insert(name, document) {
      const record = clone(document);
      if (!record.id && !record.code && !record.key && !(record.sku && record.hubCode)) record.id = randomUUID();
      const id = documentId(record);
      let inserted;
      await serializeWrite(() => {
        const pathValue = collectionPath(name);
        const records = getAtPath(state, pathValue);
        if (records.some((item) => String(documentId(item)) === id)) {
          const error = new Error('Duplicate repository key: ' + id);
          error.code = 'DUPLICATE_KEY';
          throw error;
        }
        records.push(record);
        inserted = clone(record);
      });
      return inserted;
    },

    async update(name, id, changes, options = {}) {
      if (APPEND_ONLY_COLLECTIONS.has(canonicalCollectionName(name))) {
        const error = new Error(name + ' is append-only; updates are not permitted');
        error.code = 'IMMUTABLE_COLLECTION';
        throw error;
      }
      let updated = null;
      await serializeWrite(() => {
        const records = getAtPath(state, collectionPath(name));
        const index = records.findIndex((item) => String(documentId(item)) === String(id));
        if (index < 0) {
          if (!options.upsert) return;
          const created = { ...clone(changes), id: String(id) };
          records.push(created);
          updated = clone(created);
          return;
        }
        records[index] = { ...records[index], ...clone(changes), id: records[index].id || String(id) };
        updated = clone(records[index]);
      });
      return updated;
    },

    async remove(name, id) {
      if (APPEND_ONLY_COLLECTIONS.has(canonicalCollectionName(name))) {
        const error = new Error(name + ' is append-only; deletes are not permitted');
        error.code = 'IMMUTABLE_COLLECTION';
        throw error;
      }
      let deleted = 0;
      await serializeWrite(() => {
        const pathValue = collectionPath(name);
        const records = getAtPath(state, pathValue);
        const kept = records.filter((item) => String(documentId(item)) !== String(id));
        deleted = records.length - kept.length;
        setAtPath(state, pathValue, kept);
      });
      return deleted;
    },

    async count(name, filter = {}) {
      return (await currentRecords(name)).filter((item) => matchesFilter(item, filter)).length;
    },

    async withTransaction(callback) {
      const operation = queue.catch(() => {}).then(async () => {
        const before = clone(state);
        return transactionContext.run({ adapter }, async () => {
          try {
            const result = await callback({ session: null, repository: adapter });
            await flush();
            return result;
          } catch (error) {
            state = before;
            await flush();
            throw error;
          }
        });
      });
      queue = operation.catch(() => {});
      return operation;
    }
  };

  return adapter;
}

module.exports = { createFileAdapter, writeAtomic };
