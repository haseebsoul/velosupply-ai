'use strict';

const { createHash } = require('node:crypto');

const STATE_PATHS = {
  users: ['users'],
  products: ['products'],
  warehouses: ['warehouses'],
  suppliers: ['suppliers'],
  stock: ['stock'],
  stockMovements: ['movements'],
  orderItems: ['orderItems'],
  orders: ['orders'],
  tariffRules: ['tariffRules'],
  invoices: ['invoices'],
  returns: ['returns'],
  purchaseOrders: ['purchaseOrders'],
  messages: ['messages'],
  logs: ['logs'],
  newsletter: ['newsletter'],
  rewardClaims: ['rewardClaims'],
  incidents: ['sre', 'incidents'],
  alerts: ['sre', 'alerts'],
  auditLogs: ['sre', 'audit'],
  healthChecks: ['sre', 'healthChecks'],
  loginAttempts: ['sre', 'loginAttempts'],
  idempotencyKeys: ['idempotencyKeys'],
  simulationRuns: ['simulationRuns'],
  settings: ['settings']
};

const COLLECTION_NAMES = [
  ...Object.keys(STATE_PATHS),
  'application_meta',
  'migrationBackups'
];

const INDEXES = {
  users: [
    { key: { email: 1 }, unique: true, name: 'users_email_unique' }
  ],
  products: [
    { key: { sku: 1 }, unique: true, name: 'products_sku_unique' },
    { key: { name: 'text' }, name: 'products_name_text' }
  ],
  warehouses: [
    { key: { code: 1 }, unique: true, sparse: true, name: 'warehouses_code_unique' }
  ],
  suppliers: [
    { key: { name: 1 }, name: 'suppliers_name' }
  ],
  stock: [
    { key: { sku: 1, hubCode: 1 }, unique: true, name: 'stock_sku_hub_unique' }
  ],
  stockMovements: [
    { key: { sku: 1, hubCode: 1, at: -1 }, name: 'stock_movements_sku_hub_at' },
    { key: { refType: 1, refId: 1 }, name: 'stock_movements_reference' }
  ],
  orderItems: [
    { key: { orderId: 1 }, name: 'order_items_order' },
    { key: { productId: 1, orderId: 1 }, name: 'order_items_product_order' }
  ],
  tariffRules: [
    { key: { code: 1, version: -1 }, unique: true, name: 'tariff_rules_code_version_unique' },
    { key: { effectiveFrom: 1, effectiveTo: 1 }, name: 'tariff_rules_effective_window' }
  ],
  orders: [
    { key: { code: 1 }, unique: true, sparse: true, name: 'orders_code_unique' },
    { key: { buyerId: 1, status: 1 }, name: 'orders_buyer_status' }
  ],
  invoices: [
    { key: { code: 1 }, unique: true, name: 'invoices_code_unique' }
  ],
  returns: [
    { key: { orderId: 1, status: 1 }, name: 'returns_order_status' }
  ],
  purchaseOrders: [
    { key: { status: 1 }, name: 'purchase_orders_status' }
  ],
  messages: [
    { key: { toRole: 1, at: -1 }, name: 'messages_recipient_at' }
  ],
  incidents: [
    { key: { status: 1 }, name: 'incidents_status' }
  ],
  alerts: [
    { key: { status: 1 }, name: 'alerts_status' }
  ],
  auditLogs: [
    { key: { actorId: 1, at: -1 }, name: 'audit_actor_at' }
  ],
  settings: [
    { key: { key: 1 }, unique: true, name: 'settings_key_unique' }
  ],
  healthChecks: [
    { key: { at: 1 }, expireAfterSeconds: 86400, name: 'health_checks_ttl_24h' }
  ],
  idempotencyKeys: [
    { key: { key: 1 }, unique: true, name: 'idempotency_key_unique' },
    { key: { at: 1 }, expireAfterSeconds: 86400, name: 'idempotency_ttl_24h' }
  ],
  simulationRuns: [
    { key: { at: -1 }, name: 'simulation_runs_at' }
  ],
  loginAttempts: [
    { key: { at: 1 }, expireAfterSeconds: 3600, name: 'login_attempts_ttl_1h' }
  ],
  logs: [
    { key: { timestamp: -1 }, name: 'logs_timestamp' }
  ],
  newsletter: [
    { key: { email: 1 }, unique: true, name: 'newsletter_email_unique' }
  ],
  rewardClaims: [
    { key: { userId: 1, offerId: 1 }, unique: true, name: 'reward_claim_user_offer_unique' }
  ]
};

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function getAtPath(value, path) {
  return path.reduce((current, key) => current == null ? undefined : current[key], value);
}

