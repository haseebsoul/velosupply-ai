const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { randomUUID, randomBytes, timingSafeEqual } = require('node:crypto');
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { WebSocketServer, WebSocket } = require('ws');
const { z } = require('zod');
const { DB_PATH, seedDatabase, productStatus } = require('./seed');
const { createEmptyProductionState } = require('./production-state');
const helmet = require('helmet');
const { createSRE } = require('./sre');
const { createRepository } = require('./repository');
const { createDomainRepositories } = require('./repository/domain-repositories');


const envFilePath = path.join(__dirname, '.env');
try {
  const envFile = fsSync.readFileSync(envFilePath, 'utf8');
  for (const line of envFile.split(/\r?\n/)) {
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
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const PORT = Number(process.env.PORT) || 8000;
const generatedDefaults = {};
if (!process.env.JWT_SECRET) {
  if (process.env.NODE_ENV === 'production') throw new Error('JWT_SECRET must be set in production');
  process.env.JWT_SECRET = randomBytes(32).toString('base64url');
  generatedDefaults.JWT_SECRET = process.env.JWT_SECRET;
}
if (!process.env.CORS_ORIGIN) {
  if (process.env.NODE_ENV === 'production') throw new Error('CORS_ORIGIN must be set in production');
  process.env.CORS_ORIGIN = 'http://localhost:5173';
  generatedDefaults.CORS_ORIGIN = process.env.CORS_ORIGIN;
}
const JWT_SECRET = process.env.JWT_SECRET;
if (Object.keys(generatedDefaults).length) {
  process.stdout.write(JSON.stringify({
    ts: new Date().toISOString(),
    level: 'WARN',
    msg: 'Generated development defaults. Save these values in backend/.env to keep sessions stable across restarts.',
    defaults: generatedDefaults
  }) + '\n');
}

const app = express();
const server = http.createServer(app);
const websocketServer = new WebSocketServer({ noServer: true });
let db;
let mongoClient = null;
let stateCollection = null;
let repository = null;
let domainRepositories = null;
let writeQueue = Promise.resolve();
let sre = null;

const rewardOffers = [
  { id: 'priority-routing', title: 'Priority carrier allocation', description: 'Reserve preferred routing capacity during regional demand peaks.', points: 150, minimumScore: 400 },
  { id: 'supplier-access', title: 'Supplier early access', description: 'Get first access to replenishment windows from participating suppliers.', points: 250, minimumScore: 650 },
  { id: 'resilience-review', title: 'Network resilience review', description: 'Unlock a guided review of inventory risk and warehouse resilience.', points: 100, minimumScore: 250 }
];

app.disable('x-powered-by');
sre = createSRE({
  getDb: () => db,
  persist: () => persist(),
  broadcast,
  getMongoClient: () => mongoClient,
  getStateCollection: () => stateCollection,
  getWebSocketServer: () => websocketServer,
  getWebSocketClients: () => websocketServer.clients.size,
  isApiReady: () => server.listening,
  isWebSocketReady: () => server.listening,
  getDbPath: () => DB_PATH
});
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));
app.use(sre.middleware());
const allowedOrigins = (process.env.CORS_ORIGIN || '').split(',').map((origin) => origin.trim()).filter(Boolean);
app.use(cors({ origin: allowedOrigins.length ? allowedOrigins : process.env.NODE_ENV === 'production' ? false : true }));
app.use(express.json({ limit: '100kb' }));
app.use('/api', sre.rateLimit({ limit: 300, windowMs: 60_000, name: 'api' }));
app.use(sre.chaosMiddleware);

function persist() {
  const startedAt = Date.now();
  writeQueue = writeQueue.catch(() => {}).then(async () => {
    if (!repository) throw new Error('Persistence repository has not been initialized');
    await repository.writeState(db);
  }).finally(() => sre?.recordDbLatency(Date.now() - startedAt));
  return writeQueue;
}

async function loadDatabaseState() {
  const mongoUri = process.env.MONGODB_URI;

  if (!mongoUri) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('MONGODB_URI must be set in production');
    }
    repository = createRepository({
      filePath: DB_PATH,
      loadInitial: () => seedDatabase()
    });
    await repository.initialize();
    domainRepositories = createDomainRepositories(repository);
    return repository.readState();
  }

  const { MongoClient } = require('mongodb');
  mongoClient = new MongoClient(mongoUri, {
    serverSelectionTimeoutMS: 10000,
    maxPoolSize: 10
  });
  await mongoClient.connect();

  const databaseName = process.env.MONGODB_DB_NAME || 'velosupply';
  const collectionName = process.env.MONGODB_STATE_COLLECTION || 'application_state';
  const database = mongoClient.db(databaseName);
  stateCollection = database.collection(collectionName);
  const fallbackState = process.env.SEED_DEMO_DATA === 'true' && process.env.NODE_ENV !== 'production'
    ? await seedDatabase()
    : createEmptyProductionState();

  repository = createRepository({
    client: mongoClient,
    database,
    legacyCollectionName: collectionName
  });
  await repository.initialize({ fallbackState });
  domainRepositories = createDomainRepositories(repository);
  return repository.readState();
}
function metricsScore() { return Number(db.metrics?.efficiencyScore || 0); }

function safeUser(user) {
  const { passwordHash, ...result } = user;
  return result;
}

function addLog(message, level = 'INFO', type = 'SYSTEM', metadata = {}) {
  db.logs.unshift({
    id: randomUUID(),
    type,
    level,
    message,
    timestamp: new Date().toISOString(),
    metadata
  });
  db.logs = db.logs.slice(0, 500);
}

