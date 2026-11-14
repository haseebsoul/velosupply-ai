const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, 'db.json');
const DB_SCHEMA_VERSION = 2;

const DEMO_SEED_VERSION = 3;
const CITY_DELIVERY_FEES = Object.freeze({
  Karachi: 350, Lahore: 400, Islamabad: 450, Rawalpindi: 450,
  Faisalabad: 500, Multan: 550, Peshawar: 650, Quetta: 900
});

const warehouses = [
  { id: 'HUB-KHI', code: 'HUB-KHI', name: 'Port Qasim Hub', city: 'Karachi', capacity: 6000, coords: [0.44, 0.82], latency: 32, status: 'online' },
  { id: 'HUB-LHE', code: 'HUB-LHE', name: 'Sundar Hub', city: 'Lahore', capacity: 5000, coords: [0.63, 0.42], latency: 28, status: 'online' },
  { id: 'HUB-ISB', code: 'HUB-ISB', name: 'I-9 Hub', city: 'Islamabad', capacity: 4000, coords: [0.67, 0.33], latency: 25, status: 'online' },
  { id: 'HUB-FSD', code: 'HUB-FSD', name: 'Faisalabad Hub', city: 'Faisalabad', capacity: 2500, coords: [0.58, 0.48], latency: 35, status: 'online' },
  { id: 'HUB-PEW', code: 'HUB-PEW', name: 'Peshawar Hub', city: 'Peshawar', capacity: 2000, coords: [0.59, 0.24], latency: 41, status: 'online' },
  { id: 'HUB-UET', code: 'HUB-UET', name: 'Quetta Hub', city: 'Quetta', capacity: 1500, coords: [0.25, 0.58], latency: 48, status: 'online' }
].map((warehouse) => ({
  ...warehouse,
  status: 'online',
  seedOrigin: true,
  demoRecord: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
}));

const productDefinitions = [
  ['VS-INV-01', 'Hybrid Solar Inverter 5kW', 'Power', 'Hybrid solar inverter for residential and small commercial backup.', 285000, 9],
  ['VS-BAT-01', 'LiFePO4 Battery 5kWh', 'Power', 'Lithium iron phosphate battery storage module, 5kWh.', 410000, 12],
  ['VS-UPS-01', 'Online UPS 1500VA', 'Power', 'Online double-conversion UPS for network and office equipment.', 62000, 6],
  ['VS-RTR-01', 'Wi-Fi 6 Mesh Router, 2-pack', 'Networking', 'Two-unit Wi-Fi 6 mesh kit for small business coverage.', 38500, 5],
  ['VS-NVR-01', '8-Channel NVR CCTV Kit', 'Security', 'Eight-channel network video recorder security kit.', 74000, 7],
  ['VS-SWT-01', '24-Port Managed Switch', 'Networking', 'Twenty-four-port managed Ethernet switch.', 96000, 8],
  ['VS-RCK-01', '42U Server Rack', 'Infrastructure', 'Forty-two unit floor-standing server cabinet.', 185000, 10],
  ['VS-SCN-01', 'Handheld Barcode Scanner', 'Retail', 'Handheld barcode scanner for retail and warehouse workflows.', 21500, 5],
  ['VS-PRN-01', 'Thermal Receipt Printer 80mm', 'Retail', 'Eighty millimetre thermal receipt printer.', 34500, 5],
  ['VS-LAP-01', 'Rugged Laptop 14 inch', 'Computing', 'Fourteen inch rugged laptop for field and warehouse teams.', 238000, 9],
  ['VS-PNL-01', 'Solar Panel 550W', 'Power', 'Five-hundred-and-fifty watt photovoltaic solar panel.', 38000, 8],
  ['VS-CAB-01', 'Cat6 Cable Box 305m', 'Networking', 'Three-hundred-and-five metre Cat6 network cable box.', 29500, 4]
];

const supplierDefinitions = [
  ['SUP-001', 'PakVolt Components (Demo)', 'Karachi', 9, 94],
  ['SUP-002', 'Indus Network Supply (Demo)', 'Lahore', 6, 91],
  ['SUP-003', 'Capital Power Systems (Demo)', 'Islamabad', 12, 96],
  ['SUP-004', 'Frontier Retail Equipment (Demo)', 'Peshawar', 8, 88],
  ['SUP-005', 'Balochistan Industrial Traders (Demo)', 'Quetta', 14, 86]
];

