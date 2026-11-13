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

  const orders = {
    async createWithItems(orderInput, itemInputs) {
      const userId = requiredString(orderInput.userId, 'userId');
      if (!Array.isArray(itemInputs) || !itemInputs.length) throw new TypeError('At least one order item is required');
      const items = itemInputs.map((item) => ({
        id: item.id || 'ITEM-' + randomUUID(),
        productId: requiredString(item.productId, 'productId'),
        quantity: integer(item.quantity, 'quantity', 1),
        unitPriceMinor: integer(item.unitPriceMinor, 'unitPriceMinor')
      }));
      const totalMinor = integer(orderInput.totalMinor, 'totalMinor');
      const calculated = items.reduce((sum, item) => sum + item.quantity * item.unitPriceMinor, 0);
      if (!Number.isSafeInteger(calculated) || calculated !== totalMinor) throw new TypeError('totalMinor must equal the sum of integer-minor-unit order items');
      const order = {
        ...orderInput, id: orderInput.id || 'ORD-' + randomUUID(),
        userId, totalMinor, currency: orderInput.currency || 'PKR',
        createdAt: orderInput.createdAt || new Date().toISOString()
      };
      return adapter.withTransaction(async ({ repository }) => {
        const saved = await repository.insert('orders', order);
        for (const item of items) await repository.insert('orderItems', { ...item, orderId: saved.id });
        return { order: saved, items };
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
        type: input.type || (input.quantityDelta > 0 ? 'IN' : 'OUT'),
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
