'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, randomUUID } = require('node:crypto');
const { MongoClient } = require('mongodb');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const { createEmptyProductionState } = require('../production-state');
const { createDomainRepositories } = require('../repository/domain-repositories');
const { createMongoAdapter } = require('../repository/mongo-adapter');

const STAGING_DATABASE = 'velosupply_staging';
const CONFIRMATION = 'I_CONFIRM_VELOSUPPLY_STAGING_ONLY';

function loadBackendEnvironmentFile(env = process.env) {
  const filePath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(filePath)) return;
  const contents = fs.readFileSync(filePath, 'utf8');
  for (const line of contents.split(/\r?\n/)) {
    const valueLine = line.trim();
    if (!valueLine || valueLine.startsWith('#')) continue;
    const separator = valueLine.indexOf('=');
    if (separator < 1) continue;
    const key = valueLine.slice(0, separator).trim();
    if (Object.prototype.hasOwnProperty.call(env, key)) continue;
    let value = valueLine.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
}

function loadStagingConfiguration(env = process.env) {
  const uri = String(env.MONGODB_STAGING_URI || '').trim();
  const databaseName = String(env.MONGODB_STAGING_DB_NAME || '').trim();
  const confirmation = String(env.ATLAS_STAGING_CONFIRM || '').trim();

  if (!uri) {
    throw new Error('MONGODB_STAGING_URI is required; no database connection was attempted.');
  }

  let parsed;
  try {
    parsed = new URL(uri);
  } catch (_error) {
    throw new Error('MONGODB_STAGING_URI is not a valid MongoDB connection URI.');
  }

  if (parsed.protocol !== 'mongodb+srv:' || !parsed.hostname.endsWith('.mongodb.net')) {
    throw new Error('Only a MongoDB Atlas SRV connection URI is accepted by this staging verifier.');
  }
  if (databaseName !== STAGING_DATABASE) {
    throw new Error('MONGODB_STAGING_DB_NAME must be exactly "' + STAGING_DATABASE + '".');
  }
  if (confirmation !== CONFIRMATION) {
    throw new Error('ATLAS_STAGING_CONFIRM must explicitly confirm the staging-only database.');
  }

  return { uri, databaseName };
}