const buyerDefinitions = [
  ['Hira Javed', 'Karachi'], ['Adeel Khan', 'Lahore'], ['Fatima Noor', 'Islamabad'],
  ['Hassan Raza', 'Rawalpindi'], ['Maryam Iqbal', 'Faisalabad'], ['Usman Shah', 'Multan'],
  ['Zoya Ahmed', 'Peshawar'], ['Bilal Hussain', 'Quetta'], ['Sana Malik', 'Karachi'],
  ['Omar Siddiqui', 'Lahore'], ['Iqra Tariq', 'Islamabad'], ['Daniyal Abbas', 'Rawalpindi'],
  ['Laiba Farooq', 'Faisalabad'], ['Hamza Qureshi', 'Multan'], ['Maham Khalid', 'Peshawar'],
  ['Saad Akhtar', 'Quetta'], ['Noor Fatima', 'Karachi'], ['Rehan Ali', 'Lahore'],
  ['Anaya Mir', 'Islamabad'], ['Talha Aslam', 'Rawalpindi'], ['Eman Rauf', 'Faisalabad']
];

function createDemoTariffRules(now = new Date()) {
  const at = now.toISOString();
  const rows = [
    ['PK-GST', { ratePct: 18 }],
    ['PK-FREE-DELIVERY-THRESHOLD', { amountPkr: 150000 }],
    ...Object.entries(CITY_DELIVERY_FEES).map(([city, amountPkr]) => [
      'PK-DELIVERY-' + city.toUpperCase(),
      { amountPkr }
    ])
  ];
  return rows.map(([code, values], index) => ({
    id: 'TARIFF-DEMO-' + String(index + 1).padStart(2, '0'),
    code,
    version: 1,
    ...values,
    source: 'demo-estimate',
    effectiveFrom: at,
    createdAt: at,
    demoRecord: true
  }));
}

function productStatus(stock, threshold) {
  if (stock <= Math.min(3, threshold)) return 'critical';
  if (stock <= threshold) return 'low_stock';
  return 'optimal';
}

function makeDemoId(prefix, index) {
  return prefix + '-' + String(index).padStart(4, '0');
}

