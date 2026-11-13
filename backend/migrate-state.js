'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { MongoClient } = require('mongodb');
const { DB_PATH, seedDatabase } = require('./seed');
const { createEmptyProductionState } = require('./production-state');
const { createRepository } = require('./repository');

function loadEnvFile() {
  const envFilePath = path.join(__dirname, '.env');
  return fs.readFile(envFilePath, 'utf8').then((contents) => {
    for (const line of contents.split(/\r?\n/)) {
      const valueLine = line.trim();
      if (!valueLine || valueLine.startsWith('#')) continue;
      const separator = valueLine.indexOf('=');
      if (separator < 1) continue;
      const key = valueLine.slice(0, separator).trim();
      if (Object.prototype.hasOwnProperty.call(process.env, key)) continue;
      let value = valueLine.slice(separator + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  }).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
}

async function migrateFileState() {
  let source;
  try {
    source = await fs.readFile(DB_PATH, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error('backend/db.json does not exist. File mode already uses the atomic JSON adapter; there is no local state to validate or back up.');
    }
    throw error;
  }
  const backupDirectory = path.join(__dirname, 'backups');
  await fs.mkdir(backupDirectory, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupDirectory, 'db-pre-migration-' + stamp + '.json');
  await fs.writeFile(backupPath, source, { encoding: 'utf8', mode: 0o600 });

  const adapter = createRepository({
    filePath: DB_PATH,
    loadInitial: async () => { throw new Error('Existing file state was expected'); }
  });
  await adapter.initialize();
  const state = await adapter.readState();
  const counts = {
    users: state.users.length,
    products: state.products.length,
    warehouses: state.warehouses.length,
    orders: state.orders.length,
    logs: state.logs.length
  };
  process.stdout.write(JSON.stringify({
    adapter: 'file',
    status: 'validated',
    note: 'The local adapter intentionally retains the single db.json file format; no MongoDB collections were created.',
    backupPath,
    counts
  }, null, 2) + '\n');
}

async function migrateMongoState() {
  const client = new MongoClient(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 10000,
    maxPoolSize: 5
  });
  try {
    await client.connect();
    const database = client.db(process.env.MONGODB_DB_NAME || 'velosupply');
    const legacyCollectionName = process.env.MONGODB_STATE_COLLECTION || 'application_state';
    const adapter = createRepository({ client, database, legacyCollectionName });
    await adapter.initialize({ fallbackState: createEmptyProductionState() });
    const state = await adapter.readState();
    const names = ['users', 'products', 'warehouses', 'suppliers', 'stock', 'movements', 'orderItems', 'orders', 'invoices', 'returns', 'purchaseOrders', 'messages', 'incidents', 'alerts', 'auditLogs', 'tariffRules', 'healthChecks', 'idempotencyKeys', 'simulationRuns', 'loginAttempts'];
    const counts = {};
    for (const name of names) counts[name] = await adapter.count(name);
    process.stdout.write(JSON.stringify({
      adapter: 'mongodb',
      status: adapter.migration?.status || 'already-initialized',
      migration: adapter.migration || null,
      dataMode: state.dataMode || 'unclassified',
      counts
    }, null, 2) + '\n');
  } finally {
    await client.close();
  }
}

async function main() {
  await loadEnvFile();
  if (process.env.MONGODB_URI) return migrateMongoState();
  return migrateFileState();
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write('State migration failed: ' + error.message + '\n');
    process.exitCode = 1;
  });
}

module.exports = { main, migrateFileState, migrateMongoState, loadEnvFile };
