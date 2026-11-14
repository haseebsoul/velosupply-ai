'use strict';

const { randomUUID, createHash } = require('node:crypto');

const BUYER_ROLES = new Set(['buyer', 'operator', 'admin']);
const MOVEMENT_TYPES = new Set(['RECEIVE', 'RESERVE', 'RELEASE', 'SHIP', 'ADJUST', 'TRANSFER_OUT', 'TRANSFER_IN', 'RETURN_IN']);

function requiredString(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(field + ' is required');
  return value.trim();
}
function integer(value, field, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) throw new TypeError(field + ' must be an integer >= ' + minimum);
  return value;
}
async function runIdempotent(repository, input, operation) {
  const key = input.idempotencyKey ? requiredString(input.idempotencyKey, 'Idempotency-Key') : null;
  if (!key) return operation();
  if (key.length > 200) throw new TypeError('Idempotency-Key must be 200 characters or fewer');
  const payload = { ...input };
  delete payload.idempotencyKey;
  const requestHash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  const existing = await repository.find('idempotencyKeys', { key }, { limit: 1 });
  if (existing.length) {
    if (existing[0].requestHash !== requestHash) {
      const error = new Error('Idempotency key has already been used for a different request');
      error.code = 'KEY_REUSED';
      throw error;
    }
    return existing[0].response;
  }
  const response = await operation();
  await repository.insert('idempotencyKeys', {
    id: 'IDEM-' + key,
    key,
    requestHash,
    response,
    at: new Date().toISOString()
  });
  return response;
}