function setAtPath(value, path, next) {
  let current = value;
  for (const key of path.slice(0, -1)) {
    if (!current[key] || typeof current[key] !== 'object') current[key] = {};
    current = current[key];
  }
  current[path[path.length - 1]] = next;
}

function deleteAtPath(value, path) {
  let current = value;
  for (const key of path.slice(0, -1)) {
    if (!current || typeof current !== 'object') return;
    current = current[key];
  }
  if (current && typeof current === 'object') delete current[path[path.length - 1]];
}

function normalizeStateShape(input) {
  const state = clone(input || {});
  for (const [name, path] of Object.entries(STATE_PATHS)) {
    if (!Array.isArray(getAtPath(state, path))) setAtPath(state, path, []);
    if (name === 'stock') continue;
    const rows = getAtPath(state, path);
    rows.forEach((record, index) => {
      if (!record || typeof record !== 'object' || Array.isArray(record)) return;
      if (record.id !== undefined || record._id !== undefined || record.code !== undefined || record.key !== undefined ||
          (record.sku !== undefined && record.hubCode !== undefined)) return;
      const digest = createHash('sha256')
        .update(name + ':' + index + ':' + JSON.stringify(record))
        .digest('hex')
        .slice(0, 24);
      record.id = 'AUTO-' + digest;
    });
  }
  if (!state.sre || typeof state.sre !== 'object') state.sre = {};
  if (!state.metrics || typeof state.metrics !== 'object') state.metrics = {};
  if (!state.telemetry || typeof state.telemetry !== 'object') state.telemetry = { tick: 0, updatedAt: new Date().toISOString() };
  return state;
}

function recordsForState(state, name) {
  name = canonicalCollectionName(name);
  if (name === 'stock') {
    return (state.products || []).map((product) => ({
      id: String(product.sku || product.id) + ':' + String(product.warehouse_hub || 'unassigned'),
      sku: product.sku,
      hubCode: product.warehouse_hub || 'unassigned',
      onHand: Number.isFinite(product.stock) ? product.stock : 0,
      reserved: 0,
      projection: true
    }));
  }
  if (name === 'users') {
    return (state.users || []).map((user) => ({
      ...user,
      role: user.role === 'user' ? 'buyer' : user.role,
      ...(user.role === 'user' || user.role === 'buyer' ? { filerStatus: user.filerStatus || 'unverified' } : {}),
      isActive: user.isActive !== false,
      deletedAt: user.deletedAt || null
    }));
  }
  if (name === 'warehouses') {
    return (state.warehouses || []).map((warehouse) => ({
      ...warehouse,
      seedOrigin: state.dataMode === 'demo' ? true : warehouse.seedOrigin === true
    }));
  }
  if (name === 'products') {
    return (state.products || []).map((product) => ({
      ...product,
      originWarehouseId: product.originWarehouseId || product.warehouse_hub || null
    }));
  }
  if (name === 'orders') {
    return (state.orders || []).map((order) => ({
      ...order,
      userId: order.userId || order.buyerId || null
    }));
  }
  if (name === 'orderItems' && (!Array.isArray(state.orderItems) || state.orderItems.length === 0)) {
    const productsById = new Map((state.products || []).map((product) => [product.id, product]));
    return (state.orders || []).flatMap((order) => (order.items || []).map((item, index) => {
      const product = productsById.get(item.productId);
      const unitPriceMinor = Number.isSafeInteger(item.unitPriceMinor) ? item.unitPriceMinor : null;
      return {
        id: 'legacy-item:' + String(order.id) + ':' + index,
        orderId: order.id,
        productId: item.productId || product?.id || null,
        sku: item.sku || product?.sku || null,
        name: item.name || product?.name || 'Legacy order item',
        quantity: item.quantity || item.qty || 1,
        unitPriceMinor,
        priceStatus: unitPriceMinor === null ? 'legacy_unavailable' : 'known'
      };
    }));
  }
  const path = STATE_PATHS[name];
  if (!path) return null;
  const records = getAtPath(state, path);
  return Array.isArray(records) ? records : [];
}