async function run() {
  loadBackendEnvironmentFile();
  const config = loadStagingConfiguration();
  const client = new MongoClient(config.uri, {
    serverSelectionTimeoutMS: 10000,
    maxPoolSize: 5
  });
  const runId = randomUUID();
  const suffix = runId.replaceAll('-', '').slice(0, 16).toUpperCase();
  const sku = 'STG-' + suffix;
  const warehouseCode = 'HUB-KHI';
  const actorId = 'ATLAS-STAGING-' + suffix;
  const idempotencyKey = 'atlas-staging-' + runId;
  const tariffIds = [];
  let repository;
  let warehouse;
  let product;
  let orderId;
  let adminId;
  let buyerId;
  let serverModule;
  let rollbackMovementId;
  const inventoryIdempotencyKey = 'atlas-stock-zero-' + runId;

  try {
    await client.connect();
    const database = client.db(config.databaseName);
    const hello = await client.db('admin').command({ hello: 1 });
    assert.equal(typeof hello.setName, 'string', 'Atlas staging must be a replica set to support transactions');
    assert.equal(hello.isWritablePrimary, true, 'Atlas staging must accept primary writes');

    repository = createMongoAdapter({ client, database, legacyCollectionName: 'application_state' });
    await repository.initialize({ fallbackState: createEmptyProductionState() });
    let state = await repository.readState();

    const preexistingBusinessData = {
      users: await repository.count('users'),
      warehouses: await repository.count('warehouses'),
      products: await repository.count('products'),
      orders: await repository.count('orders')
    };
    if (Object.values(preexistingBusinessData).some((count) => count > 0)) {
      throw new Error('Refusing to run destructive staging fixtures: users, warehouses, products and orders must be empty. Counts: ' +
        JSON.stringify(preexistingBusinessData));
    }

    const existingHub = await repository.find('warehouses', { code: warehouseCode }, { limit: 1 });
    if (existingHub.length) {
      throw new Error('Refusing to overwrite an existing HUB-KHI staging warehouse.');
    }

    const versionBase = Date.now() * 10;
    const tariffRows = [
      {
        id: 'TAR-' + suffix + '-GST',
        code: 'PK-GST',
        version: versionBase,
        source: 'demo-estimate',
        ratePct: 18,
        effectiveFrom: '2000-01-01T00:00:00.000Z',
        effectiveTo: '2999-12-31T23:59:59.999Z'
      },
      {
        id: 'TAR-' + suffix + '-DELIVERY',
        code: 'PK-DELIVERY-KARACHI',
        version: versionBase + 1,
        source: 'demo-estimate',
        amountPkr: 1000,
        effectiveFrom: '2000-01-01T00:00:00.000Z',
        effectiveTo: '2999-12-31T23:59:59.999Z'
      },
      {
        id: 'TAR-' + suffix + '-THRESHOLD',
        code: 'PK-FREE-DELIVERY-THRESHOLD',
        version: versionBase + 2,
        source: 'demo-estimate',
        amountPkr: 100000,
        effectiveFrom: '2000-01-01T00:00:00.000Z',
        effectiveTo: '2999-12-31T23:59:59.999Z'
      }
    ];
    for (const rule of tariffRows) {
      await repository.insert('tariffRules', rule);
      tariffIds.push(rule.id);
    }

    process.env.NODE_ENV = 'test';
    process.env.MONGODB_URI = config.uri;
    process.env.MONGODB_DB_NAME = config.databaseName;
    process.env.JWT_SECRET = randomBytes(32).toString('base64url');
    process.env.CORS_ORIGIN = 'http://localhost:5173';
    process.env.SEED_DEMO_DATA = 'false';

    serverModule = require('../server.js');
    const domain = createDomainRepositories(repository);
    const admin = await domain.users.create({
      id: actorId,
      name: 'Atlas Staging Administrator',
      email: 'atlas-staging-' + suffix.toLowerCase() + '@example.invalid',
      role: 'admin',
      passwordHash: 'staging-smoke-password-hash'
    });
    adminId = admin.id;
    const buyer = await domain.users.create({
      id: actorId + '-BUYER',
      name: 'Atlas Staging Buyer',
      email: 'atlas-staging-buyer-' + suffix.toLowerCase() + '@example.invalid',
      role: 'buyer',
      filerStatus: 'unverified',
      passwordHash: 'staging-smoke-password-hash'
    });
    buyerId = buyer.id;
    state = await repository.readState();
    serverModule.configureForTests(state, repository);
    const token = jwt.sign({ sub: admin.id, role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '5m' });
    const buyerToken = jwt.sign({ sub: buyer.id, role: 'buyer' }, process.env.JWT_SECRET, { expiresIn: '5m' });
    const auth = (builder) => builder.set('Authorization', 'Bearer ' + token);
    const buyerAuth = (builder) => builder.set('Authorization', 'Bearer ' + buyerToken);

    const warehouseResponse = await auth(request(serverModule.app).post('/api/admin/warehouses')).send({
      code: warehouseCode,
      name: 'Atlas Staging Karachi Hub',
      city: 'Karachi',
      address: 'Synthetic staging fixture',
      capacity: 100,
      status: 'offline'
    });
    assert.equal(warehouseResponse.status, 201, 'Express warehouse create route must write to Atlas');
    warehouse = warehouseResponse.body.warehouse;

    const productResponse = await auth(request(serverModule.app).post('/api/admin/products')).send({
      sku,
      name: 'Atlas Staging Test Router',
      category: 'Networking',
      description: 'Synthetic staging-only fixture',
      batchHash: 'sha256-staging-' + suffix,
      originWarehouseId: warehouse.id,
      priceExGstPkr: 1500,
      stock: 12,
      reorder_threshold: 2,
      featured: false
    });
    assert.equal(productResponse.status, 201, 'Express product create route must write to Atlas');
    product = productResponse.body.product;

    const publicProducts = await request(serverModule.app).get('/api/products');
    assert.equal(publicProducts.status, 200);
    assert.ok(publicProducts.body.some((row) => row.sku === sku), 'Public product route must read the Atlas collection');

    const checkoutBody = {
      customerName: 'Atlas Staging Buyer',
      customerEmail: 'atlas-buyer-' + suffix.toLowerCase() + '@example.invalid',
      city: 'Karachi',
      address: 'Synthetic staging delivery address',
      paymentMethod: 'COD',
      items: [{ sku, qty: 2 }]
    };
    const checkout = await buyerAuth(request(serverModule.app)
      .post('/api/checkout')
      .set('Idempotency-Key', idempotencyKey)
      .send(checkoutBody));
    assert.equal(checkout.status, 201, 'Express checkout route must reserve stock in Atlas');
    orderId = checkout.body.order.id;

    const retry = await buyerAuth(request(serverModule.app)
      .post('/api/checkout')
      .set('Idempotency-Key', idempotencyKey)
      .send(checkoutBody));
    assert.equal(retry.status, 201);
    assert.equal(retry.body.order.id, orderId, 'Checkout retry must return the same persisted order');

    let stockRows = await repository.find('stock', { sku, hubCode: warehouseCode }, { limit: 1 });
    assert.equal(stockRows.length, 1);
    assert.equal(stockRows[0].reserved, 2, 'Checkout must persist reserved quantity');

    const cancelled = await auth(request(serverModule.app).post('/api/orders/' + orderId + '/cancel'));
    assert.equal(cancelled.status, 200, 'Order cancellation must release reserved stock');
    assert.equal(cancelled.body.order.status, 'CANCELLED');

    stockRows = await repository.find('stock', { sku, hubCode: warehouseCode }, { limit: 1 });
    assert.equal(stockRows[0].onHand, 12);
    assert.equal(stockRows[0].reserved, 0);

    const movements = await repository.find('movements', { sku, hubCode: warehouseCode });
    assert.ok(movements.some((row) => row.type === 'RECEIVE'));
    assert.ok(movements.some((row) => row.type === 'RESERVE' && row.refId === orderId));
    assert.ok(movements.some((row) => row.type === 'RELEASE' && row.refId === orderId));

    const beforeRollback = stockRows[0];
    rollbackMovementId = 'MOV-ROLLBACK-' + suffix;
    await assert.rejects(
      repository.withTransaction(async ({ repository: transaction }) => {
        await transaction.update('stock', beforeRollback.id, {
          ...beforeRollback,
          onHand: beforeRollback.onHand - 1
        });
        await transaction.insert('movements', {
          id: rollbackMovementId,
          sku,
          hubCode: warehouseCode,
          type: 'ADJUST',
          qty: -1,
          reason: 'staging_rollback_probe',
          refType: 'staging_probe',
          refId: runId,
          actorId,
          at: new Date().toISOString()
        });
        throw new Error('intentional staging rollback probe');
      }),
      /intentional staging rollback probe/
    );
    const afterRollback = await repository.findById('stock', beforeRollback.id);
    assert.equal(afterRollback.onHand, beforeRollback.onHand, 'Failed transaction must restore the original stock count');
    assert.equal(await repository.findById('movements', rollbackMovementId), null, 'Failed transaction must not persist its movement');

    const stockAdjustment = await auth(request(serverModule.app).patch('/api/inventory/' + product.id))
      .set('Idempotency-Key', inventoryIdempotencyKey)
      .send({ stock: 0, reason: 'staging_cycle_count' });
    assert.equal(stockAdjustment.status, 200, 'Inventory count route must update the Atlas stock projection');
    assert.equal(stockAdjustment.body.product.stock, 0);

    const ledger = await auth(request(serverModule.app).get('/api/inventory/' + product.id + '/ledger'));
    assert.equal(ledger.status, 200);
    assert.equal(ledger.body.ledgerStatus, 'reconciled');
    assert.equal(ledger.body.ledgerOnHand, 0);

    const productArchive = await auth(request(serverModule.app).delete('/api/admin/products/' + product.id));
    assert.equal(productArchive.status, 200);
    assert.ok(productArchive.body.product.archivedAt);

    const warehouseArchive = await auth(request(serverModule.app).delete('/api/admin/warehouses/' + warehouse.id));
    assert.equal(warehouseArchive.status, 200);
    assert.ok(warehouseArchive.body.warehouse.archivedAt);

    const actorAudit = await repository.find('auditLogs', { actorId });
    assert.ok(actorAudit.some((row) => row.action === 'warehouse.create'));
    assert.ok(actorAudit.some((row) => row.action === 'product.create'));
    const orderAudit = await repository.find('auditLogs', { targetId: orderId });
    assert.ok(orderAudit.some((row) => row.action === 'order.create'));
    assert.ok(orderAudit.some((row) => row.action === 'order.cancel'));

    console.log(JSON.stringify({
      result: 'passed',
      database: config.databaseName,
      clusterTopology: 'replica-set',
      expressRoutes: [
        'GET /api/products',
        'POST /api/admin/warehouses',
        'POST /api/admin/products',
        'POST /api/checkout',
        'POST /api/orders/:id/cancel',
        'PATCH /api/inventory/:id',
        'GET /api/inventory/:id/ledger',
        'DELETE /api/admin/products/:id',
        'DELETE /api/admin/warehouses/:id'
      ],
      checks: [
        'Atlas indexes and validators initialized',
        'Collection-backed CRUD persisted and read back',
        'Checkout reservation and idempotent retry persisted',
        'Cancellation released reserved stock exactly once',
        'Injected transaction failure rolled back stock and movement writes',
        'Inventory ledger reconciled with the stock projection',
        'Actor audit records were persisted'
      ],
      appendOnlyEvidenceRetained: true
    }, null, 2));
  } finally {
    if (repository) {
      try {
        await repository.withTransaction(async ({ repository: transaction }) => {
          if (orderId) {
            const items = await transaction.find('orderItems', { orderId });
            for (const item of items) await transaction.remove('orderItems', item.id);
            const invoices = await transaction.find('invoices', { orderId });
            for (const invoice of invoices) await transaction.remove('invoices', invoice.id);
            await transaction.remove('orders', orderId);
          }
          const idempotency = await transaction.find('idempotencyKeys', { key: idempotencyKey });
          for (const entry of idempotency) await transaction.remove('idempotencyKeys', entry.id);
          const stockIdempotency = await transaction.find('idempotencyKeys', { key: inventoryIdempotencyKey });
          for (const entry of stockIdempotency) await transaction.remove('idempotencyKeys', entry.id);
          if (product) {
            const stock = await transaction.find('stock', { sku });
            for (const row of stock) await transaction.remove('stock', row.id);
            await transaction.remove('products', product.id);
          }
          if (warehouse) await transaction.remove('warehouses', warehouse.id);
          if (adminId) await transaction.remove('users', adminId);
          if (buyerId) await transaction.remove('users', buyerId);
          for (const id of tariffIds) await transaction.remove('tariffRules', id);
        });
      } catch (cleanupError) {
        console.error('Staging fixture cleanup failed:', cleanupError.message);
        process.exitCode = 1;
      }
    }
    await client.close();
  }
}

if (require.main === module) {
  run().catch((error) => {
    console.error('Atlas staging verification failed:', error.message);
    process.exitCode = 1;
  });
}

module.exports = { CONFIRMATION, STAGING_DATABASE, loadBackendEnvironmentFile, loadStagingConfiguration, run };