function refreshMetrics() {
  const now = Date.now();
  const activeOrders = db.orders.filter((order) => !['delivered', 'cancelled'].includes(order.status));
  const activeWarehouses = db.warehouses.filter((hub) => hub.status === 'online').length;
  const fulfillmentHealth = db.warehouses.length ? Math.round((activeWarehouses / db.warehouses.length) * 100) : 0;
  db.metrics = {
    gmv24h: Number(db.orders
      .filter((order) => now - Date.parse(order.createdAt) <= 24 * 60 * 60 * 1000 && order.status !== 'cancelled')
      .reduce((sum, order) => sum + order.total, 0).toFixed(2)),
    activeOrders: activeOrders.length,
    fulfillmentHealth,
    packetsPerSec: db.metrics?.packetsPerSec ?? 0,
    avgLatencyMs: Math.round(db.warehouses.reduce((sum, hub) => sum + hub.latency, 0) / Math.max(db.warehouses.length, 1)),
    threatsBlocked: db.metrics?.threatsBlocked ?? 0,
    detectionTimeMs: db.metrics?.detectionTimeMs ?? 0,
    efficiencyScore: db.metrics?.efficiencyScore ?? 0,
    hubCapacities: db.warehouses.map(({ name, capacity }) => ({ name, capacity }))
  };
  return db.metrics;
}

function telemetryEvent(event = {}) {
  return {
    type: event.type || 'HEARTBEAT',
    level: event.level || 'INFO',
    message: event.message || 'Network heartbeat received.',
    timestamp: new Date().toISOString(),
    metrics: refreshMetrics(),
    warehouses: db.warehouses,
    ...(event.order ? { order: {
      id: event.order.id,
      status: event.order.status,
      total: event.order.total,
      warehouse_hub: event.order.warehouse_hub
    } } : {})
  };
}

function broadcast(event) {
  const message = JSON.stringify(event);
  for (const client of websocketServer.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(message);
  }
}

function publish(type, message, level = 'INFO', details = {}) {
  addLog(message, level, type, details);
  const event = telemetryEvent({ type, message, level, ...details });
  broadcast(event);
  return event;
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function validate(schema, source = 'body') {
  return (req, res, next) => {
    const parsed = schema.safeParse(req[source] === undefined ? {} : req[source]);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message
        }))
      });
    }
    req[source] = parsed.data;
    next();
  };
}

function authenticate(req, res, next) {
  const match = (req.get('authorization') || '').match(/^Bearer\s+(.+)$/i);
  if (!match) return res.status(401).json({ error: 'Authentication required' });
  try {
    const payload = jwt.verify(match[1], JWT_SECRET);
    const user = db.users.find((entry) => entry.id === payload.sub);
    if (!user || user.isActive === false || user.deletedAt) return res.status(401).json({ error: 'Invalid or expired token' });
    req.user = user;
    next();
  } catch (_error) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function optionalAuthenticate(req, res, next) {
  const match = (req.get('authorization') || '').match(/^Bearer\s+(.+)$/i);
  if (!match) return next();
  try {
    const payload = jwt.verify(match[1], JWT_SECRET);
    const user = db.users.find((entry) => entry.id === payload.sub);
    if (!user || user.isActive === false || user.deletedAt) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    return next();
  } catch (_error) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireRoles(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Insufficient permissions' });
    next();
  };
}

function findById(collection, id, label) {
  const item = collection.find((entry) => entry.id === id);
  if (!item) {
    const error = new Error(`${label} not found`);
    error.status = 404;
    throw error;
  }
  return item;
}

function getWarehouse(id) {
  return db.warehouses.find((hub) => hub.id === id);
}

function updateProductStock(product, stock) {
  product.stock = stock;
  product.status = productStatus(stock, product.reorder_threshold);
  product.updatedAt = new Date().toISOString();
}

function appendStockMovement(product, quantityDelta, reason, reference, actorId = 'system') {
  if (!Number.isSafeInteger(quantityDelta) || quantityDelta === 0) {
    throw new TypeError('Stock movement quantityDelta must be a non-zero integer');
  }
  const refType = reference?.type;
  const refId = reference?.id;
  if (!refType || !refId) throw new TypeError('Stock movement requires a reference');
  if (!Array.isArray(db.movements)) db.movements = [];
  const movement = {
    id: `MOV-${randomUUID()}`,
    sku: product.sku,
    hubCode: product.warehouse_hub || 'unassigned',
    type: reason === 'restock' || reason === 'refund' || reason === 'opening_balance' ? 'RECEIVE' : 'ADJUST',
    qty: reason === 'restock' || reason === 'refund' || reason === 'opening_balance' ? Math.abs(quantityDelta) : quantityDelta,
    reason,
    refType,
    refId,
    actorId: actorId || 'system',
    at: new Date().toISOString()
  };
  db.movements.push(movement);
  return movement;
}

function ensureStockOpeningBalance(product, actorId = 'system') {
  if (!Array.isArray(db.movements)) db.movements = [];
  const hubCode = product.warehouse_hub || 'unassigned';
  const hasBaseline = db.movements.some((entry) => entry.sku === product.sku && entry.hubCode === hubCode);
  if (!hasBaseline && Number.isSafeInteger(product.stock) && product.stock > 0) {
    appendStockMovement(product, product.stock, 'opening_balance', {
      type: 'opening_balance',
      id: `legacy-snapshot:${product.sku}:${hubCode}`
    }, actorId);
  }
}

const loginSchema = z.object({
  email: z.string().trim().email().transform((value) => value.toLowerCase()),
  password: z.string().min(1).max(128)
}).strict();
const newsletterSchema = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase())
}).strict();
const registerSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email().transform((value) => value.toLowerCase()),
  password: z.string().min(8).max(128).regex(/[A-Z]/, 'Password must contain an uppercase letter').regex(/[0-9]/, 'Password must contain a number'),
  role: z.enum(['admin', 'operator', 'user', 'buyer']).default('user'),
  registrationInviteCode: z.string().max(200).optional()
}).strict();
const checkoutSchema = z.object({
  customerName: z.string().trim().min(2).max(100).optional(),
  customerEmail: z.string().trim().email().max(254).optional(),
  shippingRegion: z.string().trim().min(2).max(100).optional(),
  city: z.string().trim().min(2).max(80).optional(),
  address: z.string().trim().min(5).max(300).optional(),
  paymentMethod: z.enum(['COD', 'JAZZCASH', 'EASYPAISA', 'RAAST', 'CARD', 'BANK_TRANSFER']).default('COD'),
  items: z.array(z.union([
    z.object({ sku: z.string().trim().min(1).max(80), qty: z.number().int().positive().max(10000) }).strict(),
    z.object({ productId: z.string().min(1), quantity: z.number().int().positive().max(10000) }).strict()
  ])).min(1).max(50)
}).strict().refine((value) => Boolean(value.city || value.shippingRegion), {
  message: 'A Pakistan delivery city is required',
  path: ['city']
}).refine((value) => Boolean(value.address || value.shippingRegion), {
  message: 'A delivery address is required',
  path: ['address']
}).refine((value) => Boolean(value.customerEmail), {
  message: 'A customer email is required for the guest checkout receipt',
  path: ['customerEmail']
});
const inventoryUpdateSchema = z.object({
  stock: z.number().int().nonnegative().optional(),
  price: z.number().finite().nonnegative().optional(),
  priceExGstPkr: z.number().int().nonnegative().optional(),
  reason: z.string().trim().min(2).max(120).optional()
}).strict()
  .refine((value) => Object.keys(value).some((key) => key !== 'reason'), 'At least one field is required')
  .refine((value) => value.stock === undefined || Boolean(value.reason), {
    message: 'A reason code is required for stock adjustments',
    path: ['reason']
  });