function applyRecordsToState(state, name, records) {
  name = canonicalCollectionName(name);
  const path = STATE_PATHS[name];
  if (!path) return;
  setAtPath(state, path, records);
}

function extractMetadata(state) {
  const metadata = clone(state);
  for (const path of Object.values(STATE_PATHS)) deleteAtPath(metadata, path);
  return metadata;
}

function documentId(record) {
  if (record && record._id !== undefined) return String(record._id);
  if (record && record.id !== undefined) return String(record.id);
  if (record && record.code !== undefined) return String(record.code);
  if (record && record.key !== undefined) return String(record.key);
  if (record && record.sku !== undefined && record.hubCode !== undefined) return String(record.sku) + ':' + String(record.hubCode);
  throw new Error('A repository document must contain id, code, key, or the sku/hubCode pair');
}

function stripMongoId(document) {
  const result = clone(document);
  delete result._id;
  if (result.id === undefined && document._id !== undefined) result.id = String(document._id);
  return result;
}

const COLLECTION_ALIASES = Object.freeze({ movements: 'stockMovements' });

function canonicalCollectionName(name) {
  return COLLECTION_ALIASES[name] || name;
}

const APPEND_ONLY_COLLECTIONS = new Set(['stockMovements', 'auditLogs']);

function assertAppendOnlyTransition(name, before = [], after = []) {
  if (!APPEND_ONLY_COLLECTIONS.has(canonicalCollectionName(name))) return;
  if (!Array.isArray(before) || !Array.isArray(after) || after.length < before.length) {
    const error = new Error(name + ' is append-only; existing records cannot be removed');
    error.code = 'IMMUTABLE_COLLECTION';
    throw error;
  }
  for (let index = 0; index < before.length; index += 1) {
    if (JSON.stringify(before[index]) !== JSON.stringify(after[index])) {
      const error = new Error(name + ' is append-only; existing records cannot be changed');
      error.code = 'IMMUTABLE_COLLECTION';
      throw error;
    }
  }
}

function matchesFilter(document, filter = {}) {
  return Object.entries(filter).every(([key, expected]) => {
    const actual = key.split('.').reduce((value, part) => value == null ? undefined : value[part], document);
    if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
      if ('$in' in expected) return expected.$in.includes(actual);
      if ('$ne' in expected) return actual !== expected.$ne;
      if ('$gt' in expected) return actual > expected.$gt;
      if ('$gte' in expected) return actual >= expected.$gte;
      if ('$lt' in expected) return actual < expected.$lt;
      if ('$lte' in expected) return actual <= expected.$lte;
    }
    return actual === expected;
  });
}

module.exports = {
  STATE_PATHS,
  COLLECTION_NAMES,
  INDEXES,
  APPEND_ONLY_COLLECTIONS,
  COLLECTION_ALIASES,
  canonicalCollectionName,
  assertAppendOnlyTransition,
  clone,
  getAtPath,
  setAtPath,
  normalizeStateShape,
  recordsForState,
  applyRecordsToState,
  extractMetadata,
  documentId,
  stripMongoId,
  matchesFilter
};
