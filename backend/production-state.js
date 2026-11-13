'use strict';

const { DB_SCHEMA_VERSION } = require('./seed');

function createEmptyProductionState(now = new Date().toISOString()) {
  return {
    schemaVersion: DB_SCHEMA_VERSION,
    dataMode: 'production',
    users: [],
    warehouses: [],
    products: [],
    orders: [],
    logs: [],
    newsletter: [],
    rewardClaims: [],
    metrics: {
      gmv24h: 0,
      activeOrders: 0,
      fulfillmentHealth: 0,
      packetsPerSec: 0,
      avgLatencyMs: 0,
      threatsBlocked: 0,
      detectionTimeMs: 0,
      efficiencyScore: 0,
      hubCapacities: []
    },
    telemetry: { tick: 0, updatedAt: now }
  };
}

module.exports = { createEmptyProductionState };