const restockSchema = z.object({
  quantity: z.number().int().positive().max(10000).optional()
}).strict();
const orderStatusSchema = z.object({
  status: z.enum(['CONFIRMED', 'PICKING', 'PACKED', 'DISPATCHED', 'DELIVERED', 'CANCELLED'])
}).strict();
const returnRequestSchema = z.object({
  reason: z.string().trim().min(2).max(300),
  description: z.string().trim().max(2000).optional(),
  hubCode: z.string().trim().min(1).max(32).optional()
}).strict();
const returnDecisionSchema = z.object({
  decision: z.enum(['approved', 'rejected'])
}).strict();
const returnReceiveSchema = z.object({
  hubCode: z.string().trim().min(1).max(32)
}).strict();
const transferSchema = z.object({
  sku: z.string().trim().min(1).max(80),
  fromHubCode: z.string().trim().min(1).max(32),
  toHubCode: z.string().trim().min(1).max(32),
  quantity: z.number().int().positive().max(10000),
  reason: z.string().trim().min(2).max(120)
}).strict();
const roleSchema = z.object({
  role: z.enum(['admin', 'operator', 'user'])
}).strict();
const simulationSchema = z.object({
  scenario: z.enum(['port_congestion', 'demand_spike', 'auto_rebalance']),
  params: z.object({
    safetyBuffer: z.number().min(0).max(100).optional(),
    surgeMultiplier: z.number().min(1).max(10).optional(),
    maxLatency: z.number().min(1).max(1000).optional()
  }).strict().optional().default({})
}).strict();