async function createSeedData() {
  const passwordHash = await bcrypt.hash('Velo@12345', 10);
  const now = new Date();
  const at = now.toISOString();
  const users = [
    {
      id: 'USER-001', name: 'Sana Rehman', email: 'admin@velosupply.ai',
      role: 'admin', passwordHash, city: 'Islamabad', isActive: true,
      deletedAt: null, seedOrigin: true, demoRecord: true, createdAt: at
    },
    ...[
      ['Usman Tariq', 'Lahore'],
      ['Ayesha Siddiqui', 'Karachi'],
      ['Bilal Ahmed', 'Faisalabad'],
      ['Zainab Malik', 'Islamabad']
    ].map(([name, city], index) => ({
      id: 'USER-OP-' + String(index + 1).padStart(3, '0'),
      name,
      email: ['ops@velosupply.ai', 'ops2@velosupply.ai', 'ops3@velosupply.ai', 'ops4@velosupply.ai'][index],
      role: 'operator',
      passwordHash,
      city,
      isActive: true,
      deletedAt: null,
      seedOrigin: true,
      demoRecord: true,
      createdAt: at
    })),
    ...buyerDefinitions.map(([name, city], index) => ({
      id: 'USER-BUY-' + String(index + 1).padStart(3, '0'),
      name,
      email: 'buyer' + String(index + 1).padStart(2, '0') + '@demo.velosupply.ai',
      role: 'buyer',
      filerStatus: 'unverified',
      passwordHash,
      city,
      isActive: true,
      deletedAt: null,
      seedOrigin: true,
      demoRecord: true,
      createdAt: at
    }))
  ];

  const suppliers = supplierDefinitions.map(([id, name, city, leadDays, reliabilityScore]) => ({
    id, name, city, leadDays, reliabilityScore, status: 'active',
    seedOrigin: true, demoRecord: true, createdAt: at
  }));

  const targetAvailable = [1, 1, 4, 5, 6, 10, 11, 12, 20, 24, 28, 32];
  const reorderPoints = [8, 8, 10, 11, 12, 15, 16, 17, 18, 19, 20, 21];
  const products = productDefinitions.map(([sku, name, category, description, priceExGstPkr, leadDays], index) => {
    const warehouse = warehouses[index % warehouses.length];
    const supplier = suppliers[index % suppliers.length];
    const reserved = 2;
    const stock = targetAvailable[index] + reserved;
    const batchHash = createHash('sha256').update('VeloSupply Pakistan demo batch:' + sku).digest('hex');
    return {
      id: 'PROD-' + String(index + 1).padStart(3, '0'),
      sku,
      name,
      category,
      description,
      price: priceExGstPkr,
      priceExGstPkr,
      currency: 'PKR',
      stock,
      available: targetAvailable[index],
      reserved,
      reorder_threshold: reorderPoints[index],
      reorderPoint: reorderPoints[index],
      safetyStock: 2,
      leadDays,
      supplierId: supplier.id,
      batchHash,
      originWarehouseId: warehouse.id,
      warehouse_hub: warehouse.code,
      featured: index < 6,
      velocity_per_hr: Number((1 / 24).toFixed(4)),
      status: productStatus(stock, reorderPoints[index]),
      seedOrigin: true,
      demoRecord: true,
      createdAt: at,
      updatedAt: at
    };
  });

  const tariffs = createDemoTariffRules(now);
  const tariffByCode = new Map(tariffs.map((rule) => [rule.code, rule]));
  const orderStatuses = [
    ['PLACED', 'PICKING', 'CANCELLED', 'DISPATCHED', 'DELIVERED'],
    ['CONFIRMED', 'PACKED', 'CANCELLED', 'DELIVERED', 'RETURN_REQUESTED'],
    ['PLACED', 'CONFIRMED', 'CANCELLED', 'DISPATCHED', 'RETURNED'],
    ['PICKING', 'PACKED', 'CANCELLED', 'DELIVERED', 'DELIVERED'],
    ['PLACED', 'PACKED', 'CANCELLED', 'DISPATCHED', 'RETURN_REQUESTED'],
    ['CONFIRMED', 'PICKING', 'CANCELLED', 'DELIVERED', 'RETURNED'],
    ['PLACED', 'PICKING', 'CANCELLED', 'DISPATCHED', 'DELIVERED'],
    ['CONFIRMED', 'PACKED', 'CANCELLED', 'DELIVERED', 'RETURN_REQUESTED'],
    ['PLACED', 'CONFIRMED', 'CANCELLED', 'DISPATCHED', 'RETURNED'],
    ['PICKING', 'PACKED', 'CANCELLED', 'DELIVERED', 'DELIVERED'],
    ['PLACED', 'PICKING', 'CANCELLED', 'DISPATCHED', 'RETURN_REQUESTED'],
    ['CONFIRMED', 'PACKED', 'CANCELLED', 'DELIVERED', 'RETURNED']
  ];
  const paymentMethods = ['COD', 'JAZZCASH', 'EASYPAISA', 'RAAST', 'CARD', 'BANK_TRANSFER'];
  const orders = [];
  const orderItems = [];
  const invoices = [];
  const returns = [];
  const movements = [];
  const stock = [];
  const shippedBySku = new Map();
  const returnedBySku = new Map();
  const reservedBySku = new Map();

  const purchaseStatuses = ['draft', 'approved', 'shipped', 'received', 'draft', 'approved', 'shipped', 'received'];
  const purchaseOrders = purchaseStatuses.map((status, index) => {
    const product = products[index % products.length];
    const qty = 1;
    const supplier = suppliers[index % suppliers.length];
    const hubCode = product.warehouse_hub;
    const createdAt = new Date(now.getTime() - (34 - index * 2) * 86400000).toISOString();
    const po = {
      id: 'PO-' + String(index + 1).padStart(4, '0'),
      code: 'PO-2026-' + String(index + 1).padStart(4, '0'),
      supplierId: supplier.id,
      supplierName: supplier.name,
      lines: [{ sku: product.sku, qty, unitExGstPkr: product.priceExGstPkr }],
      hubCode,
      status,
      totalPkr: product.priceExGstPkr * qty,
      totalMinor: product.priceExGstPkr * qty * 100,
      createdBy: users[1].id,
      createdAt,
      updatedAt: createdAt,
      seedOrigin: true,
      demoRecord: true
    };
    if (status === 'received') {
      const receiptAt = new Date(new Date(createdAt).getTime() + 86400000).toISOString();
      movements.push({
        id: 'MOV-PO-' + String(index + 1).padStart(4, '0'),
        sku: product.sku,
        hubCode,
        type: 'RECEIVE',
        qty,
        reason: 'purchase_order_received',
        refType: 'purchase_order',
        refId: po.id,
        actorId: users[1].id,
        at: receiptAt,
        demoRecord: true
      });
    }
    return po;
  });

  for (let productIndex = 0; productIndex < products.length; productIndex += 1) {
    const product = products[productIndex];
    const hubCode = product.warehouse_hub;
    const buyerCity = buyerDefinitions[productIndex % buyerDefinitions.length][1];
    for (let orderIndex = 0; orderIndex < 5; orderIndex += 1) {
      const status = orderStatuses[productIndex][orderIndex];
      const qty = orderIndex >= 3 ? 7 : 1;
      const buyer = users[5 + ((productIndex * 5 + orderIndex) % buyerDefinitions.length)];
      const ageDays = [45, 34, 22, 11, 1][orderIndex];
      const createdAt = new Date(now.getTime() - ageDays * 86400000).toISOString();
      const changedAt = new Date(new Date(createdAt).getTime() + 300000).toISOString();
      const orderId = 'ORD-' + String(productIndex * 5 + orderIndex + 1).padStart(4, '0');
      const orderCode = 'VS-' + String(productIndex * 5 + orderIndex + 1).padStart(4, '0');
      const unitPriceMinor = product.priceExGstPkr * 100;
      const lineExMinor = unitPriceMinor * qty;
      const lineGstMinor = Math.round(lineExMinor * 18 / 100);
      const city = buyer.city || buyerCity;
      const deliveryRule = tariffByCode.get('PK-DELIVERY-' + city.toUpperCase());
      const freeThreshold = tariffByCode.get('PK-FREE-DELIVERY-THRESHOLD').amountPkr;
      const deliveryFeePkr = lineExMinor / 100 > freeThreshold ? 0 : deliveryRule.amountPkr;
      const deliveryFeeMinor = deliveryFeePkr * 100;
      const totalMinor = lineExMinor + lineGstMinor + deliveryFeeMinor;
      const paymentMethod = paymentMethods[(productIndex + orderIndex) % paymentMethods.length];
      const shipped = ['DISPATCHED', 'DELIVERED', 'RETURN_REQUESTED', 'RETURNED'].includes(status);
      const returned = status === 'RETURNED';
      const openReservation = ['PLACED', 'CONFIRMED', 'PICKING', 'PACKED'].includes(status);
      const item = {
        id: 'ITEM-' + String(productIndex * 5 + orderIndex + 1).padStart(4, '0'),
        orderId,
        productId: product.id,
        sku: product.sku,
        name: product.name,
        qty,
        quantity: qty,
        unitExGstPkr: product.priceExGstPkr,
        unitPriceMinor,
        lineExMinor,
        lineGstMinor,
        hubCode,
        currency: 'PKR',
        lineNumber: 1,
        priceStatus: 'known',
        demoRecord: true
      };
      const order = {
        id: orderId,
        code: orderCode,
        buyerId: buyer.id,
        userId: buyer.id,
        customerName: buyer.name,
        customerEmail: buyer.email,
        city,
        address: 'Demo delivery address, ' + city,
        shippingRegion: city,
        items: [{
          productId: product.id,
          sku: product.sku,
          name: product.name,
          qty,
          quantity: qty,
          unitExGstPkr: product.priceExGstPkr,
          unitPriceMinor,
          hubCode
        }],
        currency: 'PKR',
        subtotalExMinor: lineExMinor,
        gstMinor: lineGstMinor,
        deliveryFeeMinor,
        totalMinor,
        price: {
          currency: 'PKR',
          subtotalExMinor: lineExMinor,
          gstMinor: lineGstMinor,
          deliveryFeeMinor,
          totalMinor,
          subtotalEx: lineExMinor / 100,
          gst: lineGstMinor / 100,
          deliveryFee: deliveryFeePkr,
          totalPkr: totalMinor / 100,
          simulated: true
        },
        total: totalMinor / 100,
        paymentMethod,
        paymentState: status === 'DELIVERED' ? 'paid' : paymentMethod === 'COD' ? 'pending_cod' : 'simulated',
        paymentSimulated: paymentMethod !== 'COD',
        hubs: [hubCode],
        warehouse_hub: hubCode,
        splitShipment: false,
        status,
        timeline: [{ status: 'PLACED', at: createdAt, actorId: buyer.id, note: 'Demo order placed' },
          ...(status === 'PLACED' ? [] : [{ status, at: changedAt, actorId: users[1].id, note: 'Demo lifecycle event' }])],
        createdAt,
        updatedAt: changedAt,
        demoRecord: true,
        seedOrigin: true
      };
      orders.push(order);
      orderItems.push(item);
      invoices.push({
        id: 'INV-' + String(productIndex * 5 + orderIndex + 1).padStart(4, '0'),
        code: 'INV-' + orderCode,
        orderId,
        buyerId: buyer.id,
        lines: [{
          sku: product.sku, name: product.name, qty,
          unitExGstPkr: product.priceExGstPkr, lineExMinor, lineGstMinor
        }],
        gstMinor: lineGstMinor,
        totalMinor,
        currency: 'PKR',
        issuedAt: createdAt,
        demoRecord: true
      });

      movements.push({
        id: 'MOV-RES-' + String(productIndex * 5 + orderIndex + 1).padStart(4, '0'),
        sku: product.sku,
        hubCode,
        type: 'RESERVE',
        qty,
        reason: 'demo_order_reservation',
        refType: 'order',
        refId: orderId,
        actorId: buyer.id,
        at: createdAt,
        demoRecord: true
      });
      if (status === 'CANCELLED') {
        movements.push({
          id: 'MOV-REL-' + String(productIndex * 5 + orderIndex + 1).padStart(4, '0'),
          sku: product.sku, hubCode, type: 'RELEASE', qty,
          reason: 'demo_order_cancelled', refType: 'order', refId: orderId,
          actorId: users[1].id, at: changedAt, demoRecord: true
        });
      } else if (shipped) {
        const shippedAt = new Date(new Date(createdAt).getTime() + 600000).toISOString();
        movements.push({
          id: 'MOV-SHP-' + String(productIndex * 5 + orderIndex + 1).padStart(4, '0'),
          sku: product.sku, hubCode, type: 'SHIP', qty,
          reason: 'demo_order_dispatch', refType: 'order', refId: orderId,
          actorId: users[1].id, at: shippedAt, demoRecord: true
        });
        shippedBySku.set(product.sku, (shippedBySku.get(product.sku) || 0) + qty);
        if (returned) {
          const returnedAt = new Date(new Date(createdAt).getTime() + 86400000).toISOString();
          movements.push({
            id: 'MOV-RET-' + String(productIndex * 5 + orderIndex + 1).padStart(4, '0'),
            sku: product.sku, hubCode, type: 'RETURN_IN', qty,
            reason: 'demo_customer_return', refType: 'return',
            refId: 'RET-' + String(productIndex * 5 + orderIndex + 1).padStart(4, '0'),
            actorId: users[1].id, at: returnedAt, demoRecord: true
          });
          returnedBySku.set(product.sku, (returnedBySku.get(product.sku) || 0) + qty);
        }
      }
      if (openReservation) reservedBySku.set(product.sku, (reservedBySku.get(product.sku) || 0) + qty);
      if (status === 'RETURN_REQUESTED' || status === 'RETURNED') {
        returns.push({
          id: 'RET-' + String(productIndex * 5 + orderIndex + 1).padStart(4, '0'),
          orderId,
          buyerId: buyer.id,
          reason: 'Demo return: customer reported an issue',
          description: 'Synthetic demonstration return record; no real customer or shipment.',
          status: returned ? 'received' : 'requested',
          hubCode,
          createdAt: changedAt,
          updatedAt: changedAt,
          ...(returned ? { receivedAt: new Date(new Date(createdAt).getTime() + 86400000).toISOString(), receivedBy: users[1].id } : {}),
          demoRecord: true
        });
      }
    }
  }

  for (const product of products) {
    const receivedPurchaseQty = purchaseOrders
      .filter((po) => po.status === 'received' && po.lines.some((line) => line.sku === product.sku))
      .reduce((sum, po) => sum + po.lines.filter((line) => line.sku === product.sku).reduce((lineSum, line) => lineSum + line.qty, 0), 0);
    const finalOnHand = product.stock;
    const shipped = shippedBySku.get(product.sku) || 0;
    const returned = returnedBySku.get(product.sku) || 0;
    const openingQty = finalOnHand - receivedPurchaseQty + shipped - returned;
    if (!Number.isSafeInteger(openingQty) || openingQty < 0) {
      throw new Error('Invalid generated opening balance for ' + product.sku);
    }
    movements.push({
      id: 'MOV-OPEN-' + product.sku,
      sku: product.sku,
      hubCode: product.warehouse_hub,
      type: 'RECEIVE',
      qty: openingQty,
      reason: 'demo_opening_balance',
      refType: 'opening_balance',
      refId: 'DEMO-OPEN-' + product.sku,
      actorId: 'system',
      at: new Date(now.getTime() - 50 * 86400000).toISOString(),
      demoRecord: true
    });
    stock.push({
      id: product.sku + ':' + product.warehouse_hub,
      sku: product.sku,
      hubCode: product.warehouse_hub,
      onHand: finalOnHand,
      reserved: reservedBySku.get(product.sku) || 0,
      projection: false,
      demoRecord: true
    });
    product.reserved = reservedBySku.get(product.sku) || 0;
    product.available = product.stock - product.reserved;
  }

  const incidents = [
    ['INC-0001', 'Karachi hub replenishment watch', 'high', 'open'],
    ['INC-0002', 'Quetta inbound delay review', 'medium', 'open'],
    ['INC-0003', 'Lahore order backlog', 'high', 'investigating'],
    ['INC-0004', 'Faisalabad stock discrepancy', 'medium', 'resolved'],
    ['INC-0005', 'Peshawar receiving delay', 'low', 'resolved']
  ].map(([id, title, severity, status], index) => ({
    id, code: id, title, severity, status,
    ownerId: users[1 + (index % 4)].id,
    summary: 'Synthetic operational incident for the demo environment.',
    timeline: [{ status, at, actorId: users[1].id, note: 'Demo incident seed' }],
    ...(status === 'resolved' ? { resolvedAt: at } : {}),
    demoRecord: true
  }));
  const alerts = [
    ['ALT-0001', 'critical_stock_cover', 'critical', 'firing'],
    ['ALT-0002', 'critical_stock_cover', 'critical', 'firing'],
    ['ALT-0003', 'high_stock_cover', 'high', 'firing'],
    ['ALT-0004', 'high_stock_cover', 'high', 'acknowledged'],
    ['ALT-0005', 'medium_stock_cover', 'medium', 'resolved'],
    ['ALT-0006', 'purchase_order_delay', 'medium', 'resolved'],
    ['ALT-0007', 'hub_capacity_watch', 'low', 'resolved'],
    ['ALT-0008', 'return_rate_watch', 'low', 'resolved']
  ].map(([id, rule, severity, status], index) => ({
    id, rule, severity, value: index < 2 ? 2 : index === 2 ? 5 : index,
    threshold: index < 2 ? 3 : index === 2 ? 7 : 14,
    status,
    firedAt: new Date(now.getTime() - (index + 1) * 3600000).toISOString(),
    ...(status === 'acknowledged' ? { ackBy: users[1].id } : {}),
    demoRecord: true
  }));
  const messages = [
    ['MSG-0001', 'Priority service notice', 'System maintenance window: demo notice only.', 'urgent'],
    ['MSG-0002', 'Order status update', 'Your demo order has moved to fulfillment.', 'normal'],
    ['MSG-0003', 'Warehouse receiving', 'A demo purchase order is ready for review.', 'normal'],
    ['MSG-0004', 'Return request', 'A demo return is awaiting operator review.', 'normal'],
    ['MSG-0005', 'Supplier update', 'Demo supplier lead time has been refreshed.', 'normal'],
    ['MSG-0006', 'Welcome to VeloSupply', 'This is a synthetic support message for the demo tenant.', 'normal']
  ].map(([id, subject, body, priority], index) => ({
    id,
    fromId: index === 0 ? 'system' : users[1 + (index % 4)].id,
    toRole: index === 0 ? 'admin' : 'buyer',
    toId: index === 0 ? users[0].id : users[5 + (index % buyerDefinitions.length)].id,
    subject, body, priority,
    readBy: [],
    at: new Date(now.getTime() - index * 3600000).toISOString(),
    demoRecord: true
  }));
  const audit = Array.from({ length: 150 }, (_, index) => {
    const actor = users[index % users.length];
    const order = orders[index % orders.length];
    return {
      id: 'AUD-DEMO-' + String(index + 1).padStart(4, '0'),
      actorId: actor.id,
      actorRole: actor.role,
      action: [
        'order.create', 'order.status_update', 'inventory.restock',
        'inventory.adjust', 'purchase_order.create', 'user.login'
      ][index % 6],
      targetType: index % 3 === 0 ? 'order' : index % 3 === 1 ? 'stock' : 'system',
      targetId: index % 3 === 0 ? order.id : index % 3 === 1 ? products[index % products.length].sku : 'demo',
      meta: { seed: 'Pakistan Edition demo fixture', sequence: index + 1 },
      at: new Date(now.getTime() - index * 360000).toISOString(),
      demoRecord: true
    };
  });
  const logs = Array.from({ length: 24 }, (_, index) => ({
    id: makeDemoId('LOG', index + 1),
    type: ['INVENTORY', 'ORDER', 'PURCHASE_ORDER', 'SYSTEM'][index % 4],
    level: index % 8 === 0 ? 'WARN' : 'INFO',
    message: 'Demo activity ' + (index + 1) + ' recorded for Pakistan Edition.',
    timestamp: new Date(now.getTime() - index * 1800000).toISOString(),
    demoRecord: true
  }));
  for (const product of products) {
    product.onOrder = purchaseOrders
      .filter((po) => ['approved', 'shipped'].includes(po.status))
      .reduce((sum, po) => sum + po.lines.filter((line) => line.sku === product.sku).reduce((lineSum, line) => lineSum + line.qty, 0), 0);
  }

  const settings = [
    { key: 'currency', value: 'PKR' },
    { key: 'gstPct', value: 18 },
    { key: 'deliveryFeeByCityPkr', value: CITY_DELIVERY_FEES },
    { key: 'freeDeliveryThresholdPkr', value: 150000 },
    { key: 'lowDataModeDefault', value: true },
    { key: 'safetyStockDefault', value: 2 }
  ].map((setting) => ({ ...setting, id: setting.key, demoRecord: true, updatedAt: at }));

  const orderStatusesActive = orders.filter((order) => !['DELIVERED', 'CANCELLED', 'RETURNED'].includes(order.status));
  const deliveredCount = orders.filter((order) => order.status === 'DELIVERED').length;
  const metrics = {
    gmv24h: orders.filter((order) => Date.parse(order.createdAt) >= now.getTime() - 86400000)
      .reduce((sum, order) => sum + order.total, 0),
    activeOrders: orderStatusesActive.length,
    fulfillmentHealth: Math.round((deliveredCount / orders.length) * 100),
    packetsPerSec: 0,
    avgLatencyMs: Math.round(warehouses.reduce((sum, hub) => sum + hub.latency, 0) / warehouses.length),
    threatsBlocked: 0,
    detectionTimeMs: 0,
    efficiencyScore: 0,
    hubCapacities: warehouses.map(({ name, capacity }) => ({ name, capacity }))
  };

  return {
    schemaVersion: DB_SCHEMA_VERSION,
    demoSeedVersion: DEMO_SEED_VERSION,
    dataMode: 'demo',
    seedManifest: { edition: 'Pakistan Edition', source: 'SRS Sections 8.1-8.4', syntheticOnly: true },
    users,
    warehouses,
    suppliers,
    products,
    stock,
    orders,
    orderItems,
    invoices,
    returns,
    purchaseOrders,
    tariffRules: tariffs,
    movements,
    messages,
    logs,
    newsletter: [],
    rewardClaims: [],
    settings,
    simulationRuns: [],
    idempotencyKeys: [],
    sre: { audit, incidents, alerts, healthChecks: [], loginAttempts: [] },
    metrics,
    telemetry: { tick: 0, updatedAt: at, dataMode: 'demo' }
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
  if (!current || typeof current !== 'object' || Array.isArray(current) ||
      current.schemaVersion !== DB_SCHEMA_VERSION ||
      current.demoSeedVersion !== DEMO_SEED_VERSION ||
      current.dataMode !== 'demo') return false;

  const requiredHubIds = ['HUB-KHI', 'HUB-LHE', 'HUB-ISB', 'HUB-FSD', 'HUB-PEW', 'HUB-UET'];
  const expectedSkus = productDefinitions.map(([sku]) => sku).sort();
  const productSkus = Array.isArray(current.products)
    ? current.products.map((product) => product.sku).sort() : [];
  const productFieldsValid = productSkus.length === expectedSkus.length &&
    expectedSkus.every((sku, index) => productSkus[index] === sku) &&
    current.products.every((product) =>
      Number.isSafeInteger(product.priceExGstPkr) &&
      product.priceExGstPkr > 0 &&
      Number.isSafeInteger(product.stock) &&
      typeof product.batchHash === 'string' &&
      typeof product.originWarehouseId === 'string' &&
      typeof product.warehouse_hub === 'string' &&
      typeof product.leadDays === 'number'
    );
  const warehouseFieldsValid = Array.isArray(current.warehouses) &&
    current.warehouses.length === requiredHubIds.length &&
    requiredHubIds.every((id) => current.warehouses.some((hub) =>
      hub.id === id && hub.code === id && hub.seedOrigin === true &&
      typeof hub.name === 'string' && typeof hub.city === 'string' &&
      typeof hub.capacity === 'number' && Array.isArray(hub.coords)
    ));
  const usersValid = Array.isArray(current.users) &&
    current.users.length === 26 &&
    current.users.filter((user) => user.role === 'admin').length === 1 &&
    current.users.filter((user) => user.role === 'operator').length === 4 &&
    current.users.filter((user) => user.role === 'buyer' &&
      user.filerStatus === 'unverified').length === 21 &&
    current.users.every((user) =>
      typeof user.id === 'string' &&
      typeof user.name === 'string' &&
      typeof user.email === 'string' &&
      typeof user.passwordHash === 'string' &&
      user.isActive === true && user.demoRecord === true
    );
  const ordersValid = Array.isArray(current.orders) && current.orders.length === 60 &&
    current.orders.every((order) =>
      typeof order.id === 'string' &&
      typeof order.code === 'string' &&
      typeof order.buyerId === 'string' &&
      typeof order.city === 'string' &&
      order.currency === 'PKR' &&
      Number.isSafeInteger(order.totalMinor) &&
      Array.isArray(order.items) && order.items.length > 0 &&
      order.demoRecord === true
    );
  const orderItemsValid = Array.isArray(current.orderItems) &&
    current.orderItems.length === 60 &&
    current.orderItems.every((item) =>
      typeof item.orderId === 'string' &&
      typeof item.sku === 'string' &&
      Number.isSafeInteger(item.unitPriceMinor) &&
      item.demoRecord === true
    );
  const movementValid = Array.isArray(current.movements) &&
    current.movements.length >= 100 &&
    current.orders.every((order) => current.movements.some((movement) => movement.type === 'RESERVE' && movement.refId === order.id)) &&
    current.movements.every((movement) =>
      typeof movement.sku === 'string' &&
      typeof movement.hubCode === 'string' &&
      typeof movement.type === 'string' &&
      movement.demoRecord === true
    );
  const requiredOtherRecords = Array.isArray(current.suppliers) && current.suppliers.length === 5 &&
    Array.isArray(current.purchaseOrders) && current.purchaseOrders.length === 8 &&
    Array.isArray(current.invoices) && current.invoices.length === 60 &&
    Array.isArray(current.returns) &&
    Array.isArray(current.messages) && current.messages.length === 6 &&
    Array.isArray(current.sre?.incidents) && current.sre.incidents.length === 5 &&
    Array.isArray(current.sre?.alerts) && current.sre.alerts.length === 8 &&
    Array.isArray(current.sre?.audit) && current.sre.audit.length === 150 &&
    Array.isArray(current.settings) && current.settings.length >= 5;
  const logsValid = Array.isArray(current.logs) && current.logs.length >= 20 &&
    current.logs.every((log) => typeof log.message === 'string' && typeof log.timestamp === 'string');
  const metricFieldsValid = current.metrics &&
    ['gmv24h', 'activeOrders', 'fulfillmentHealth', 'packetsPerSec', 'avgLatencyMs', 'threatsBlocked', 'detectionTimeMs', 'efficiencyScore']
      .every((field) => typeof current.metrics[field] === 'number') &&
    Array.isArray(current.metrics.hubCapacities);

  return usersValid && ordersValid && orderItemsValid && movementValid &&
    requiredOtherRecords && logsValid && Array.isArray(current.newsletter) &&
    metricFieldsValid && typeof current.telemetry?.tick === 'number' &&
    productFieldsValid && warehouseFieldsValid &&
    current.seedManifest?.syntheticOnly === true;
}

function isLegacyGlobalDemoSeed(current) {
  if (!current || current.dataMode !== 'demo' || current.schemaVersion !== DB_SCHEMA_VERSION) return false;
  const oldHubIds = ['HUB-EWR', 'HUB-AUS', 'HUB-RTM', 'HUB-DXB', 'HUB-SIN'];
  const oldEmails = ['admin@velosupply.ai', 'operator@velosupply.ai', 'buyer@velosupply.ai'];
  return Array.isArray(current.warehouses) &&
    current.warehouses.length === 5 &&
    oldHubIds.every((id) => current.warehouses.some((hub) => hub.id === id)) &&
    Array.isArray(current.products) && current.products.length === 24 &&
    Array.isArray(current.orders) && current.orders.length === 12 &&
    Array.isArray(current.users) && current.users.length === 3 &&
    oldEmails.every((email) => current.users.some((user) => user.email === email));
}

async function seedDatabase(options = {}) {
  const filePath = options.filePath || DB_PATH;
  let current = null;
  try {
    current = JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  if (current && current.dataMode !== 'demo') {
    if (options.force) {
      throw new Error('Refusing to overwrite a non-demo database with synthetic Pakistan seed data.');
    }
    return current;
  }
  if (!options.force && hasCurrentSchema(current)) return current;
  if (!options.force && current && !isLegacyGlobalDemoSeed(current)) {
    return current;
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

module.exports = { DB_PATH, DB_SCHEMA_VERSION, DEMO_SEED_VERSION, seedDatabase, productStatus, hasCurrentSchema, createDemoTariffRules };
