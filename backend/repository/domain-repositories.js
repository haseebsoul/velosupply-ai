'use strict';

const { randomUUID } = require('node:crypto');

const BUYER_ROLES = new Set(['buyer', 'operator', 'admin']);
const MOVEMENT_REASONS = new Set(['opening_balance', 'restock', 'sale', 'refund', 'adjustment']);

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
      if (role === 'buyer' && !['filer', 'non-filer'].includes(input.filerStatus)) {
        throw new TypeError('filerStatus must be filer or non-filer for buyers');
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

  const products = {
    create(input) {
      const sku = requiredString(input.sku, 'sku');
      const batchHash = requiredString(input.batchHash, 'batchHash');
      return adapter.insert('products', {
        ...input, id: input.id || 'PROD-' + randomUUID(), sku, batchHash,
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
        const unitExGstPkr = Number(item.unitExGstPkr);
        if (!Number.isFinite(unitExGstPkr) || unitExGstPkr < 0) throw new TypeError('unitExGstPkr must be a non-negative PKR amount');
        const sku = requiredString(item.sku, 'sku');
        const name = requiredString(item.name, 'name');
        const lineEx = Math.round(unitExGstPkr * qty);
        const lineGst = Math.round(lineEx * gstPct / 100);
        return {
          id: item.id || 'ITEM-' + randomUUID(),
          sku,
          name,
          qty,
          unitExGstPkr: Math.round(unitExGstPkr),
          lineEx,
          lineGst
        };
      });

      const subtotalEx = items.reduce((sum, item) => sum + item.lineEx, 0);
      const gst = items.reduce((sum, item) => sum + item.lineGst, 0);
      const deliveryFee = subtotalEx > 150000 ? 0 : Number(deliveryFees[city]);
      if (!Number.isSafeInteger(deliveryFee) || deliveryFee < 0) throw new TypeError('Delivery fee must be a non-negative whole PKR amount');
      const totalPkr = subtotalEx + gst + deliveryFee;
      if (![subtotalEx, gst, totalPkr].every(Number.isSafeInteger)) throw new TypeError('PKR order totals exceed the safe integer range');

      const at = new Date().toISOString();
      const order = {
        ...orderInput,
        id: orderInput.id || 'ORD-' + randomUUID(),
        code: orderInput.code || 'VS-' + randomUUID(),
        buyerId,
        city,
        items: items.map(({ sku, name, qty, unitExGstPkr }) => ({ sku, name, qty, unitExGstPkr })),
        price: { subtotalEx, gst, deliveryFee, totalPkr },
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
            unitExGstPkr: item.unitExGstPkr
          }));
        }
        return { order: saved, items: savedItems };
      });
    }
  };

  const stockMovements = {
    async append(input) {
      const sku = requiredString(input.sku, 'sku');
      const hubCode = requiredString(input.hubCode || input.warehouseId, 'hubCode');
      const reason = requiredString(input.reason, 'reason');
      if (!MOVEMENT_REASONS.has(reason)) throw new TypeError('Unsupported stock movement reason');
      if (!Number.isSafeInteger(input.quantityDelta) || input.quantityDelta === 0) throw new TypeError('quantityDelta must be a non-zero integer');
      if (reason === 'sale' && input.quantityDelta >= 0) throw new TypeError('sale movement must reduce stock');
      if (reason === 'restock' && input.quantityDelta <= 0) throw new TypeError('restock movement must increase stock');
      const refType = input.refType || (input.orderId ? 'order' : input.adminActionId ? 'admin_action' : reason === 'opening_balance' ? 'opening_balance' : '');
      const refId = input.refId || input.orderId || input.adminActionId || (reason === 'opening_balance' ? 'opening:' + randomUUID() : '');
      if (!refType || !refId) throw new TypeError('A stock movement must reference an order or administrative action');
      const at = input.at || input.createdAt || new Date().toISOString();
      const actorId = input.actorId || 'system';
      return adapter.insert('movements', {
        id: input.id || 'MOV-' + randomUUID(),
        sku,
        hubCode,
        type: input.quantityDelta > 0 ? 'IN' : 'OUT',
        qty: Math.abs(input.quantityDelta),
        reason,
        refType,
        refId,
        actorId,
        at
      });
    },
    async reconcile(sku, hubCode, expectedOnHand) {
      const rows = await adapter.find('movements', { sku, hubCode });
      const ledgerOnHand = rows.reduce((sum, movement) => sum + (movement.type === 'IN' ? movement.qty : -movement.qty), 0);
      return { sku, hubCode, ledgerOnHand, expectedOnHand, matches: ledgerOnHand === expectedOnHand, movementCount: rows.length };
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

  return { users, products, orders, stockMovements, auditLogs, tariffRules };
}

module.exports = { createDomainRepositories, BUYER_ROLES, MOVEMENT_REASONS };