app.get('/api/health', (_req, res) => {
  const summary = sre.healthSummary();
  res.json({
    status: summary.status,
    service: 'velosupply-api',
    storage: stateCollection ? 'mongodb' : 'file',
    dataMode: db.dataMode || 'unclassified',
    timestamp: new Date().toISOString(),
    services: summary.services,
    checkedAt: summary.checkedAt
  });
});
app.get('/health', (_req, res) => res.json({
  status: sre.healthSummary().status,
  service: 'velosupply-api',
  storage: stateCollection ? 'mongodb' : 'file',
  dataMode: db.dataMode || 'unclassified',
  timestamp: new Date().toISOString(),
  services: sre.healthSummary().services
}));
app.get('/livez', (_req, res) => res.json({ status: 'ok', service: 'velosupply-api' }));
app.get('/readyz', (_req, res) => {
  const summary = sre.readinessSummary();
  res.status(summary.status === 'ok' ? 200 : 503).json(summary);
});
app.get('/api/metrics', (_req, res) => res.json({
  dataMode: db.dataMode || 'unclassified',
  ...refreshMetrics(),
  sre: sre.currentMetrics(),
  slos: sre.sloReport()
}));
app.get('/api/products', (req, res) => {
  const search = String(req.query.search || '').trim().toLowerCase();
  const category = String(req.query.category || '').trim().toLowerCase();
  const products = db.products.filter((product) =>
    (!category || category === 'all' || product.category.toLowerCase() === category) &&
    (!search || `${product.name} ${product.sku} ${product.description}`.toLowerCase().includes(search))
  );
  res.json(products);
});
app.post('/api/newsletter', validate(newsletterSchema), asyncRoute(async (req, res) => {
  const existing = db.newsletter.find((entry) => entry.email === req.body.email);
  if (existing) return res.json({ success: true, subscribed: true, alreadySubscribed: true });
  const subscription = {
    id: `NEWS-${randomUUID()}`,
    email: req.body.email,
    subscribedAt: new Date().toISOString()
  };
  db.newsletter.push(subscription);
  await persist();
  res.status(201).json({ success: true, subscribed: true, alreadySubscribed: false });
}));
app.post('/api/auth/login', sre.rateLimit({ limit: 10, windowMs: 60_000, name: 'login' }), validate(loginSchema), asyncRoute(async (req, res) => {
  if (!db.sre) db.sre = {};
  if (!Array.isArray(db.sre.loginAttempts)) db.sre.loginAttempts = [];
  const now = Date.now();
  db.sre.loginAttempts = db.sre.loginAttempts.filter((entry) => now - Date.parse(entry.at) < 60 * 60 * 1000);
  const recentFailures = db.sre.loginAttempts.filter((entry) => entry.email === req.body.email && now - Date.parse(entry.at) < 15 * 60 * 1000);
  if (recentFailures.length >= 5) return res.status(423).json({ error: 'Account temporarily locked. Try again in 15 minutes.' });
  const user = db.users.find((entry) => entry.email === req.body.email);
  if (!user || !(await bcrypt.compare(req.body.password, user.passwordHash))) {
    db.sre.loginAttempts.push({ email: req.body.email, ip: req.ip, at: new Date().toISOString() });
    await persist();
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  if (user.isActive === false || user.deletedAt) return res.status(403).json({ error: 'Account is inactive. Contact an administrator.' });
  if (user.status === 'suspended') return res.status(403).json({ error: 'Account is suspended. Contact an administrator.' });
  db.sre.loginAttempts = db.sre.loginAttempts.filter((entry) => entry.email !== req.body.email);
  user.lastLoginAt = new Date().toISOString();
  await persist();
  const token = jwt.sign({ sub: user.id, role: user.role }, JWT_SECRET, { expiresIn: '12h' });
  res.json({ token, user: safeUser(user) });
}));

async function register(req, res) {
  if (req.body.role === 'admin' && db.users.some((entry) => entry.role === 'admin')) {
    return res.status(409).json({ error: 'ADMIN_EXISTS' });
  }
  if (req.body.role === 'admin' || req.body.role === 'operator') {
    const roleName = req.body.role;
    const keyName = roleName === 'admin' ? 'ADMIN_REGISTRATION_KEY' : 'OPERATOR_REGISTRATION_KEY';
    const expectedCode = process.env[keyName] || '';
    const suppliedCode = req.body.registrationInviteCode || '';
    const expectedBuffer = Buffer.from(expectedCode);
    const suppliedBuffer = Buffer.from(suppliedCode);
    const validCode = expectedBuffer.length > 0 &&
      expectedBuffer.length === suppliedBuffer.length &&
      timingSafeEqual(expectedBuffer, suppliedBuffer);
    if (!validCode) {
      return res.status(403).json({ error: `${roleName === 'admin' ? 'Administrator' : 'Operations'} registration requires a valid invitation key` });
    }
  }

  if (db.users.some((entry) => entry.email === req.body.email)) {
    return res.status(409).json({ error: 'Email already registered' });
  }
  const passwordHash = await bcrypt.hash(req.body.password, 12);
  // Re-check after bcrypt yields: concurrent admin registrations must not create a second administrator.
  if (req.body.role === 'admin' && db.users.some((entry) => entry.role === 'admin')) {
    return res.status(409).json({ error: 'ADMIN_EXISTS' });
  }
  const user = {
    id: `USER-${randomUUID()}`,
    name: req.body.name,
    email: req.body.email,
    role: req.body.role || 'user',
    passwordHash,
    isActive: true,
    deletedAt: null,
    createdAt: new Date().toISOString()
  };
  db.users.push(user);
  addLog(`Account registered for ${user.email}.`, 'INFO', 'USER', { userId: user.id });
  await persist();
  const token = jwt.sign({ sub: user.id, role: user.role }, JWT_SECRET, { expiresIn: '12h' });
  res.status(201).json({ token, user: safeUser(user) });
}
app.post('/api/auth/register', sre.rateLimit({ limit: 10, windowMs: 60_000, name: 'register' }), validate(registerSchema), asyncRoute(register));
app.post('/api/register', sre.rateLimit({ limit: 10, windowMs: 60_000, name: 'register-legacy' }), validate(registerSchema), asyncRoute(register));

const checkoutHandler = asyncRoute(async (req, res) => {
  if (!domainRepositories) throw new Error('Domain repository has not been initialized');
  const idempotencyKey = req.get('Idempotency-Key') || req.body.idempotencyKey;
  if (!idempotencyKey) return res.status(400).json({ error: 'Idempotency-Key header is required' });

  const items = req.body.items.map((item) => {
    if (item.sku) return { sku: item.sku, qty: item.qty };
    const product = findById(db.products, item.productId, 'Product');
    return { sku: product.sku, qty: item.quantity };
  });
  const buyerId = req.user?.id || 'GUEST-' + randomUUID();
  const city = req.body.city || req.body.shippingRegion;
  const address = req.body.address || req.body.shippingRegion;
  const result = await domainRepositories.orders.checkout({
    buyerId,
    buyerEmail: req.body.customerEmail || req.user?.email,
    customerName: req.body.customerName || req.user?.name,
    city,
    address,
    paymentMethod: req.body.paymentMethod || 'COD',
    items,
    idempotencyKey,
    actorId: req.user?.id || buyerId,
    actorRole: req.user?.role || 'buyer'
  });

  db = await repository.readState();
  const event = telemetryEvent({
    type: 'ORDER_CREATED',
    level: 'INFO',
    message: `Order ${result.order.code} accepted and routed to ${result.order.hubs.join(', ')}.`,
    order: {
      id: result.order.id,
      status: result.order.status,
      total: result.order.price.totalPkr,
      warehouse_hub: result.order.hubs[0]
    }
  });
  broadcast(event);
  res.status(201).json({ order: result.order, items: result.items, invoice: result.invoice, event });
});
app.post('/api/orders/checkout', optionalAuthenticate, validate(checkoutSchema), checkoutHandler);
app.post('/api/checkout', optionalAuthenticate, validate(checkoutSchema), checkoutHandler);

app.use('/api', authenticate);
app.use('/api/sre', requireRoles('admin', 'operator'), sre.router);
app.get('/api/admin/backup', requireRoles('admin'), (req, res) => {
  sre.audit?.('backup.export', req.user, { format: 'velosupply-backup-v1' });
  const snapshot = sre.exportSnapshot();
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('content-disposition', 'attachment; filename="velosupply-backup.json"');
  res.json(snapshot);
});

app.get('/api/auth/me', (req, res) => res.json({ user: safeUser(req.user) }));
app.post('/api/auth/logout', (_req, res) => res.json({ success: true }));

app.get('/api/warehouses', (_req, res) => res.json(db.warehouses));
app.get('/api/rewards', (req, res) => {
  const claims = (db.rewardClaims || []).filter((claim) => claim.userId === req.user.id);
  res.json({ offers: rewardOffers, claims });
});
app.post('/api/rewards/:offerId/claim', asyncRoute(async (req, res) => {
  const offer = rewardOffers.find((entry) => entry.id === req.params.offerId);
  if (!offer) return res.status(404).json({ error: 'Reward offer not found' });
  if (metricsScore() < offer.minimumScore) {
    return res.status(403).json({ error: 'Your efficiency score does not yet meet this offer threshold' });
  }
  const alreadyClaimed = (db.rewardClaims || []).some((claim) => claim.userId === req.user.id && claim.offerId === offer.id);
  if (alreadyClaimed) return res.status(409).json({ error: 'You have already claimed this offer' });
  const claim = { id: `CLAIM-${randomUUID()}`, userId: req.user.id, offerId: offer.id, title: offer.title, points: offer.points, claimedAt: new Date().toISOString() };
  db.rewardClaims.push(claim);
  addLog(`Reward claimed: ${offer.title}.`, 'INFO', 'REWARD', { userId: req.user.id, offerId: offer.id });
  await persist();
  res.status(201).json({ claim });
}));
app.get('/api/orders', (req, res) => {
  if (req.user.role === 'admin' || req.user.role === 'operator') return res.json(db.orders);
  const ownOrders = db.orders.filter((order) =>
    order.buyerId === req.user.id || String(order.customerEmail || '').toLowerCase() === req.user.email
  );
  res.json(ownOrders);
});
app.get('/api/logs', (_req, res) => res.json(db.logs));
app.get('/api/threats', (_req, res) => {
  const products = db.products.filter((product) => product.stock <= product.reorder_threshold).map((product) => ({
    id: product.id,
    type: 'inventory',
    level: product.stock <= 3 ? 'CRITICAL' : 'WARN',
    message: `${product.name} has ${product.stock} units remaining.`,
    product
  }));
  const warehouses = db.warehouses.filter((hub) => hub.status !== 'online').map((hub) => ({
    id: hub.id,
    type: 'warehouse',
    level: hub.status === 'offline' ? 'CRITICAL' : 'WARN',
    message: `${hub.name} is ${hub.status}.`,
    warehouse: hub
  }));
  res.json([...products, ...warehouses]);
});

app.get('/api/admin/users', requireRoles('admin'), (_req, res) => {
  res.json(db.users.map(safeUser));
});
app.patch('/api/admin/users/:id', requireRoles('admin'), validate(roleSchema), asyncRoute(async (req, res) => {
  if (req.params.id === req.user.id && !['admin'].includes(req.body.role)) {
    return res.status(400).json({ error: 'You cannot demote your own administrator account' });
  }
  try {
    const user = await domainRepositories.users.changeRole(
      req.params.id,
      req.body.role,
      { id: req.user.id, role: req.user.role }
    );
    if (!user) return res.status(404).json({ error: 'User not found' });
    db = await repository.readState();
    addLog(`Role updated for ${user.name}: ${user.role}.`, 'INFO', 'USER', { userId: user.id });
    res.json({ user: safeUser(user) });
  } catch (error) {
    if (error.code === 'ADMIN_EXISTS' || error.code === 'LAST_ADMIN') {
      return res.status(409).json({ error: error.code === 'ADMIN_EXISTS' ? 'ADMIN_EXISTS' : error.message });
    }
    throw error;
  }
}));
app.delete('/api/admin/users/:id', requireRoles('admin'), asyncRoute(async (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: 'You cannot delete your own account' });
  try {
    const user = await domainRepositories.users.softDelete(
      req.params.id,
      { id: req.user.id, role: req.user.role }
    );
    if (!user) return res.status(404).json({ error: 'User not found' });
    db = await repository.readState();
    addLog(`User account soft-deleted for ${user.email}.`, 'WARN', 'USER', { userId: user.id });
    res.json({ success: true, user: safeUser(user) });
  } catch (error) {
    if (error.code === 'LAST_ADMIN' || error.code === 'USER_INACTIVE') return res.status(409).json({ error: error.message });
    throw error;
  }
}));

