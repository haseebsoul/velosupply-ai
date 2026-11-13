const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, 'db.json');
const DB_SCHEMA_VERSION = 2;

const warehouses = [
  { id: 'HUB-EWR', name: 'Newark Edge Hub', coords: [0.79, 0.3], capacity: 82, latency: 14, status: 'online' },
  { id: 'HUB-AUS', name: 'Austin Edge Hub', coords: [0.48, 0.69], capacity: 68, latency: 19, status: 'online' },
  { id: 'HUB-RTM', name: 'Rotterdam Edge Hub', coords: [0.51, 0.22], capacity: 91, latency: 28, status: 'warning' },
  { id: 'HUB-DXB', name: 'Dubai Edge Hub', coords: [0.66, 0.47], capacity: 74, latency: 23, status: 'online' },
  { id: 'HUB-SIN', name: 'Singapore Edge Hub', coords: [0.82, 0.65], capacity: 77, latency: 17, status: 'online' }
].map((warehouse) => ({ ...warehouse, updatedAt: new Date().toISOString() }));

const productDefinitions = [
  ['EG-1001', 'VeloEdge Gateway X1', 'Edge Gateways', 'Industrial multi-protocol edge gateway with secure remote management.', 649, 36, 12, 8.4],
  ['EG-1002', 'VeloEdge Gateway X2', 'Edge Gateways', 'High-throughput dual-network edge gateway for distributed sites.', 899, 24, 10, 6.2],
  ['EG-1003', 'Compact Edge Controller', 'Edge Gateways', 'DIN-rail controller for low-footprint automation deployments.', 389, 18, 8, 4.7],
  ['EG-1004', 'Rugged Edge Gateway', 'Edge Gateways', 'Fanless, extended-temperature gateway for demanding environments.', 779, 29, 10, 5.3],
  ['EG-1005', '5G Edge Gateway Pro', 'Edge Gateways', '5G-ready edge gateway with redundant WAN connectivity.', 1199, 14, 8, 3.8],
  ['EG-1006', 'Secure Edge Gateway Lite', 'Edge Gateways', 'Compact secure gateway for small branch and retail networks.', 329, 42, 14, 9.1],
  ['SS-2001', 'Environmental Sensor Array', 'Smart Sensors', 'Connected temperature, humidity and air-quality sensor array.', 189, 58, 18, 12.6],
  ['SS-2002', 'Precision Temperature Sensor', 'Smart Sensors', 'Calibrated sensor for cold-chain and equipment monitoring.', 79, 72, 20, 15.4],
  ['SS-2003', 'Vibration Monitor S2', 'Smart Sensors', 'Wireless vibration sensor for predictive maintenance programs.', 249, 31, 12, 7.3],
  ['SS-2004', 'Smart Energy Meter', 'Smart Sensors', 'Real-time single-phase energy monitoring with edge reporting.', 139, 46, 16, 10.1],
  ['SS-2005', 'Occupancy Sensor Matrix', 'Smart Sensors', 'Low-power occupancy sensing for intelligent facility control.', 119, 27, 12, 6.5],
  ['SS-2006', 'Leak Detection Sensor', 'Smart Sensors', 'Rapid-response water leak sensor for critical infrastructure.', 59, 9, 10, 2.4],
  ['SR-3001', '42U Enterprise Server Rack', 'Server Racks', 'Square-hole server cabinet with cable management and airflow doors.', 1899, 12, 6, 2.2],
  ['SR-3002', '24U Network Cabinet', 'Server Racks', 'Compact lockable cabinet for network and edge equipment.', 1149, 18, 8, 3.1],
  ['SR-3003', 'Open Frame Rack 45U', 'Server Racks', 'Four-post open frame rack for high-density deployments.', 899, 22, 8, 3.6],
  ['SR-3004', 'Wall-Mount Rack 12U', 'Server Racks', 'Space-saving wall cabinet with ventilated, lockable door.', 429, 34, 12, 5.2],
  ['SR-3005', 'Micro Data Center Enclosure', 'Server Racks', 'Integrated enclosure for secure micro data center installations.', 3299, 7, 4, 1.1],
  ['SR-3006', 'Rack Cooling Module', 'Server Racks', 'High-efficiency rack-mounted cooling unit with active monitoring.', 749, 15, 6, 2.7],
  ['PM-4001', 'Modular Power Supply 1.2kW', 'Power Modules', 'Hot-swappable redundant power module for edge infrastructure.', 459, 41, 14, 8.8],
  ['PM-4002', 'Smart PDU 12-Outlet', 'Power Modules', 'Metered rack PDU with remote outlet control and alerting.', 329, 28, 12, 5.9],
  ['PM-4003', 'Online UPS 1500VA', 'Power Modules', 'Double-conversion UPS for reliable power protection.', 899, 19, 8, 3.4],
  ['PM-4004', 'Lithium Backup Battery', 'Power Modules', 'Long-life expansion battery for compatible online UPS units.', 579, 25, 10, 4.6],
  ['PM-4005', 'DC Power Converter 48V', 'Power Modules', 'Efficient industrial DC converter with overcurrent protection.', 219, 52, 16, 11.2],
  ['PM-4006', 'Three-Phase Power Module', 'Power Modules', 'High-capacity modular power unit for server and network racks.', 1399, 11, 6, 1.8]
];

