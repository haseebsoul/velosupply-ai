import express from 'express';
import request from 'supertest';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sreModule from '../sre.js';
const { createSRE, SLOS, RUNBOOKS, percentile } = sreModule;

function createHarness() {
  const state = {
    products: [{ id: 'p-1', sku: 'VS-1', stock: 12 }],
    orders: [],
    logs: [],
    sre: {
      alerts: [], incidents: [], healthChecks: [], audit: [],
      loginAttempts: [], backupHistory: [], runbookProgress: {},
      chaos: { mode: 'reset', expiresAt: null, activatedAt: null }
    }
  };
  const broadcast = [];
  const sre = createSRE({
    getDb: () => state,
    persist: async () => {},
    broadcast: (event) => broadcast.push(event),
    getMongoClient: () => null,
    getStateCollection: () => null,
    getDbPath: () => '/tmp/velosupply-test/db.json',
    getWebSocketServer: () => null,
    getWebSocketClients: () => 0,
    isApiReady: () => true,
    isWebSocketReady: () => true
  });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'operator-test', role: 'operator' };
    next();
  });
  app.use(sre.chaosMiddleware);
  app.use('/api/sre', sre.router);
  app.get('/api/products', (_req, res) => res.json(state.products));
  return { app, state, sre, broadcast };
}

describe('SRE specification primitives', () => {
  it('defines all six SLOs with the required targets', () => {
    expect(SLOS.map((slo) => slo.target)).toEqual([0.95, 0.99, 1, 0.995, 0.999, 0.95]);
    expect(SLOS).toHaveLength(6);
  });

  it('seeds all seven operational runbooks', () => {
    expect(RUNBOOKS).toHaveLength(7);
    expect(RUNBOOKS.map((book) => book.id)).toEqual(['RB-01', 'RB-02', 'RB-03', 'RB-04', 'RB-05', 'RB-06', 'RB-07']);
    expect(RUNBOOKS.every((book) => book.trigger && book.impact && book.steps.length && book.verify)).toBe(true);
  });

  it('calculates percentiles from a stable sorted sample', () => {
    expect(percentile([9, 1, 5, 3, 7], 0.5)).toBe(5);
    expect(percentile([9, 1, 5, 3, 7], 0.95)).toBe(9);
    expect(percentile([], 0.95)).toBe(0);
  });
});

describe('SRE API', () => {
  let harness;
  beforeEach(() => { harness = createHarness(); });
  afterEach(() => harness.sre.stop());

  it('returns the reliability dashboard and SLO samples', async () => {
    const response = await request(harness.app).get('/api/sre').expect(200);
    expect(response.body.slos).toHaveLength(6);
    expect(response.body.runbooks).toHaveLength(7);
    expect(response.body.metrics).toHaveProperty('p95');
    expect(response.body.services.services).toHaveLength(5);
  });

  it('creates, updates, annotates, and deletes incidents', async () => {
    const created = await request(harness.app).post('/api/sre/incidents').send({
      title: 'Checkout is slow',
      severity: 'SEV2',
      status: 'open',
      summary: 'Elevated p95 on checkout.'
    }).expect(201);
    const id = created.body.incident.id;
    await request(harness.app).post('/api/sre/incidents/' + id + '/notes')
      .send({ note: 'Checked the API latency samples.' }).expect(201);
    const updated = await request(harness.app).patch('/api/sre/incidents/' + id)
      .send({ status: 'mitigated' }).expect(200);
    expect(updated.body.incident.timeline).toHaveLength(3);
    expect(updated.body.incident.status).toBe('mitigated');
    await request(harness.app).delete('/api/sre/incidents/' + id).expect(200);
    expect(harness.state.sre.incidents).toHaveLength(0);
  });

  it('persists runbook checklist completion per operator', async () => {
    const books = await request(harness.app).get('/api/sre/runbooks').expect(200);
    expect(books.body).toHaveLength(7);
    const result = await request(harness.app).put('/api/sre/runbooks/RB-01/progress')
      .send({ checkedSteps: [0, 2] }).expect(200);
    expect(result.body.checkedSteps).toEqual([0, 2]);
    const again = await request(harness.app).get('/api/sre/runbooks').expect(200);
    expect(again.body[0].checkedSteps).toEqual([0, 2]);
  });

  it('limits chaos effects to the documented product and checkout routes', async () => {
    await request(harness.app).post('/api/sre/chaos').send({ mode: 'circuit' }).expect(200);
    await request(harness.app).get('/api/products').expect(503);
    await request(harness.app).get('/api/sre/health').expect(200);
    await request(harness.app).post('/api/sre/chaos').send({ mode: 'reset' }).expect(200);
    await request(harness.app).get('/api/products').expect(200);
  });

  it('acknowledges and resolves stored alerts', async () => {
    const alert = {
      id: 'ALT-test', rule: 'db_slow', severity: 'warn', status: 'firing',
      value: 340, threshold: 300, firedAt: new Date().toISOString()
    };
    harness.state.sre.alerts.push(alert);
    const ack = await request(harness.app).patch('/api/sre/alerts/ALT-test/ack').expect(200);
    expect(ack.body.alert.status).toBe('acknowledged');
    const resolved = await request(harness.app).patch('/api/sre/alerts/ALT-test/resolve').expect(200);
    expect(resolved.body.alert.status).toBe('resolved');
  });

  it('records health for all five dependencies and marks unavailable integrations honestly', async () => {
    const rows = await harness.sre.healthCheck();
    expect(rows.map((row) => row.service)).toEqual(['API', 'Database', 'WebSocket', 'Stock ledger', 'Payment gateway']);
    expect(rows.find((row) => row.service === 'API').status).toBe('up');
    expect(rows.find((row) => row.service === 'Stock ledger').status).toBe('degraded');
    expect(rows.find((row) => row.service === 'Payment gateway').status).toBe('degraded');
  });
});