app.patch('/api/inventory/:id', requireRoles('admin', 'operator'), validate(inventoryUpdateSchema), asyncRoute(async (req, res) => {
  const product = findById(db.products, req.params.id, 'Product');
  if (req.body.stock !== undefined && req.body.stock !== product.stock) {
    const idempotencyKey = req.get('Idempotency-Key');
    if (!idempotencyKey) return res.status(400).json({ error: 'Idempotency-Key header is required for inventory writes' });
    try {
      await domainRepositories.stockMovements.adjust({
        sku: product.sku,
        hubCode: product.warehouse_hub || 'unassigned',
        delta: req.body.stock - product.stock,
        reason: req.body.reason,
        actorId: req.user.id,
        actorRole: req.user.role,
        idempotencyKey
      });
    } catch (error) {
      if (error.code === 'NEGATIVE_STOCK') return res.status(409).json({ error: 'NEGATIVE_STOCK', message: error.message });
      if (error.code === 'KEY_REUSED') return res.status(422).json({ error: 'KEY_REUSED', message: error.message });
      throw error;
    }
  }
  const productChanges = {};
  if (req.body.price !== undefined) productChanges.price = req.body.price;
  if (req.body.priceExGstPkr !== undefined) productChanges.priceExGstPkr = req.body.priceExGstPkr;
  if (Object.keys(productChanges).length) {
    await domainRepositories.products.update(product.id, productChanges, { id: req.user.id, role: req.user.role });
  }
  db = await repository.readState();
  const updatedProduct = findById(db.products, req.params.id, 'Product');
  addLog(`Inventory updated for ${updatedProduct.sku}.`, 'INFO', 'INVENTORY', { productId: updatedProduct.id });
  await persist();
  res.json({ product: updatedProduct });
}));
app.get('/api/inventory/:id/ledger', requireRoles('admin', 'operator'), (req, res) => {
  const product = findById(db.products, req.params.id, 'Product');
  const hubCode = product.warehouse_hub || 'unassigned';
  const movements = (db.movements || []).filter((entry) => entry.sku === product.sku && entry.hubCode === hubCode);
  const onHand = movements.reduce((balance, entry) => {
    if (entry.type === 'RECEIVE' || entry.type === 'TRANSFER_IN' || entry.type === 'RETURN_IN') return balance + entry.qty;
    if (entry.type === 'SHIP' || entry.type === 'TRANSFER_OUT') return balance - entry.qty;
    if (entry.type === 'ADJUST') return balance + entry.qty;
    return balance;
  }, 0);
  const initialized = movements.length > 0;
  res.json({
    productId: product.id,
    sku: product.sku,
    hubCode,
    ledgerOnHand: initialized ? onHand : null,
    productStock: product.stock,
    matches: initialized ? onHand === product.stock : null,
    movementCount: movements.length,
    ledgerStatus: initialized ? (onHand === product.stock ? 'reconciled' : 'mismatch') : 'baseline-required',
    note: initialized ? undefined : 'Legacy stock has no opening-balance movement; record a verified opening balance before treating the ledger as reconciled.'
  });
});
app.post('/api/inventory/restock/:id', requireRoles('admin', 'operator'), validate(restockSchema), asyncRoute(async (req, res) => {
  const product = findById(db.products, req.params.id, 'Product');
  const quantity = req.body.quantity || Math.max(product.reorder_threshold * 2 - product.stock, 10);
  const idempotencyKey = req.get('Idempotency-Key');
  if (!idempotencyKey) return res.status(400).json({ error: 'Idempotency-Key header is required for inventory writes' });
  try {
    await domainRepositories.stockMovements.restock({
      sku: product.sku,
      hubCode: product.warehouse_hub || 'unassigned',
      qty: quantity,
      reason: 'restock',
      actorId: req.user.id,
      actorRole: req.user.role,
      idempotencyKey
    });
  } catch (error) {
    if (error.code === 'KEY_REUSED') return res.status(422).json({ error: 'KEY_REUSED', message: error.message });
    if (error.code === 'STOCK_NOT_FOUND') return res.status(409).json({ error: 'STOCK_NOT_FOUND', message: error.message });
    throw error;
  }
  db = await repository.readState();
  const updatedProduct = findById(db.products, req.params.id, 'Product');
  const event = publish('THREAT_RESOLVED', `Stock received for ${updatedProduct.sku}: +${quantity} units.`, 'INFO', { productId: updatedProduct.id });
  refreshMetrics();
  await persist();
  res.json({ product: updatedProduct, quantity, event });
}));

