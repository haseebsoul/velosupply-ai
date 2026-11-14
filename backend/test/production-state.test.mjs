import { describe, it, expect } from 'vitest';
import productionStateModule from '../production-state.js';

const { createEmptyProductionState } = productionStateModule;

describe('production storage bootstrap', () => {
  it('starts an empty Atlas state without synthetic buyers, inventory, or orders', () => {
    const state = createEmptyProductionState('2026-11-13T00:00:00.000Z');
    expect(state.schemaVersion).toBe(2);
    expect(state.dataMode).toBe('production');
    expect(state.users).toEqual([]);
    expect(state.warehouses).toEqual([]);
    expect(state.products).toEqual([]);
    expect(state.orders).toEqual([]);
    expect(state.orderItems).toEqual([]);
    expect(state.movements).toEqual([]);
    expect(state.tariffRules).toEqual([]);
    expect(state.metrics).toEqual({
      gmv24h: 0,
      activeOrders: 0,
      fulfillmentHealth: 0,
      packetsPerSec: 0,
      avgLatencyMs: 0,
      threatsBlocked: 0,
      detectionTimeMs: 0,
      efficiencyScore: 0,
      hubCapacities: []
    });
  });
});