function createDomainRepositories(adapter) {
  if (!adapter) throw new TypeError('A persistence adapter is required');

  const users = {
    findByEmail(email) { return adapter.find('users', { email: requiredString(email, 'email').toLowerCase() }, { limit: 1 }).then((rows) => rows[0] || null); },
    async create(input) {
      const email = requiredString(input.email, 'email').toLowerCase();
      const role = requiredString(input.role, 'role');
      if (!BUYER_ROLES.has(role)) throw new TypeError('role must be buyer, operator, or admin');
      if (role === 'buyer' && !['filer', 'non-filer', 'unverified'].includes(input.filerStatus)) {
        throw new TypeError('filerStatus must be filer, non-filer, or unverified for buyers');
      }
      return adapter.insert('users', {
        ...input, id: input.id || 'USER-' + randomUUID(), email, role,
        isActive: input.isActive !== false, deletedAt: null,
        createdAt: input.createdAt || new Date().toISOString()
      });
    },
    async changeRole(id, role, actor) {
      role = role === 'user' ? 'buyer' : role;
      if (!BUYER_ROLES.has(role)) throw new TypeError('Unsupported user role');
      return adapter.withTransaction(async ({ repository }) => {
        const user = await repository.findById('users', id);
        if (!user) return null;
        const activeAdmins = await repository.find('users', { role: 'admin', isActive: true });
        if (role === 'admin' && user.role !== 'admin' && activeAdmins.length) {
          const error = new Error('ADMIN_EXISTS');
          error.code = 'ADMIN_EXISTS';
          throw error;
        }
        if (user.role === 'admin' && role !== 'admin' && activeAdmins.length <= 1) {
          const error = new Error('The last administrator cannot be demoted');
          error.code = 'LAST_ADMIN';
          throw error;
        }
        const at = new Date().toISOString();
        const updated = await repository.update('users', id, { role, updatedAt: at });
        await repository.insert('auditLogs', {
          id: 'AUD-' + randomUUID(), actorId: actor.id, actorRole: actor.role,
          action: 'user.role_update', targetType: 'user', targetId: id,
          meta: { role }, at
        });
        return updated;
      });
    },
    async softDelete(id, actorOrAt, suppliedAt) {
      const actor = actorOrAt && typeof actorOrAt === 'object'
        ? actorOrAt : { id: 'system', role: 'system' };
      const at = typeof actorOrAt === 'string' ? actorOrAt : (suppliedAt || new Date().toISOString());
      return adapter.withTransaction(async ({ repository }) => {
        const user = await repository.findById('users', id);
        if (!user) return null;
        if (user.isActive === false || user.deletedAt) {
          const error = new Error('User account is already inactive');
          error.code = 'USER_INACTIVE';
          throw error;
        }
        if (user.role === 'admin') {
          const activeAdmins = await repository.find('users', { role: 'admin', isActive: true });
          if (activeAdmins.length <= 1) {
            const error = new Error('The last administrator cannot be deleted');
            error.code = 'LAST_ADMIN';
            throw error;
          }
        }
        const updated = await repository.update('users', id, { isActive: false, deletedAt: at, updatedAt: at });
        await repository.insert('auditLogs', {
          id: 'AUD-' + randomUUID(), actorId: actor.id || 'system', actorRole: actor.role || 'system',
          action: 'user.soft_delete', targetType: 'user', targetId: id, meta: {}, at
        });
        return updated;
      });
    }
  };

  const warehouses = {
    list() {
      return adapter.find('warehouses', {});
    },
    async create(input, actor = { id: 'system', role: 'system' }) {
      const code = requiredString(input.code, 'code');
      const name = requiredString(input.name, 'name');
      const status = input.status || 'online';
      if (!['online', 'degraded', 'offline'].includes(status)) throw new TypeError('Unsupported warehouse status');
      return adapter.withTransaction(async ({ repository }) => {
        const warehouse = await repository.insert('warehouses', {
          ...input, id: input.id || 'WH-' + randomUUID(), code, name, status,
          seedOrigin: false, createdAt: input.createdAt || new Date().toISOString()
        });
        await repository.insert('auditLogs', {
          id: 'AUD-' + randomUUID(), actorId: actor.id, actorRole: actor.role,
          action: 'warehouse.create', targetType: 'warehouse', targetId: warehouse.id,
          meta: { code }, at: new Date().toISOString()
        });
        return warehouse;
      });
    },
    async update(id, changes, actor = { id: 'system', role: 'system' }) {
      const allowed = ['name', 'city', 'address', 'region', 'status', 'capacity', 'latency', 'lat', 'lng'];
      for (const key of Object.keys(changes)) if (!allowed.includes(key)) throw new TypeError('Unsupported warehouse field: ' + key);
      if (!Object.keys(changes).length) throw new TypeError('At least one warehouse field is required');
      if (changes.status !== undefined && !['online', 'degraded', 'offline'].includes(changes.status)) {
        throw new TypeError('Unsupported warehouse status');
      }
      for (const key of ['capacity', 'latency']) {
        if (changes[key] !== undefined) integer(changes[key], key);
      }
      for (const key of ['lat', 'lng']) {
        if (changes[key] !== undefined && !Number.isFinite(changes[key])) throw new TypeError(key + ' must be finite');
      }
      return adapter.withTransaction(async ({ repository }) => {
        const current = await repository.findById('warehouses', id);
        if (!current) return null;
        const at = new Date().toISOString();
        const updated = await repository.update('warehouses', id, { ...changes, updatedAt: at });
        await repository.insert('auditLogs', {
          id: 'AUD-' + randomUUID(), actorId: actor.id, actorRole: actor.role,
          action: 'warehouse.update', targetType: 'warehouse', targetId: id,
          meta: { fields: Object.keys(changes) }, at
        });
        return updated;
      });
    }
  };

  const products = {
    list({ includeArchived = false } = {}) {
      return adapter.find('products', {}).then((rows) =>
        includeArchived ? rows : rows.filter((row) => !row.archivedAt && row.status !== 'inactive'));
    },
    findById(id) {
      return adapter.findById('products', id);
    },
    async create(input, actor = { id: 'system', role: 'system' }) {
      const sku = requiredString(input.sku, 'sku');
      const batchHash = requiredString(input.batchHash, 'batchHash');
      const originWarehouseId = requiredString(input.originWarehouseId || input.warehouse_hub, 'originWarehouseId');
      const initialStock = integer(input.initialStock ?? input.stock ?? 0, 'initialStock');
      const reorderThreshold = integer(input.reorder_threshold ?? 3, 'reorder_threshold');
      const { initialStock: _initialStock, stock: _legacyStock, ...productInput } = input;
      return adapter.withTransaction(async ({ repository }) => {
        const warehouse = await repository.findById('warehouses', originWarehouseId) ||
          (await repository.find('warehouses', { code: originWarehouseId }, { limit: 1 }))[0];
        if (!warehouse) throw new TypeError('originWarehouseId must reference an existing warehouse');
        const hubCode = warehouse.code || warehouse.id;
        const at = new Date().toISOString();
        const product = await repository.insert('products', {
          ...productInput, id: input.id || 'PROD-' + randomUUID(), sku, batchHash,
          stock: initialStock, reorder_threshold: reorderThreshold, originWarehouseId: warehouse.id,
          warehouse_hub: hubCode, status: input.status || 'optimal',
          archivedAt: null, createdAt: input.createdAt || at
        });
        await repository.insert('stock', { id: sku + ':' + hubCode, sku, hubCode, onHand: initialStock, reserved: 0 });
        if (initialStock > 0) {
          await repository.insert('movements', {
            id: 'MOV-' + randomUUID(), sku, hubCode, type: 'RECEIVE', qty: initialStock,
            reason: 'initial_inventory', refType: 'product', refId: product.id, actorId: actor.id, at
          });
        }
        await repository.insert('auditLogs', {
          id: 'AUD-' + randomUUID(), actorId: actor.id, actorRole: actor.role,
          action: 'product.create', targetType: 'product', targetId: product.id,
          meta: { sku, originWarehouseId: warehouse.id, initialStock }, at
        });
        return product;
      });
    },
    async update(id, changes, actor) {
      const allowed = ['name', 'category', 'description', 'price', 'priceExGstPkr', 'leadDays', 'status', 'featured', 'supplierId', 'reorder_threshold'];
      for (const key of Object.keys(changes)) if (!allowed.includes(key)) throw new TypeError('Unsupported product field: ' + key);
      if (changes.priceExGstPkr !== undefined) integer(changes.priceExGstPkr, 'priceExGstPkr');
      if (changes.price !== undefined && (!Number.isFinite(changes.price) || changes.price < 0)) throw new TypeError('price must be a non-negative finite value');
      if (changes.leadDays !== undefined) integer(changes.leadDays, 'leadDays');
      if (changes.reorder_threshold !== undefined) integer(changes.reorder_threshold, 'reorder_threshold');
      return adapter.withTransaction(async ({ repository }) => {
        const product = await repository.findById('products', id);
        if (!product) return null;
        const at = new Date().toISOString();
        const updated = await repository.update('products', id, { ...changes, updatedAt: at });
        await repository.insert('auditLogs', {
          id: 'AUD-' + randomUUID(), actorId: actor.id, actorRole: actor.role,
          action: 'product.update', targetType: 'product', targetId: id, meta: { fields: Object.keys(changes) }, at
        });
        return updated;
      });
    },
    async updateInventory(id, changes, actor) {
      const { stock, reason, idempotencyKey, ...productChanges } = changes;
      return adapter.withTransaction(async ({ repository }) => {
        const product = await repository.findById('products', id);
        if (!product) return null;
        if (stock !== undefined && stock !== product.stock) {
          await stockMovements.adjust({
            sku: product.sku, hubCode: product.warehouse_hub || 'unassigned',
            delta: stock - product.stock, reason, actorId: actor.id,
            actorRole: actor.role, idempotencyKey
          });
        }
        const actualProductChanges = Object.fromEntries(Object.entries(productChanges).filter(([, value]) => value !== undefined));
        if (Object.keys(actualProductChanges).length) await products.update(id, actualProductChanges, actor);
        return repository.findById('products', id);
      });
    },
    async archive(id, actor, at = new Date().toISOString()) {
      return adapter.withTransaction(async ({ repository }) => {
        const product = await repository.findById('products', id);
        if (!product) return null;
        const stockRows = await repository.find('stock', { sku: product.sku });
        if (stockRows.some((row) => Number(row.reserved) > 0)) {
          const error = new Error('A product with reserved units cannot be archived');
          error.code = 'PRODUCT_HAS_RESERVED_STOCK';
          throw error;
        }
        const updated = await repository.update('products', id, { archivedAt: at, updatedAt: at });
        await repository.insert('auditLogs', {
          id: 'AUD-' + randomUUID(), actorId: actor.id, actorRole: actor.role,
          action: 'product.archive', targetType: 'product', targetId: id, meta: {}, at
        });
        return updated;
      });
    }
  };

  function activeTariffRule(rows, code, now) {
    return rows
      .filter((rule) => rule.code === code &&
        ['demo-estimate', 'official', 'licensed-provider'].includes(rule.source) &&
        (!rule.effectiveFrom || Date.parse(rule.effectiveFrom) <= now) &&
        (!rule.effectiveTo || Date.parse(rule.effectiveTo) >= now))
      .sort((a, b) => Number(b.version) - Number(a.version))[0] || null;
  }

  const HUB_RANKING = {
    Karachi: ['HUB-KHI', 'HUB-LHE', 'HUB-ISB'],
    Lahore: ['HUB-LHE', 'HUB-ISB', 'HUB-FSD'],
    Islamabad: ['HUB-ISB', 'HUB-LHE', 'HUB-PEW'],
    Rawalpindi: ['HUB-ISB', 'HUB-LHE', 'HUB-PEW'],
    Faisalabad: ['HUB-FSD', 'HUB-LHE', 'HUB-ISB'],
    Multan: ['HUB-LHE', 'HUB-FSD', 'HUB-KHI'],
    Peshawar: ['HUB-PEW', 'HUB-ISB', 'HUB-LHE'],
    Quetta: ['HUB-UET', 'HUB-KHI', 'HUB-LHE']
  };

  const orders = {
    async checkout(input) {
      const buyerId = requiredString(input.buyerId, 'buyerId');
      const city = requiredString(input.city, 'city');
      const address = requiredString(input.address, 'address');
      const paymentMethod = requiredString(input.paymentMethod, 'paymentMethod').toUpperCase();
      const idempotencyKey = requiredString(input.idempotencyKey, 'Idempotency-Key');
      if (!['COD', 'JAZZCASH', 'EASYPAISA', 'RAAST', 'CARD', 'BANK_TRANSFER'].includes(paymentMethod)) {
        throw new TypeError('Unsupported payment method');
      }
      if (!Array.isArray(input.items) || input.items.length === 0 || input.items.length > 50) {
        throw new TypeError('Checkout requires between 1 and 50 order lines');
      }
      const itemRows = input.items.map((item) => ({
        sku: requiredString(item.sku, 'sku'),
        qty: integer(item.qty, 'qty', 1)
      }));
      const quantities = new Map();
      for (const item of itemRows) quantities.set(item.sku, (quantities.get(item.sku) || 0) + item.qty);
      const normalizedItems = [...quantities.entries()].map(([sku, qty]) => ({ sku, qty }));
      const requestBody = {
        buyerId, city, address, paymentMethod,
        items: normalizedItems
      };
      const requestHash = createHash('sha256').update(JSON.stringify(requestBody)).digest('hex');

      const execute = () => adapter.withTransaction(async ({ repository }) => {
        const prior = await repository.find('idempotencyKeys', { key: idempotencyKey }, { limit: 1 });
        if (prior.length) {
          if (prior[0].requestHash !== requestHash) {
            const error = new Error('Idempotency key has already been used for a different request');
            error.code = 'KEY_REUSED';
            throw error;
          }
          return prior[0].response;
        }

        const now = new Date();
        const nowIso = now.toISOString();
        const tariffRows = await repository.find('tariffRules', {});
        const activeTariffRule = (code) => tariffRows
          .filter((rule) => rule.code === code &&
            ['demo-estimate', 'official', 'licensed-provider'].includes(rule.source) &&
            (!rule.effectiveFrom || Date.parse(rule.effectiveFrom) <= now.getTime()) &&
            (!rule.effectiveTo || Date.parse(rule.effectiveTo) >= now.getTime()))
          .sort((a, b) => Number(b.version) - Number(a.version))[0] || null;
        const gstRule = activeTariffRule('PK-GST');
        const deliveryRule = activeTariffRule('PK-DELIVERY-' + city.toUpperCase());
        const thresholdRule = activeTariffRule('PK-FREE-DELIVERY-THRESHOLD');
        if (!gstRule || !deliveryRule || !thresholdRule) {
          const error = new Error('Current sourced tariff rules are required before a PKR checkout can be placed');
          error.code = 'TARIFF_UNAVAILABLE';
          throw error;
        }
        const gstPct = Number(gstRule.ratePct);
        const deliveryFeePkr = Number(deliveryRule.amountPkr);
        const freeDeliveryThresholdPkr = Number(thresholdRule.amountPkr);
        if (!Number.isSafeInteger(gstPct) || gstPct < 0 || gstPct > 100 ||
            !Number.isSafeInteger(deliveryFeePkr) || deliveryFeePkr < 0 ||
            !Number.isSafeInteger(freeDeliveryThresholdPkr) || freeDeliveryThresholdPkr < 0) {
          throw new TypeError('Active tariff rule values are invalid');
        }

        const rankedHubs = HUB_RANKING[city];
        if (!rankedHubs) throw new TypeError('Unsupported delivery city: ' + city);
        const lines = [];
        for (const item of normalizedItems) {
          const productsFound = await repository.find('products', { sku: item.sku }, { limit: 1 });
          const product = productsFound[0];
          if (!product || product.status === 'inactive' || product.archivedAt) {
            const error = new Error('Product not found or inactive: ' + item.sku);
            error.code = 'PRODUCT_UNAVAILABLE';
            throw error;
          }
          const unitExGstPkr = product.priceExGstPkr;
          if (!Number.isSafeInteger(unitExGstPkr) || unitExGstPkr < 0) {
            const error = new Error('Product does not have a valid PKR priceExGstPkr: ' + item.sku);
            error.code = 'PRICE_UNAVAILABLE';
            throw error;
          }
          const stockRows = await repository.find('stock', { sku: item.sku });
          const byHub = new Map(stockRows.map((stock) => [stock.hubCode, stock]));
          const eligible = rankedHubs
            .map((hubCode) => byHub.get(hubCode))
            .filter((stock) => stock && Number.isSafeInteger(stock.onHand) &&
              Number.isSafeInteger(stock.reserved) && stock.onHand - stock.reserved >= item.qty);
          lines.push({ ...item, product, unitExGstPkr, stockByHub: byHub, eligible });
        }

        const sharedHub = rankedHubs.find((hubCode) => lines.every((line) => {
          const stock = line.stockByHub.get(hubCode);
          return stock && stock.onHand - stock.reserved >= line.qty;
        }));
        const allocations = [];
        let splitShipment = false;
        if (sharedHub) {
          for (const line of lines) allocations.push({ ...line, hubCode: sharedHub });
        } else {
          splitShipment = true;
          for (const line of lines) {
            const selected = line.eligible[0];
            if (!selected) {
              const error = new Error('Insufficient available stock for ' + line.sku);
              error.code = 'OUT_OF_STOCK';
              throw error;
            }
            allocations.push({ ...line, hubCode: selected.hubCode });
          }
        }

        const pricedItems = allocations.map((line) => {
          const unitPriceMinor = line.unitExGstPkr * 100;
          const lineExMinor = unitPriceMinor * line.qty;
          const lineGstMinor = Math.round(lineExMinor * gstPct / 100);
          if (![unitPriceMinor, lineExMinor, lineGstMinor].every(Number.isSafeInteger)) {
            throw new TypeError('PKR line amount exceeds the safe integer range');
          }
          return {
            sku: line.sku,
            name: line.product.name,
            qty: line.qty,
            unitExGstPkr: line.unitExGstPkr,
            unitPriceMinor,
            lineExMinor,
            lineGstMinor,
            hubCode: line.hubCode
          };
        });
        const subtotalExMinor = pricedItems.reduce((sum, item) => sum + item.lineExMinor, 0);
        const gstMinor = pricedItems.reduce((sum, item) => sum + item.lineGstMinor, 0);
        const deliveryFeeChargedPkr = subtotalExMinor > freeDeliveryThresholdPkr * 100 ? 0 : deliveryFeePkr;
        const deliveryFeeMinor = deliveryFeeChargedPkr * 100;
        const totalMinor = subtotalExMinor + gstMinor + deliveryFeeMinor;
        if (![subtotalExMinor, gstMinor, deliveryFeeMinor, totalMinor].every(Number.isSafeInteger)) {
          throw new TypeError('PKR order totals exceed the safe integer range');
        }

        const orderId = 'ORD-' + randomUUID();
        const orderCode = 'VS-' + randomUUID().slice(0, 8).toUpperCase();
        const hubs = [...new Set(allocations.map((item) => item.hubCode))];
        const reserveRows = new Map();
        for (const allocation of allocations) {
          const stock = allocation.stockByHub.get(allocation.hubCode);
          if (!stock) throw new Error('Selected stock row disappeared during checkout');
          reserveRows.set(stock.id, { stock, qty: (reserveRows.get(stock.id)?.qty || 0) + allocation.qty });
        }
        for (const { stock, qty } of reserveRows.values()) {
          const history = await repository.find('movements', { sku: stock.sku, hubCode: stock.hubCode });
          if (history.length === 0 && stock.onHand > 0) {
            await repository.insert('movements', {
              id: 'MOV-' + randomUUID(), sku: stock.sku, hubCode: stock.hubCode,
              type: 'RECEIVE', qty: stock.onHand, reason: 'opening_balance',
              refType: 'opening_balance', refId: 'legacy-opening:' + stock.sku + ':' + stock.hubCode,
              actorId: 'system', at: nowIso
            });
          }
          const updated = await repository.update('stock', stock.id, {
            ...stock,
            reserved: stock.reserved + qty
          });
          if (!updated) throw new Error('Unable to reserve stock for ' + stock.sku);
          await repository.insert('movements', {
            id: 'MOV-' + randomUUID(), sku: stock.sku, hubCode: stock.hubCode,
            type: 'RESERVE', qty, reason: 'checkout', refType: 'order', refId: orderId,
            actorId: input.actorId || buyerId, at: nowIso
          });
        }

        const paymentState = paymentMethod === 'COD' ? 'pending_cod' : 'pending';
        const order = {
          id: orderId,
          code: orderCode,
          buyerId,
          userId: buyerId,
          ...(input.buyerEmail ? { buyerEmail: input.buyerEmail } : {}),
          ...(input.customerName ? { customerName: input.customerName } : {}),
          city,
          address,
          items: pricedItems.map(({ sku, name, qty, unitExGstPkr }) => ({ sku, name, qty, unitExGstPkr })),
          currency: 'PKR',
          price: {
            currency: 'PKR', subtotalExMinor, gstMinor, deliveryFeeMinor, totalMinor,
            subtotalEx: Math.round(subtotalExMinor / 100),
            gst: Math.round(gstMinor / 100),
            deliveryFee: deliveryFeeChargedPkr,
            totalPkr: Math.round(totalMinor / 100),
            simulated: [gstRule, deliveryRule, thresholdRule].some((rule) => rule.source === 'demo-estimate')
          },
          subtotalExMinor, gstMinor, deliveryFeeMinor, totalMinor,
          paymentMethod,
          paymentState,
          paymentSimulated: paymentMethod !== 'COD',
          hubs,
          splitShipment,
          status: 'PLACED',
          timeline: [{ status: 'PLACED', at: nowIso, actorId: input.actorId || buyerId, note: 'Order placed' }],
          createdAt: nowIso,
          updatedAt: nowIso
        };
        await repository.insert('orders', order);
        const savedItems = [];
        for (const [index, item] of pricedItems.entries()) {
          savedItems.push(await repository.insert('orderItems', {
            id: 'ITEM-' + randomUUID(), orderId,
            sku: item.sku, name: item.name, qty: item.qty,
            unitExGstPkr: item.unitExGstPkr,
            unitPriceMinor: item.unitPriceMinor,
            lineExMinor: item.lineExMinor,
            lineGstMinor: item.lineGstMinor,
            hubCode: item.hubCode,
            currency: 'PKR',
            lineNumber: index + 1
          }));
        }
        const invoice = {
          id: 'INV-' + randomUUID(),
          code: 'INV-' + orderCode,
          orderId,
          buyerId,
          lines: pricedItems.map(({ sku, name, qty, unitExGstPkr, lineExMinor, lineGstMinor }) => ({
            sku, name, qty, unitExGstPkr, lineExMinor, lineGstMinor
          })),
          gstMinor,
          totalMinor,
          currency: 'PKR',
          issuedAt: nowIso
        };
        await repository.insert('invoices', invoice);
        await repository.insert('auditLogs', {
          id: 'AUD-' + randomUUID(), actorId: input.actorId || buyerId,
          actorRole: input.actorRole || 'buyer', action: 'order.create',
          targetType: 'order', targetId: orderId,
          meta: { code: orderCode, totalMinor, paymentMethod },
          at: nowIso
        });
        const response = { order, items: savedItems, invoice };
        await repository.insert('idempotencyKeys', {
          id: 'IDEM-' + idempotencyKey, key: idempotencyKey,
          requestHash, response, at: nowIso
        });
        return response;
      });

      try {
        return await execute();
      } catch (error) {
        if (error.code !== 'DUPLICATE_KEY' && error.code !== 11000) throw error;
        const prior = await adapter.find('idempotencyKeys', { key: idempotencyKey }, { limit: 1 });
        if (!prior.length) throw error;
        if (prior[0].requestHash !== requestHash) {
          const conflict = new Error('Idempotency key has already been used for a different request');
          conflict.code = 'KEY_REUSED';
          throw conflict;
        }
        return prior[0].response;
      }
    },

    async createWithItems(orderInput, itemInputs) {
      const buyerId = requiredString(orderInput.buyerId || orderInput.userId, 'buyerId');
      const city = requiredString(orderInput.city, 'city');
      if (!Array.isArray(itemInputs) || !itemInputs.length) throw new TypeError('At least one order item is required');

      const now = Date.now();
      const tariffRows = await adapter.find('tariffRules', {});
      const gstRule = activeTariffRule(tariffRows, 'PK-GST', now);
      const deliveryRule = activeTariffRule(tariffRows, 'PK-DELIVERY-' + city.toUpperCase(), now);
      const thresholdRule = activeTariffRule(tariffRows, 'PK-FREE-DELIVERY-THRESHOLD', now);
      if (!gstRule || !deliveryRule || !thresholdRule) {
        throw new Error('Current sourced tariff rules are required before a PKR quote can be created');
      }
      const gstPct = Number(gstRule.ratePct);
      const deliveryFeePkr = Number(deliveryRule.amountPkr);
      const freeDeliveryThresholdPkr = Number(thresholdRule.amountPkr);
      if (!Number.isSafeInteger(gstPct) || gstPct < 0 || gstPct > 100) throw new TypeError('GST tariff ratePct must be an integer from 0 to 100');
      if (!Number.isSafeInteger(deliveryFeePkr) || deliveryFeePkr < 0) throw new TypeError('Delivery tariff amountPkr must be a non-negative integer');
      if (!Number.isSafeInteger(freeDeliveryThresholdPkr) || freeDeliveryThresholdPkr < 0) throw new TypeError('Free-delivery threshold must be a non-negative integer');

      const items = itemInputs.map((item) => {
        const qty = integer(item.qty ?? item.quantity, 'qty', 1);
        const unitExGstPkr = integer(item.unitExGstPkr, 'unitExGstPkr', 0);
        const sku = requiredString(item.sku, 'sku');
        const name = requiredString(item.name, 'name');
        const unitPriceMinor = unitExGstPkr * 100;
        const lineExMinor = unitPriceMinor * qty;
        const lineGstMinor = Math.round(lineExMinor * gstPct / 100);
        if (![unitPriceMinor, lineExMinor, lineGstMinor].every(Number.isSafeInteger)) {
          throw new TypeError('PKR line amount exceeds the safe integer range');
        }
        return {
          id: item.id || 'ITEM-' + randomUUID(),
          sku,
          name,
          qty,
          unitExGstPkr,
          unitPriceMinor,
          lineExMinor,
          lineGstMinor
        };
      });

      const subtotalExMinor = items.reduce((sum, item) => sum + item.lineExMinor, 0);
      const gstMinor = items.reduce((sum, item) => sum + item.lineGstMinor, 0);
      const chargedDeliveryFeePkr = subtotalExMinor > freeDeliveryThresholdPkr * 100 ? 0 : deliveryFeePkr;
      const deliveryFeeMinor = chargedDeliveryFeePkr * 100;
      const totalMinor = subtotalExMinor + gstMinor + deliveryFeeMinor;
      if (![subtotalExMinor, gstMinor, deliveryFeeMinor, totalMinor].every(Number.isSafeInteger)) throw new TypeError('PKR order totals exceed the safe integer range');

      const at = new Date().toISOString();
      const order = {
        ...orderInput,
        id: orderInput.id || 'ORD-' + randomUUID(),
        code: orderInput.code || 'VS-' + randomUUID(),
        buyerId,
        userId: buyerId,
        city,
        currency: 'PKR',
        totalMinor,
        items: items.map(({ sku, name, qty, unitPriceMinor }) => ({ sku, name, qty, unitPriceMinor })),
        price: { currency: 'PKR', subtotalExMinor, gstMinor, deliveryFeeMinor, totalMinor, simulated: [gstRule, deliveryRule, thresholdRule].some((rule) => rule.source === 'demo-estimate') },
        paymentState: orderInput.paymentState || 'pending',
        status: orderInput.status || 'PLACED',
        hubs: Array.isArray(orderInput.hubs) ? orderInput.hubs : [],
        splitShipment: Boolean(orderInput.splitShipment),
        timeline: Array.isArray(orderInput.timeline) && orderInput.timeline.length
          ? orderInput.timeline
          : [{ status: orderInput.status || 'PLACED', at, actorId: buyerId, note: 'Order placed' }],
        createdAt: orderInput.createdAt || at
      };

      return adapter.withTransaction(async ({ repository }) => {
        const saved = await repository.insert('orders', order);
        const savedItems = [];
        for (const item of items) {
          savedItems.push(await repository.insert('orderItems', {
            id: item.id,
            orderId: saved.id,
            sku: item.sku,
            name: item.name,
            qty: item.qty,
            unitPriceMinor: item.unitPriceMinor,
            lineExMinor: item.lineExMinor,
            lineGstMinor: item.lineGstMinor,
            currency: 'PKR'
          }));
        }
        return { order: saved, items: savedItems };
      });
    },

    async advanceStatus(orderId, nextStatus, actor) {
      const allowed = {
        PLACED: ['CONFIRMED', 'CANCELLED'],
        CONFIRMED: ['PICKING', 'CANCELLED'],
        PICKING: ['PACKED'],
        PACKED: ['DISPATCHED'],
        DISPATCHED: ['DELIVERED']
      };
      const actorId = requiredString(actor.id, 'actor.id');
      return adapter.withTransaction(async ({ repository }) => {
        const order = await repository.findById('orders', orderId);
        if (!order) return null;
        if (!(allowed[order.status] || []).includes(nextStatus)) {
          const error = new Error('Invalid order transition: ' + order.status + ' -> ' + nextStatus);
          error.code = 'INVALID_TRANSITION';
          throw error;
        }
        const orderItems = await repository.find('orderItems', { orderId });
        const items = orderItems.length ? orderItems : (order.items || []).map((item) => ({
          sku: item.sku || (repository.find ? null : null),
          qty: item.qty || item.quantity,
          hubCode: item.hubCode || order.hubs?.[0] || order.warehouse_hub
        }));
        const at = new Date().toISOString();

        if (nextStatus === 'CANCELLED' || nextStatus === 'DISPATCHED') {
          for (const item of items) {
            let sku = item.sku;
            if (!sku && item.productId) {
              const productRows = await repository.find('products', { id: item.productId }, { limit: 1 });
              sku = productRows[0]?.sku;
            }
            if (!sku) throw new Error('Order item is missing its SKU');
            const hubCode = requiredString(item.hubCode || order.hubs?.[0] || order.warehouse_hub, 'hubCode');
            const qty = integer(item.qty || item.quantity, 'order item quantity', 1);
            const stockRows = await repository.find('stock', { sku, hubCode }, { limit: 1 });
            const stock = stockRows[0];
            if (!stock) throw new Error('Stock row not found for order item ' + sku);
            if (nextStatus === 'CANCELLED') {
              if (stock.reserved < qty) throw new Error('Reserved stock is lower than order quantity for ' + sku);
              await repository.update('stock', stock.id, { ...stock, reserved: stock.reserved - qty });
              await repository.insert('movements', {
                id: 'MOV-' + randomUUID(), sku, hubCode, type: 'RELEASE', qty,
                reason: 'order_cancelled', refType: 'order', refId: orderId, actorId, at
              });
            } else {
              if (stock.onHand < qty || stock.reserved < qty) {
                const error = new Error('Insufficient reserved stock to dispatch ' + sku);
                error.code = 'STOCK_MISMATCH';
                throw error;
              }
              await repository.update('stock', stock.id, {
                ...stock, onHand: stock.onHand - qty, reserved: stock.reserved - qty
              });
              await repository.insert('movements', {
                id: 'MOV-' + randomUUID(), sku, hubCode, type: 'SHIP', qty,
                reason: 'order_dispatch', refType: 'order', refId: orderId, actorId, at
              });
              const products = await repository.find('products', { sku, warehouse_hub: hubCode });
              for (const product of products) {
                await repository.update('products', product.id, { stock: stock.onHand - qty, updatedAt: at });
              }
            }
          }
        }

        const timeline = [...(order.timeline || []), {
          status: nextStatus, at, actorId, note: 'Order status advanced'
        }];
        // Delivery is not proof of COD cash collection. Leave COD payment pending until an
        // authorized operator records the amount received and its receipt reference.
        const updated = await repository.update('orders', orderId, {
          status: nextStatus, timeline, updatedAt: at
        });
        await repository.insert('auditLogs', {
          id: 'AUD-' + randomUUID(), actorId, actorRole: actor.role || 'operator',
          action: nextStatus === 'CANCELLED' ? 'order.cancel' : 'order.status_update',
          targetType: 'order', targetId: orderId,
          meta: { previousStatus: order.status, status: nextStatus }, at
        });
        return updated;
      });
    },

    async assignFulfillment(orderId, actor) {
      const actorId = requiredString(actor.id, 'actor.id');
      return adapter.withTransaction(async ({ repository }) => {
        const order = await repository.findById('orders', orderId);
        if (!order) return null;
        if (!['PLACED', 'CONFIRMED'].includes(order.status)) {
          const error = new Error('Fulfillment can only be assigned before picking starts');
          error.code = 'INVALID_TRANSITION';
          throw error;
        }
        const orderHubs = new Set(order.hubs || []);
        const warehousesFound = await repository.find('warehouses', {});
        const warehouse = warehousesFound
          .filter((row) => row.status !== 'offline' && row.status !== 'degraded')
          .filter((row) => !orderHubs.size || orderHubs.has(row.code) || orderHubs.has(row.id))
          .sort((a, b) => Number(a.latency || 0) - Number(b.latency || 0))[0];
        if (!warehouse) {
          const error = new Error('No eligible online warehouse is available for this order');
          error.code = 'NO_FULFILLMENT_WAREHOUSE';
          throw error;
        }
        const at = new Date().toISOString();
        const hubCode = warehouse.code || warehouse.id;
        const updated = await repository.update('orders', orderId, {
          warehouse_hub: hubCode, fulfillmentHubId: warehouse.id,
          timeline: [...(order.timeline || []), { status: 'ROUTED', at, actorId, note: 'Fulfillment warehouse assigned' }],
          updatedAt: at
        });
        await repository.insert('auditLogs', {
          id: 'AUD-' + randomUUID(), actorId, actorRole: actor.role || 'operator',
          action: 'order.route', targetType: 'order', targetId: orderId, meta: { hubCode }, at
        });
        return updated;
      });
    },

    async requestReturn(orderId, input, actor) {
      const actorId = requiredString(actor.id, 'actor.id');
      const reason = requiredString(input.reason, 'reason');
      return adapter.withTransaction(async ({ repository }) => {
        const order = await repository.findById('orders', orderId);
        if (!order) return null;
        if (order.status !== 'DELIVERED') {
          const error = new Error('Only delivered orders can be returned');
          error.code = 'INVALID_TRANSITION';
          throw error;
        }
        const at = new Date().toISOString();
        const returnRecord = await repository.insert('returns', {
          id: 'RET-' + randomUUID(),
          orderId, buyerId: order.buyerId || order.userId,
          reason, description: input.description || '',
          status: 'requested', hubCode: input.hubCode || null, createdAt: at, updatedAt: at
        });
        const updated = await repository.update('orders', orderId, {
          status: 'RETURN_REQUESTED',
          timeline: [...(order.timeline || []), { status: 'RETURN_REQUESTED', at, actorId, note: reason }],
          updatedAt: at
        });
        await repository.insert('auditLogs', {
          id: 'AUD-' + randomUUID(), actorId, actorRole: actor.role || 'buyer',
          action: 'return.request', targetType: 'return', targetId: returnRecord.id,
          meta: { orderId, reason }, at
        });
        return { return: returnRecord, order: updated };
      });
    },

    async decideReturn(returnId, decision, actor) {
      if (!['approved', 'rejected'].includes(decision)) throw new TypeError('Decision must be approved or rejected');
      const actorId = requiredString(actor.id, 'actor.id');
      return adapter.withTransaction(async ({ repository }) => {
        const record = await repository.findById('returns', returnId);
        if (!record) return null;
        if (record.status !== 'requested') {
          const error = new Error('Only requested returns can be approved or rejected');
          error.code = 'INVALID_TRANSITION';
          throw error;
        }
        const at = new Date().toISOString();
        const updated = await repository.update('returns', returnId, {
          status: decision, decidedBy: actorId, updatedAt: at
        });
        await repository.insert('auditLogs', {
          id: 'AUD-' + randomUUID(), actorId, actorRole: actor.role || 'operator',
          action: 'return.' + decision, targetType: 'return', targetId: returnId,
          meta: { orderId: record.orderId }, at
        });
        return updated;
      });
    },

    async receiveReturn(returnId, hubCodeInput, actor) {
      const hubCode = requiredString(hubCodeInput, 'hubCode');
      const actorId = requiredString(actor.id, 'actor.id');
      return adapter.withTransaction(async ({ repository }) => {
        const record = await repository.findById('returns', returnId);
        if (!record) return null;
        if (record.status !== 'approved') {
          const error = new Error('Only approved returns can be received');
          error.code = 'INVALID_TRANSITION';
          throw error;
        }
        const order = await repository.findById('orders', record.orderId);
        if (!order) throw new Error('Return order not found');
        const orderItems = await repository.find('orderItems', { orderId: order.id });
        const items = orderItems.length ? orderItems : (order.items || []);
        const at = new Date().toISOString();
        for (const item of items) {
          let sku = item.sku;
          if (!sku && item.productId) {
            const productRows = await repository.find('products', { id: item.productId }, { limit: 1 });
            sku = productRows[0]?.sku;
          }
          if (!sku) throw new Error('Returned order item is missing its SKU');
          const qty = integer(item.qty || item.quantity, 'return quantity', 1);
          const stockRows = await repository.find('stock', { sku, hubCode }, { limit: 1 });
          const stock = stockRows[0] || { id: sku + ':' + hubCode, sku, hubCode, onHand: 0, reserved: 0 };
          await repository.update('stock', stock.id, { ...stock, onHand: stock.onHand + qty }, { upsert: !stockRows.length });
          if (!stockRows.length) {
            const updatedRows = await repository.find('stock', { sku, hubCode }, { limit: 1 });
            if (!updatedRows.length) await repository.insert('stock', { ...stock, onHand: qty });
          }
          await repository.insert('movements', {
            id: 'MOV-' + randomUUID(), sku, hubCode, type: 'RETURN_IN', qty,
            reason: 'customer_return', refType: 'return', refId: returnId, actorId, at
          });
          const products = await repository.find('products', { sku, warehouse_hub: hubCode });
          for (const product of products) {
            await repository.update('products', product.id, { stock: stock.onHand + qty, updatedAt: at });
          }
        }
        const updatedReturn = await repository.update('returns', returnId, {
          status: 'received', receivedAt: at, receivedBy: actorId, hubCode, updatedAt: at
        });
        const updatedOrder = await repository.update('orders', order.id, {
          status: 'RETURNED',
          timeline: [...(order.timeline || []), { status: 'RETURNED', at, actorId, note: 'Return received at ' + hubCode }],
          updatedAt: at
        });
        await repository.insert('auditLogs', {
          id: 'AUD-' + randomUUID(), actorId, actorRole: actor.role || 'operator',
          action: 'return.receive', targetType: 'return', targetId: returnId,
          meta: { orderId: order.id, hubCode }, at
        });
        return { return: updatedReturn, order: updatedOrder };
      });
    },

    async recordCodCollection(orderId, input, actor) {
      const actorId = requiredString(actor.id, 'actor.id');
      const amountMinor = integer(input.amountMinor, 'amountMinor', 1);
      const receiptReference = requiredString(input.receiptReference, 'receiptReference');
      const idempotencyKey = requiredString(input.idempotencyKey, 'Idempotency-Key');
      return adapter.withTransaction(async ({ repository }) => runIdempotent(
        repository, { orderId, amountMinor, receiptReference, idempotencyKey, actorId }, async () => {
          const order = await repository.findById('orders', orderId);
          if (!order) return null;
          if (order.paymentMethod !== 'COD' || order.status !== 'DELIVERED') {
            const error = new Error('COD collection can only be recorded for a delivered COD order');
            error.code = 'INVALID_TRANSITION';
            throw error;
          }
          if (order.paymentState !== 'pending_cod') {
            const error = new Error('COD collection has already been recorded or the payment state is not eligible');
            error.code = 'PAYMENT_ALREADY_COLLECTED';
            throw error;
          }
          const expectedAmountMinor = order.totalMinor ?? order.price?.totalMinor;
          if (!Number.isSafeInteger(expectedAmountMinor) || amountMinor !== expectedAmountMinor) {
            const error = new Error('Collected amount must exactly match the order total in PKR minor units');
            error.code = 'PAYMENT_AMOUNT_MISMATCH';
            throw error;
          }
          const at = new Date().toISOString();
          const paymentCollection = {
            state: 'collected', method: 'COD', amountMinor, currency: 'PKR',
            receiptReference, recordedBy: actorId, recordedByRole: actor.role || 'operator',
            recordedAt: at, verification: 'operator-attestation'
          };
          const updated = await repository.update('orders', orderId, {
            paymentState: 'paid_manual_cod', paymentCollection,
            timeline: [...(order.timeline || []), {
              status: 'COD_CASH_COLLECTED', at, actorId,
              note: 'Operator recorded collected COD cash against receipt ' + receiptReference
            }],
            updatedAt: at
          });
          await repository.insert('auditLogs', {
            id: 'AUD-' + randomUUID(), actorId, actorRole: actor.role || 'operator',
            action: 'payment.cod_collection_recorded', targetType: 'order', targetId: orderId,
            meta: { amountMinor, currency: 'PKR', receiptReference, verification: 'operator-attestation' }, at
          });
          return updated;
        }
      ));
    },

    async requestRefund(orderId, input, actor) {
      const actorId = requiredString(actor.id, 'actor.id');
      const reason = requiredString(input.reason, 'reason');
      const idempotencyKey = requiredString(input.idempotencyKey, 'Idempotency-Key');
      return adapter.withTransaction(async ({ repository }) => runIdempotent(
        repository, { orderId, reason, idempotencyKey, actorId }, async () => {
          const order = await repository.findById('orders', orderId);
          if (!order) return null;
          if (!['DELIVERED', 'RETURNED'].includes(order.status)) {
            const error = new Error('Refunds can only be requested for delivered or returned orders');
            error.code = 'INVALID_TRANSITION';
            throw error;
          }
          if (!['paid', 'paid_manual_cod'].includes(order.paymentState)) {
            const error = new Error('A refund cannot be recorded until payment collection is verified');
            error.code = 'REFUND_NOT_ELIGIBLE';
            throw error;
          }
          const priorRefunds = await repository.find('refunds', { orderId });
          if (priorRefunds.some((row) => ['requested', 'approved_simulated'].includes(row.status))) {
            const error = new Error('An active refund already exists for this order');
            error.code = 'REFUND_ALREADY_EXISTS';
            throw error;
          }
          const amountMinor = order.totalMinor ?? order.price?.totalMinor;
          if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
            throw new TypeError('The order does not have a valid refundable PKR amount');
          }
          const at = new Date().toISOString();
          const refund = await repository.insert('refunds', {
            id: 'REF-' + randomUUID(), orderId, buyerId: order.buyerId || order.userId,
            amountMinor, currency: 'PKR', reason, status: 'requested',
            simulated: true, providerStatus: 'not_configured', providerReference: null,
            idempotencyKey, requestedBy: actorId, requestedAt: at, updatedAt: at
          });
          await repository.insert('auditLogs', {
            id: 'AUD-' + randomUUID(), actorId, actorRole: actor.role || 'buyer',
            action: 'refund.request', targetType: 'refund', targetId: refund.id,
            meta: { orderId, amountMinor, currency: 'PKR', simulated: true }, at
          });
          return refund;
        }
      ));
    },

    async decideRefund(refundId, decision, actor) {
      if (!['approved', 'rejected'].includes(decision)) throw new TypeError('Decision must be approved or rejected');
      const actorId = requiredString(actor.id, 'actor.id');
      return adapter.withTransaction(async ({ repository }) => {
        const refund = await repository.findById('refunds', refundId);
        if (!refund) return null;
        if (refund.status !== 'requested') {
          const error = new Error('Only requested refunds can be approved or rejected');
          error.code = 'INVALID_TRANSITION';
          throw error;
        }
        const at = new Date().toISOString();
        const status = decision === 'approved' ? 'approved_simulated' : 'rejected';
        const updated = await repository.update('refunds', refundId, {
          status, simulated: true, providerStatus: 'not_configured',
          providerReference: null, decidedBy: actorId, decidedAt: at, updatedAt: at
        });
        const order = await repository.findById('orders', refund.orderId);
        if (order) {
          await repository.update('orders', order.id, {
            refundState: status,
            timeline: [...(order.timeline || []), {
              status: decision === 'approved' ? 'REFUND_APPROVED_SIMULATED' : 'REFUND_REJECTED',
              at, actorId, note: decision === 'approved'
                ? 'Refund approved for manual processing; no payment provider is connected'
                : 'Refund request rejected'
            }],
            updatedAt: at
          });
        }
        await repository.insert('auditLogs', {
          id: 'AUD-' + randomUUID(), actorId, actorRole: actor.role || 'operator',
          action: 'refund.' + decision, targetType: 'refund', targetId: refundId,
          meta: { orderId: refund.orderId, amountMinor: refund.amountMinor, simulated: true }, at
        });
        return updated;
      });
    }
  };

  function movementBalance(rows) {
    return rows.reduce((balance, movement) => {
      const qty = Number(movement.qty) || 0;
      if (movement.type === 'RECEIVE' || movement.type === 'TRANSFER_IN' || movement.type === 'RETURN_IN') balance.onHand += qty;
      if (movement.type === 'SHIP') {
        balance.onHand -= qty;
        balance.reserved -= qty;
      }
      if (movement.type === 'TRANSFER_OUT') balance.onHand -= qty;
      if (movement.type === 'ADJUST') balance.onHand += qty;
      if (movement.type === 'RESERVE') balance.reserved += qty;
      if (movement.type === 'RELEASE') balance.reserved -= qty;
      return balance;
    }, { onHand: 0, reserved: 0 });
  }

  const stockMovements = {
    async adjust(input) {
      const sku = requiredString(input.sku, 'sku');
      const hubCode = requiredString(input.hubCode, 'hubCode');
      const delta = input.delta;
      if (!Number.isSafeInteger(delta) || delta === 0) throw new TypeError('delta must be a non-zero signed integer');
      const reason = requiredString(input.reason, 'reason');
      const actorId = requiredString(input.actorId, 'actorId');
      const refId = requiredString(input.refId || 'ADJUST-' + randomUUID(), 'refId');
      return adapter.withTransaction(async ({ repository }) => runIdempotent(repository, input, async () => {
        const rows = await repository.find('stock', { sku, hubCode }, { limit: 1 });
        const stock = rows[0];
        if (!stock) {
          const error = new Error('Stock row not found for ' + sku + ' at ' + hubCode);
          error.code = 'STOCK_NOT_FOUND';
          throw error;
        }
        const history = await repository.find('movements', { sku, hubCode });
        const ledgerRows = [...history];
        if (history.length === 0 && stock.onHand > 0) {
          const opening = {
            id: 'MOV-' + randomUUID(), sku, hubCode, type: 'RECEIVE',
            qty: stock.onHand, reason: 'opening_balance',
            refType: 'opening_balance', refId: 'legacy-opening:' + sku + ':' + hubCode,
            actorId: 'system', at: new Date().toISOString()
          };
          await repository.insert('movements', opening);
          ledgerRows.push(opening);
        }
        const movement = {
          id: 'MOV-' + randomUUID(), sku, hubCode, type: 'ADJUST',
          qty: delta, reason, refType: 'admin_action', refId,
          actorId, at: new Date().toISOString()
        };
        const balance = movementBalance([...ledgerRows, movement]);
        if (balance.onHand < 0 || balance.reserved < 0 || balance.reserved > balance.onHand) {
          const error = new Error('Adjustment would make available inventory negative');
          error.code = 'NEGATIVE_STOCK';
          throw error;
        }
        const nextOnHand = stock.onHand + delta;
        await repository.update('stock', stock.id, { ...stock, onHand: nextOnHand });
        const productsForSku = await repository.find('products', { sku, warehouse_hub: hubCode });
        for (const product of productsForSku) {
          await repository.update('products', product.id, {
            stock: nextOnHand,
            updatedAt: movement.at
          });
        }
        await repository.insert('movements', movement);
        await repository.insert('auditLogs', {
          id: 'AUD-' + randomUUID(), actorId, actorRole: input.actorRole || 'operator',
          action: 'inventory.adjust', targetType: 'stock', targetId: sku + ':' + hubCode,
          meta: { delta, reason, refId }, at: movement.at
        });
        return { stock: { ...stock, onHand: nextOnHand }, movement };
      }));
    },

    async restock(input) {
      const sku = requiredString(input.sku, 'sku');
      const hubCode = requiredString(input.hubCode, 'hubCode');
      const qty = integer(input.qty, 'qty', 1);
      const actorId = requiredString(input.actorId, 'actorId');
      const refId = requiredString(input.refId || 'RECEIVE-' + randomUUID(), 'refId');
      return adapter.withTransaction(async ({ repository }) => runIdempotent(repository, input, async () => {
        const rows = await repository.find('stock', { sku, hubCode }, { limit: 1 });
        const stock = rows[0];
        if (!stock) {
          const error = new Error('Stock row not found for ' + sku + ' at ' + hubCode);
          error.code = 'STOCK_NOT_FOUND';
          throw error;
        }
        const at = new Date().toISOString();
        const history = await repository.find('movements', { sku, hubCode });
        if (history.length === 0 && stock.onHand > 0) {
          await repository.insert('movements', {
            id: 'MOV-' + randomUUID(), sku, hubCode, type: 'RECEIVE',
            qty: stock.onHand, reason: 'opening_balance',
            refType: 'opening_balance', refId: 'legacy-opening:' + sku + ':' + hubCode,
            actorId: 'system', at
          });
        }
        await repository.update('stock', stock.id, { ...stock, onHand: stock.onHand + qty });
        const productsForSku = await repository.find('products', { sku, warehouse_hub: hubCode });
        for (const product of productsForSku) {
          await repository.update('products', product.id, { stock: stock.onHand + qty, updatedAt: at });
        }
        const movement = await repository.insert('movements', {
          id: 'MOV-' + randomUUID(), sku, hubCode, type: 'RECEIVE', qty,
          reason: requiredString(input.reason || 'restock', 'reason'),
          refType: 'admin_action', refId, actorId, at
        });
        await repository.insert('auditLogs', {
          id: 'AUD-' + randomUUID(), actorId, actorRole: input.actorRole || 'operator',
          action: 'inventory.restock', targetType: 'stock', targetId: sku + ':' + hubCode,
          meta: { qty, refId }, at
        });
        return { stock: { ...stock, onHand: stock.onHand + qty }, movement };
      }));
    },

    async append(input) {
      const sku = requiredString(input.sku, 'sku');
      const hubCode = requiredString(input.hubCode || input.warehouseId, 'hubCode');
      const type = requiredString(input.type, 'type').toUpperCase();
      if (!MOVEMENT_TYPES.has(type)) throw new TypeError('Unsupported stock movement type');
      const reason = requiredString(input.reason, 'reason');
      const qty = integer(input.qty ?? Math.abs(input.quantityDelta || 0), 'qty', 1);
      if (type === 'ADJUST' && input.quantityDelta !== undefined) {
        if (!Number.isSafeInteger(input.quantityDelta) || input.quantityDelta === 0 || Math.abs(input.quantityDelta) !== qty) {
          throw new TypeError('ADJUST quantityDelta must be a non-zero signed integer matching qty');
        }
      }
      if (type === 'ADJUST' && !reason) throw new TypeError('ADJUST requires a reason code');
      const refType = requiredString(input.refType || (input.orderId ? 'order' : input.adminActionId ? 'admin_action' : ''), 'refType');
      const refId = requiredString(input.refId || input.orderId || input.adminActionId, 'refId');
      const actorId = requiredString(input.actorId || 'system', 'actorId');
      const at = input.at || input.createdAt || new Date().toISOString();
      const movement = {
        id: input.id || 'MOV-' + randomUUID(),
        sku, hubCode, type,
        qty: type === 'ADJUST' ? input.quantityDelta : qty,
        reason, refType, refId, actorId, at
      };

      return adapter.withTransaction(async ({ repository }) => {
        const rows = await repository.find('movements', { sku, hubCode });
        const after = movementBalance([...rows, movement]);
        if (after.onHand < 0 || after.reserved < 0 || after.reserved > after.onHand) {
          const error = new Error('Stock movement would make available inventory negative');
          error.code = 'NEGATIVE_STOCK';
          throw error;
        }
        return repository.insert('movements', movement);
      });
    },

    async transfer(input) {
      const sku = requiredString(input.sku, 'sku');
      const fromHubCode = requiredString(input.fromHubCode, 'fromHubCode');
      const toHubCode = requiredString(input.toHubCode, 'toHubCode');
      if (fromHubCode === toHubCode) throw new TypeError('Transfer hubs must be different');
      const qty = integer(input.qty, 'qty', 1);
      const actorId = requiredString(input.actorId || 'system', 'actorId');
      const reason = requiredString(input.reason, 'reason');
      const at = input.at || new Date().toISOString();
      const refId = input.refId || 'TRANSFER-' + randomUUID();

      return adapter.withTransaction(async ({ repository }) => runIdempotent(repository, input, async () => {
        const warehousesFound = await repository.find('warehouses', {
          code: { $in: [fromHubCode, toHubCode] }
        });
        if (warehousesFound.length !== 2) {
          const error = new Error('Both transfer warehouses must exist');
          error.code = 'WAREHOUSE_NOT_FOUND';
          throw error;
        }
        const sourceStocks = await repository.find('stock', { sku, hubCode: fromHubCode }, { limit: 1 });
        const destinationStocks = await repository.find('stock', { sku, hubCode: toHubCode }, { limit: 1 });
        const sourceStock = sourceStocks[0];
        if (!sourceStock) {
          const error = new Error('Source stock row not found');
          error.code = 'STOCK_NOT_FOUND';
          throw error;
        }
        const destinationStock = destinationStocks[0] || {
          id: sku + ':' + toHubCode, sku, hubCode: toHubCode,
          onHand: 0, reserved: 0
        };
        const sourceHistory = await repository.find('movements', { sku, hubCode: fromHubCode });
        const destinationHistory = await repository.find('movements', { sku, hubCode: toHubCode });
        if (!sourceHistory.length && sourceStock.onHand > 0) {
          await repository.insert('movements', {
            id: 'MOV-' + randomUUID(), sku, hubCode: fromHubCode, type: 'RECEIVE',
            qty: sourceStock.onHand, reason: 'opening_balance',
            refType: 'opening_balance', refId: 'legacy-opening:' + sku + ':' + fromHubCode,
            actorId: 'system', at
          });
        }
        if (!destinationHistory.length && destinationStock.onHand > 0) {
          await repository.insert('movements', {
            id: 'MOV-' + randomUUID(), sku, hubCode: toHubCode, type: 'RECEIVE',
            qty: destinationStock.onHand, reason: 'opening_balance',
            refType: 'opening_balance', refId: 'legacy-opening:' + sku + ':' + toHubCode,
            actorId: 'system', at
          });
        }
        const sourceBalance = movementBalance(sourceHistory.length
          ? sourceHistory
          : sourceStock.onHand > 0 ? [{ type: 'RECEIVE', qty: sourceStock.onHand }] : []);
        if (sourceBalance.onHand - sourceBalance.reserved < qty) {
          const error = new Error('Insufficient available stock for transfer');
          error.code = 'NEGATIVE_STOCK';
          throw error;
        }

        const transferOut = await repository.insert('movements', {
          id: 'MOV-' + randomUUID(), sku, hubCode: fromHubCode, type: 'TRANSFER_OUT',
          qty, reason, refType: 'transfer', refId, actorId, at
        });
        const transferIn = await repository.insert('movements', {
          id: 'MOV-' + randomUUID(), sku, hubCode: toHubCode, type: 'TRANSFER_IN',
          qty, reason, refType: 'transfer', refId, actorId, at
        });
        await repository.update('stock', sourceStock.id, {
          ...sourceStock, onHand: sourceStock.onHand - qty
        });
        if (destinationStocks[0]) {
          await repository.update('stock', destinationStock.id, {
            ...destinationStock, onHand: destinationStock.onHand + qty
          });
        } else {
          await repository.insert('stock', { ...destinationStock, onHand: qty });
        }
        const productsAtSource = await repository.find('products', { sku, warehouse_hub: fromHubCode });
        for (const product of productsAtSource) {
          await repository.update('products', product.id, {
            stock: sourceStock.onHand - qty, updatedAt: at
          });
        }
        const productsAtDestination = await repository.find('products', { sku, warehouse_hub: toHubCode });
        for (const product of productsAtDestination) {
          await repository.update('products', product.id, {
            stock: destinationStock.onHand + qty, updatedAt: at
          });
        }
        await repository.insert('auditLogs', {
          id: 'AUD-' + randomUUID(), actorId, actorRole: input.actorRole || 'operator',
          action: 'inventory.transfer', targetType: 'stock', targetId: sku,
          meta: { fromHubCode, toHubCode, qty, refId }, at
        });
        return { transferOut, transferIn, refId, sourceOnHand: sourceStock.onHand - qty, destinationOnHand: destinationStock.onHand + qty };
      }));
    },

    async reconcile(sku, hubCode, expectedOnHand, expectedReserved) {
      const rows = await adapter.find('movements', { sku, hubCode });
      const balance = movementBalance(rows);
      const matches = balance.onHand === expectedOnHand &&
        (expectedReserved === undefined || balance.reserved === expectedReserved);
      return {
        sku, hubCode, onHand: balance.onHand, reserved: balance.reserved,
        available: balance.onHand - balance.reserved,
        expectedOnHand, expectedReserved, matches, movementCount: rows.length
      };
    }
  };

  const auditLogs = {
    append(input) {
      return adapter.insert('auditLogs', {
        ...input, id: input.id || 'AUD-' + randomUUID(),
        action: requiredString(input.action, 'action'),
        actorId: requiredString(input.actorId, 'actorId'),
        at: input.at || new Date().toISOString()
      });
    }
  };

  const tariffRules = {
    create(input) {
      const source = requiredString(input.source, 'source');
      if (!['demo-estimate', 'official', 'licensed-provider'].includes(source)) throw new TypeError('Unsupported tariff rule source');
      return adapter.insert('tariffRules', {
        ...input, id: input.id || 'TARIFF-' + randomUUID(),
        code: requiredString(input.code, 'code'),
        version: integer(input.version, 'version', 1),
        source,
        createdAt: input.createdAt || new Date().toISOString()
      });
    }
  };

  return { users, warehouses, products, orders, stockMovements, auditLogs, tariffRules };
}

module.exports = { createDomainRepositories, BUYER_ROLES, MOVEMENT_TYPES };