app.post('/api/inventory/transfer', requireRoles('admin', 'operator'), validate(transferSchema), asyncRoute(async (req, res) => {
  const idempotencyKey = req.get('Idempotency-Key');
  if (!idempotencyKey) return res.status(400).json({ error: 'Idempotency-Key header is required for inventory writes' });
  try {
    const transfer = await domainRepositories.stockMovements.transfer({
      sku: req.body.sku,
      fromHubCode: req.body.fromHubCode,
      toHubCode: req.body.toHubCode,
      qty: req.body.quantity,
      reason: req.body.reason,
      actorId: req.user.id,
      actorRole: req.user.role,
      idempotencyKey
    });
    db = await repository.readState();
    const event = publish('STOCK_CHANGED', `Transferred ${req.body.quantity} units of ${req.body.sku} from ${req.body.fromHubCode} to ${req.body.toHubCode}.`, 'INFO', { sku: req.body.sku, refId: transfer.refId });
    await persist();
    res.status(201).json({ transfer, event });
  } catch (error) {
    if (error.code === 'KEY_REUSED') return res.status(422).json({ error: 'KEY_REUSED', message: error.message });
    if (error.code === 'NEGATIVE_STOCK' || error.code === 'STOCK_NOT_FOUND' || error.code === 'WAREHOUSE_NOT_FOUND') {
      return res.status(409).json({ error: error.code, message: error.message });
    }
    throw error;
  }
}));