function productStatus(stock, threshold) {
  if (stock <= Math.min(3, threshold)) return 'critical';
  if (stock <= threshold) return 'low_stock';
  return 'optimal';
}

async function createSeedData(options = {}) {
  const bootstrapAdmin = options.bootstrapAdmin;
  const passwordHash = await bcrypt.hash(
    bootstrapAdmin?.password || '1234',
    options.production ? 12 : 10
  );
  const now = new Date();
  const users = bootstrapAdmin
    ? [{
        id: 'USER-001',
        name: bootstrapAdmin.name.trim(),
        email: bootstrapAdmin.email.trim().toLowerCase(),
        role: 'admin',
        passwordHash,
        createdAt: now.toISOString()
      }]
    : [
        { id: 'USER-001', name: 'Haseeb Khan', email: 'admin@velosupply.ai', role: 'admin', passwordHash, createdAt: now.toISOString() },
        { id: 'USER-002', name: 'Sarah Chen', email: 'operator@velosupply.ai', role: 'operator', passwordHash, createdAt: now.toISOString() },
        { id: 'USER-003', name: 'Marcus Vance', email: 'buyer@velosupply.ai', role: 'user', passwordHash, createdAt: now.toISOString() }
      ];
  const products = productDefinitions.map(([sku, name, category, description, price, stock, threshold, velocity], index) => {
    const warehouse = warehouses[index % warehouses.length];
    return {
      id: `PROD-${String(index + 1).padStart(3, '0')}`,
      sku, name, category, description, price, stock,
      reorder_threshold: threshold,
      warehouse_hub: warehouse.id,
      velocity_per_hr: velocity,
      status: productStatus(stock, threshold),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    };
  });
  const orders = options.production ? [] : Array.from({ length: 12 }, (_, index) => {
    const product = products[index * 2];
    const quantity = index % 3 + 1;
    return {
      id: `ORD-${String(index + 1).padStart(4, '0')}`,
      customerName: ['Avery Brooks', 'Morgan Ellis', 'Jamie Patel', 'Riley Chen'][index % 4],
      customerEmail: `customer${index + 1}@example.com`,
      shippingRegion: ['North America', 'Western Europe', 'Middle East', 'Southeast Asia'][index % 4],
      items: [{ productId: product.id, quantity }],
      total: Number((product.price * quantity).toFixed(2)),
      warehouse_hub: warehouses[index % warehouses.length].id,
      status: ['delivered', 'in_transit', 'processing', 'pending'][index % 4],
      createdAt: new Date(now.getTime() - index * 90 * 60 * 1000).toISOString(),
      updatedAt: now.toISOString()
    };
  });
  for (const order of orders) {
    for (const item of order.items) {
      const product = products.find((entry) => entry.id === item.productId);
      product.stock = Math.max(0, product.stock - item.quantity);
      product.status = productStatus(product.stock, product.reorder_threshold);
    }
  }
  const logs = [{
    id: 'LOG-0001', type: 'SYSTEM', level: 'INFO',
    message: 'VeloSupply AI network initialized; all services operational.',
    timestamp: now.toISOString()
  }];
  for (let index = 0; !options.production && index < 19; index += 1) {
    const order = orders[index % orders.length];
    const product = products[index % products.length];
    const messages = [
      `Inventory synchronized for ${product.sku}.`,
      `Fulfillment route verified for ${order.id}.`,
      `Heartbeat received from ${warehouses[index % warehouses.length].id}.`,
      `Predictive stock signal evaluated for ${product.name}.`
    ];
    logs.push({
      id: `LOG-${String(index + 2).padStart(4, '0')}`,
      type: ['INVENTORY', 'ORDER', 'TELEMETRY', 'THREAT'][index % 4],
      level: index % 7 === 0 ? 'WARN' : 'INFO',
      message: messages[index % messages.length],
      timestamp: new Date(now.getTime() - (index + 1) * 3 * 60 * 1000).toISOString(),
      metadata: { orderId: order.id, productId: product.id }
    });
  }
  return {
    schemaVersion: DB_SCHEMA_VERSION,
    users,
    warehouses,
    products,
    orders,
    logs,
    newsletter: [],
    metrics: {
      gmv24h: orders.reduce((sum, order) => sum + order.total, 0),
      activeOrders: orders.filter((order) => !['delivered', 'cancelled'].includes(order.status)).length,
      fulfillmentHealth: 99,
      packetsPerSec: 1284,
      avgLatencyMs: Math.round(warehouses.reduce((sum, hub) => sum + hub.latency, 0) / warehouses.length),
      threatsBlocked: 42,
      detectionTimeMs: 14,
      efficiencyScore: 842,
      hubCapacities: warehouses.map(({ name, capacity }) => ({ name, capacity }))
    },
    telemetry: { tick: 0, updatedAt: now.toISOString() }
  };
}

