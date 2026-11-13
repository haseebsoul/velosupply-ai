'use strict';

const { randomUUID } = require('node:crypto');

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
    async softDelete(id, at = new Date().toISOString()) {
      const user = await adapter.findById('users', id);
      if (!user) return null;
      return adapter.update('users', id, { isActive: false, deletedAt: at });
    }
  };

  const warehouses = {
    create(input) {
      const code = requiredString(input.code, 'code');
      const name = requiredString(input.name, 'name');
      return adapter.insert('warehouses', {
        ...input, id: input.id || 'WH-' + randomUUID(), code, name,
        seedOrigin: input.seedOrigin === true,
        createdAt: input.createdAt || new Date().toISOString()
      });
    }
  };

  const products = {
    async create(input) {
      const sku = requiredString(input.sku, 'sku');
      const batchHash = requiredString(input.batchHash, 'batchHash');
      const originWarehouseId = requiredString(input.originWarehouseId || input.warehouse_hub, 'originWarehouseId');
      const warehouse = await adapter.findById('warehouses', originWarehouseId) ||
        (await adapter.find('warehouses', { code: originWarehouseId }, { limit: 1 }))[0];
      if (!warehouse) throw new TypeError('originWarehouseId must reference an existing warehouse');
      return adapter.insert('products', {
        ...input, id: input.id || 'PROD-' + randomUUID(), sku, batchHash,
        originWarehouseId: warehouse.id,
        archivedAt: null, createdAt: input.createdAt || new Date().toISOString()
      });
    },
    async archive(id, at = new Date().toISOString()) {
      const product = await adapter.findById('products', id);
      if (!product) return null;
      return adapter.update('products', id, { archivedAt: at });
    }
  };

  const DELIVERY_FEES_PKR = {
    Karachi: 350,
    Lahore: 400,
    Islamabad: 450,
    Rawalpindi: 450,
    Faisalabad: 500,
    Multan: 550,
    Peshawar: 650,
    Quetta: 900
  };

  const orders = {
    async createWithItems(orderInput, itemInputs) {
      const buyerId = requiredString(orderInput.buyerId || orderInput.userId, 'buyerId');
      const city = requiredString(orderInput.city, 'city');
      if (!Array.isArray(itemInputs) || !itemInputs.length) throw new TypeError('At least one order item is required');

      const settings = await adapter.find('settings', { key: { $in: ['gstPct', 'deliveryFeeTable'] } });
      const gstSetting = settings.find((entry) => entry.key === 'gstPct');
      const deliverySetting = settings.find((entry) => entry.key === 'deliveryFeeTable');
      const gstPct = gstSetting ? Number(gstSetting.value) : 18;
      if (!Number.isFinite(gstPct) || gstPct < 0 || gstPct > 100) throw new TypeError('gstPct setting must be between 0 and 100');
      const deliveryFees = deliverySetting && deliverySetting.value && typeof deliverySetting.value === 'object'
        ? { ...DELIVERY_FEES_PKR, ...deliverySetting.value }
        : DELIVERY_FEES_PKR;
      if (!Object.prototype.hasOwnProperty.call(deliveryFees, city)) throw new TypeError('Unsupported delivery city: ' + city);

      const items = itemInputs.map((item) => {
        const qty = integer(item.qty ?? item.quantity, 'qty', 1);
        const unitExGstPkr = integer(item.unitExGstPkr, 'unitExGstPkr', 0);
        const sku = requiredString(item.sku, 'sku');
        const name = requiredString(item.name, 'name');
        const lineEx = Math.round(unitExGstPkr * qty);
        const lineGst = Math.round(lineEx * gstPct / 100);
        return {
          id: item.id || 'ITEM-' + randomUUID(),
          sku,
          name,
          qty,
          unitExGstPkr,
          lineEx,
          lineGst
        };
      });

      const subtotalExMinor = items.reduce((sum, item) => sum + item.lineExMinor, 0);
      const gstMinor = items.reduce((sum, item) => sum + item.lineGstMinor, 0);
      const deliveryFeePkr = subtotalExMinor > 15000000 ? 0 : Number(deliveryFees[city]);
      if (!Number.isSafeInteger(deliveryFeePkr) || deliveryFeePkr < 0) throw new TypeError('Delivery fee must be a non-negative whole PKR amount');
      const deliveryFeeMinor = deliveryFeePkr * 100;
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
        price: { currency: 'PKR', subtotalExMinor, gstMinor, deliveryFeeMinor, totalMinor },
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
      const at = input.at || new Date().toISOString();
      const refId = input.refId || 'TRANSFER-' + randomUUID();

      return adapter.withTransaction(async ({ repository }) => {
        const sourceRows = await repository.find('movements', { sku, hubCode: fromHubCode });
        const source = movementBalance(sourceRows);
        if (source.onHand - source.reserved < qty) {
          const error = new Error('Insufficient available stock for transfer');
          error.code = 'NEGATIVE_STOCK';
          throw error;
        }
        const transferOut = await repository.insert('movements', {
          id: 'MOV-' + randomUUID(), sku, hubCode: fromHubCode, type: 'TRANSFER_OUT',
          qty, reason: requiredString(input.reason, 'reason'),
          refType: 'transfer', refId, actorId, at
        });
        const transferIn = await repository.insert('movements', {
          id: 'MOV-' + randomUUID(), sku, hubCode: toHubCode, type: 'TRANSFER_IN',
          qty, reason: input.reason, refType: 'transfer', refId, actorId, at
        });
        return { transferOut, transferIn, refId };
      });
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

module.exports = { createDomainRepositories, BUYER_ROLES, MOVEMENT_TYPES, movementBalance };