app.get('/api/returns', (req, res) => {
  const rows = db.returns || [];
  if (req.user.role === 'admin' || req.user.role === 'operator') return res.json(rows);
  return res.json(rows.filter((entry) => entry.buyerId === req.user.id));
});
app.post('/api/orders/:id/cancel', asyncRoute(async (req, res) => {
  const order = findById(db.orders, req.params.id, 'Order');
  if (req.user.role !== 'admin' && req.user.role !== 'operator' &&
      order.buyerId !== req.user.id && order.userId !== req.user.id) {
    return res.status(403).json({ error: 'You may only cancel your own order' });
  }
  try {
    const updated = await domainRepositories.orders.advanceStatus(order.id, 'CANCELLED', {
      id: req.user.id, role: req.user.role
    });
    db = await repository.readState();
    publish('ORDER_STATUS', `Order ${updated.code || updated.id} cancelled and reserved stock released.`, 'INFO', { order: updated });
    await persist();
    return res.json({ order: updated });
  } catch (error) {
    if (error.code === 'INVALID_TRANSITION') return res.status(409).json({ error: error.code, message: error.message });
    throw error;
  }
}));
app.post('/api/orders/:id/return', validate(returnRequestSchema), asyncRoute(async (req, res) => {
  const order = findById(db.orders, req.params.id, 'Order');
  if (req.user.role !== 'admin' && req.user.role !== 'operator' &&
      order.buyerId !== req.user.id && order.userId !== req.user.id) {
    return res.status(403).json({ error: 'You may only return your own order' });
  }
  try {
    const result = await domainRepositories.orders.requestReturn(order.id, req.body, {
      id: req.user.id, role: req.user.role
    });
    db = await repository.readState();
    publish('ORDER_STATUS', `Return requested for order ${order.code || order.id}.`, 'INFO');
    await persist();
    return res.status(201).json(result);
  } catch (error) {
    if (error.code === 'INVALID_TRANSITION') return res.status(409).json({ error: error.code, message: error.message });
    throw error;
  }
}));
app.post('/api/returns/:id/decision', requireRoles('admin', 'operator'), validate(returnDecisionSchema), asyncRoute(async (req, res) => {
  try {
    const record = await domainRepositories.orders.decideReturn(req.params.id, req.body.decision, {
      id: req.user.id, role: req.user.role
    });
    if (!record) return res.status(404).json({ error: 'Return not found' });
    db = await repository.readState();
    await persist();
    res.json({ return: record });
  } catch (error) {
    if (error.code === 'INVALID_TRANSITION') return res.status(409).json({ error: error.code, message: error.message });
    throw error;
  }
}));
app.post('/api/returns/:id/receive', requireRoles('admin', 'operator'), validate(returnReceiveSchema), asyncRoute(async (req, res) => {
  try {
    const result = await domainRepositories.orders.receiveReturn(req.params.id, req.body.hubCode, {
      id: req.user.id, role: req.user.role
    });
    if (!result) return res.status(404).json({ error: 'Return not found' });
    db = await repository.readState();
    publish('STOCK_CHANGED', `Returned inventory received into ${req.body.hubCode}.`, 'INFO');
    await persist();
    res.json(result);
  } catch (error) {
    if (error.code === 'INVALID_TRANSITION') return res.status(409).json({ error: error.code, message: error.message });
    throw error;
  }
}));
app.patch('/api/orders/:id/status', requireRoles('admin', 'operator'), validate(orderStatusSchema), asyncRoute(async (req, res) => {
  try {
    const updated = await domainRepositories.orders.advanceStatus(req.params.id, req.body.status, {
      id: req.user.id, role: req.user.role
    });
    if (!updated) return res.status(404).json({ error: 'Order not found' });
    db = await repository.readState();
    publish('ORDER_STATUS', `Order ${updated.code || updated.id} advanced to ${updated.status}.`, 'INFO', { order: updated });
    await persist();
    res.json({ order: updated });
  } catch (error) {
    if (error.code === 'INVALID_TRANSITION') return res.status(409).json({ error: error.code, message: error.message });
    if (error.code === 'STOCK_MISMATCH') return res.status(409).json({ error: error.code, message: error.message });
    throw error;
  }
}));

app.post('/api/orders/:id/route', requireRoles('admin', 'operator'), asyncRoute(async (req, res) => {
  const order = findById(db.orders, req.params.id, 'Order');
  const hub = db.warehouses.filter((entry) => entry.status === 'online').sort((a, b) => a.latency - b.latency)[0];
  if (!hub) return res.status(503).json({ error: 'No fulfillment warehouse is currently online' });
  order.warehouse_hub = hub.id;
  if (['pending', 'processing'].includes(order.status)) order.status = 'routed';
  order.updatedAt = new Date().toISOString();
  const event = publish('ORDER_ROUTED', `Order ${order.id} routed to ${hub.id}.`, 'INFO', { order });
  sre.audit?.('order.route', req.user, { orderId: order.id, hubCode: hub.id });
  await persist();
  res.json({ order, event });
}));