async function writeAtomic(filePath, data) {
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(data, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  try {
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true });
    throw error;
  }
}

function hasCurrentSchema(current) {
  if (!current || typeof current !== 'object' || Array.isArray(current) || current.schemaVersion !== DB_SCHEMA_VERSION) {
    return false;
  }
  const requiredHubIds = ['HUB-EWR', 'HUB-AUS', 'HUB-RTM', 'HUB-DXB', 'HUB-SIN'];
  const productFieldsValid = Array.isArray(current.products) && current.products.length >= 24 &&
    current.products.every((product) =>
      ['Edge Gateways', 'Smart Sensors', 'Server Racks', 'Power Modules'].includes(product.category) &&
      typeof product.reorder_threshold === 'number' &&
      typeof product.warehouse_hub === 'string' &&
      typeof product.velocity_per_hr === 'number'
    );
  const warehouseFieldsValid = Array.isArray(current.warehouses) &&
    requiredHubIds.every((id) => current.warehouses.some((hub) =>
      hub.id === id &&
      Array.isArray(hub.coords) &&
      typeof hub.capacity === 'number' &&
      typeof hub.latency === 'number' &&
      ['online', 'warning', 'offline'].includes(hub.status)
    ));
  const usersValid = Array.isArray(current.users) && current.users.length > 0 &&
    current.users.every((user) =>
      typeof user.id === 'string' &&
      typeof user.name === 'string' &&
      typeof user.email === 'string' &&
      ['admin', 'operator', 'user'].includes(user.role) &&
      typeof user.passwordHash === 'string'
    );
  const ordersValid = Array.isArray(current.orders) && current.orders.length >= 12 &&
    current.orders.every((order) =>
      typeof order.id === 'string' &&
      typeof order.shippingRegion === 'string' &&
      typeof order.warehouse_hub === 'string' &&
      typeof order.total === 'number' &&
      Array.isArray(order.items)
    );
  const logsValid = Array.isArray(current.logs) && current.logs.length >= 20 &&
    current.logs.every((log) => typeof log.message === 'string' && typeof log.timestamp === 'string');
  const metricFieldsValid = current.metrics &&
    ['gmv24h', 'activeOrders', 'fulfillmentHealth', 'packetsPerSec', 'avgLatencyMs', 'threatsBlocked', 'detectionTimeMs', 'efficiencyScore']
      .every((field) => typeof current.metrics[field] === 'number') &&
    Array.isArray(current.metrics.hubCapacities);

  return usersValid &&
    ordersValid &&
    logsValid &&
    Array.isArray(current.newsletter) &&
    metricFieldsValid &&
    typeof current.telemetry?.tick === 'number' &&
    productFieldsValid &&
    warehouseFieldsValid;
}

async function seedDatabase(options = {}) {
  const filePath = options.filePath || DB_PATH;
  if (!options.force) {
    try {
      const current = JSON.parse(await fs.readFile(filePath, 'utf8'));
      if (hasCurrentSchema(current)) return current;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  const data = await createSeedData();
  await writeAtomic(filePath, data);
  return data;
}

if (require.main === module) {
  seedDatabase({ force: process.argv.includes('--force') })
    .then(() => console.log(`Seeded database at ${DB_PATH}`))
    .catch((error) => {
      console.error('Unable to seed database:', error);
      process.exitCode = 1;
    });
}

module.exports = { DB_PATH, DB_SCHEMA_VERSION, seedDatabase, productStatus, hasCurrentSchema, createSeedData };