app.post('/api/simulation/trigger', requireRoles('admin', 'operator'), validate(simulationSchema), asyncRoute(async (req, res) => {
  if (process.env.NODE_ENV === 'production' && process.env.SIMULATIONS_ENABLED !== 'true') {
    return res.status(403).json({ error: 'SIMULATIONS_DISABLED' });
  }
  const { scenario, params } = req.body;
  let message;
  let level = 'INFO';
  if (scenario === 'port_congestion') {
    const hub = [...db.warehouses].filter((entry) => entry.status !== 'offline').sort((a, b) => b.latency - a.latency)[0];
    if (hub) {
      hub.status = 'warning';
      hub.latency = Math.min(999, hub.latency + 25);
      hub.updatedAt = new Date().toISOString();
    }
    message = hub ? `Port congestion simulated at ${hub.id}; rerouting traffic.` : 'No available warehouse to simulate congestion.';
    level = 'WARN';
  } else if (scenario === 'demand_spike') {
    const multiplier = params.surgeMultiplier || 2;
    for (const product of db.products) {
      product.velocity_per_hr = Number((product.velocity_per_hr * multiplier).toFixed(1));
      const simulatedDemand = Math.min(product.stock, Math.max(1, Math.ceil(product.velocity_per_hr / 4)));
      if (simulatedDemand > 0) ensureStockOpeningBalance(product, req.user.id);
      updateProductStock(product, product.stock - simulatedDemand);
      if (simulatedDemand > 0) appendStockMovement(product, -simulatedDemand, 'adjustment', { type: 'simulation', id: 'demand_spike' }, req.user.id);
    }
    message = `Demand spike simulated at ${multiplier}x; inventory risk scores recalculated.`;
    level = 'WARN';
  } else {
    const online = db.warehouses.filter((hub) => hub.status === 'online').sort((a, b) => a.latency - b.latency);
    if (online.length) {
      db.products.forEach((product, index) => {
        product.warehouse_hub = online[index % online.length].id;
      });
      db.orders.filter((order) => ['pending', 'processing', 'routed'].includes(order.status))
        .forEach((order, index) => {
          order.warehouse_hub = online[index % online.length].id;
          order.status = 'routed';
          order.updatedAt = new Date().toISOString();
        });
    }
    message = 'AI auto-rebalance completed across online fulfillment nodes.';
  }
  db.metrics.efficiencyScore = Math.min(1000, (db.metrics.efficiencyScore || 0) + 8);
  const event = publish('SIMULATION', message, level, { scenario, params });
  sre.audit?.('simulation.run', req.user, { scenario, params });
  refreshMetrics();
  await persist();
  res.json({ success: true, scenario, message, metrics: db.metrics, warehouses: db.warehouses, event });
}));

app.use((_req, res) => res.status(404).json({ error: 'Route not found' }));
app.use((error, req, res, _next) => {
  const status = error instanceof SyntaxError && error.status === 400
    ? 400
    : Number.isInteger(error.status) && error.status >= 400 && error.status < 600 ? error.status : 500;
  process.stdout.write(JSON.stringify({
    ts: new Date().toISOString(),
    level: status >= 500 ? 'ERROR' : 'WARN',
    msg: 'API request failed',
    route: req.originalUrl?.split('?')[0] || req.path,
    status,
    userId: req.user?.id || null,
    reqId: req.requestId || null,
    error: status === 500 ? undefined : error.message,
    ...(status === 500 && process.env.NODE_ENV !== 'production' ? { details: error.message } : {})
  }) + '\n');
  res.status(status).json({
    error: status === 500 ? 'Internal server error' : error.message,
    ...(status === 500 && process.env.NODE_ENV !== 'production' ? { details: error.message } : {})
  });
});

function tickTelemetry() {
  if (!db) return;
  db.telemetry.tick += 1;
  db.telemetry.updatedAt = new Date().toISOString();
  // These are synthetic demo indicators, not observed network packet inspection.
  if (db.dataMode === 'demo' && process.env.NODE_ENV !== 'production') {
    db.metrics.packetsPerSec = 1100 + Math.floor(Math.random() * 400);
    db.metrics.detectionTimeMs = 8 + Math.floor(Math.random() * 16);
  }
  const event = telemetryEvent({
    type: 'HEARTBEAT',
    level: 'INFO',
    message: `Network heartbeat ${db.telemetry.tick}: ${db.warehouses.filter((hub) => hub.status === 'online').length} fulfillment nodes online.`
  });
  broadcast(event);
  persist().catch((error) => console.error('[persistence-error]', error));
}

server.on('upgrade', (request, socket, head) => {
  let pathname;
  try {
    pathname = new URL(request.url, 'http://localhost').pathname;
  } catch (_error) {
    socket.destroy();
    return;
  }
  if (pathname !== '/ws/telemetry') {
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    socket.destroy();
    return;
  }
  websocketServer.handleUpgrade(request, socket, head, (websocket) => {
    websocketServer.emit('connection', websocket, request);
  });
});
websocketServer.on('connection', (websocket) => {
  sre.attachWebSocket(websocket);
  websocket.send(JSON.stringify(telemetryEvent({
    type: 'CONNECTED',
    message: 'Connected to VeloSupply live telemetry.'
  })));
});

async function start() {
  db = await loadDatabaseState();
  if (!Array.isArray(db.newsletter)) db.newsletter = [];
  if (!Array.isArray(db.rewardClaims)) db.rewardClaims = [];
  refreshMetrics();
  server.listen(PORT, () => {
    console.log(`VeloSupply API listening on http://localhost:${PORT}`);
    sre.start();
  });
  const timer = setInterval(tickTelemetry, 2000);
  timer.unref();
}

if (require.main === module) {
  start().catch((error) => {
    console.error('Unable to start VeloSupply API:', error);
    process.exitCode = 1;
  });
}

module.exports = { app, server, start, loadDatabaseState, refreshMetrics, sre };
