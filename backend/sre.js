'use strict';

const v8 = require('node:v8');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const express = require('express');
const { z } = require('zod');

const WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const SAMPLE_LIMIT = 3600;
const SLOS = [
  { id: 'SLO-1', name: 'Browse', target: 0.95, window: '30 days', description: 'GET /api/products and GET /api/health answered under 150ms' },
  { id: 'SLO-2', name: 'Checkout', target: 0.99, window: '30 days', description: 'Checkout requests complete without a 5xx response' },
  { id: 'SLO-3', name: 'Stock accuracy', target: 1, window: 'Always', description: 'Zero negative-stock or stock-ledger mismatch events', zeroTolerance: true },
  { id: 'SLO-4', name: 'Live updates', target: 0.995, window: '30 days', description: 'WebSocket ping responses arrive within 2 seconds' },
  { id: 'SLO-5', name: 'Availability', target: 0.999, window: '30 days', description: 'Health checks report UP' },
  { id: 'SLO-6', name: 'Dispatch', target: 0.95, window: '30 days', description: 'Confirmed orders are dispatched within 24 hours' }
];

const RUNBOOKS = [
  { id: 'RB-01', title: 'High API latency', trigger: 'latency_p95_high', impact: 'Browse and checkout responses become slow.', steps: ['Check the p95 chart and recent TELEMETRY_TICK samples.', 'Check Database service latency and recent health-check failures.', 'Inspect event-loop lag and the last 50 structured request logs.', 'Reset any active latency chaos experiment.', 'Verify p95 remains under 150ms for at least 60 seconds.'], verify: 'p95 is below 150ms and the latency alert is resolved.' },
  { id: 'RB-02', title: 'Checkout error spike', trigger: 'error_rate_high', impact: 'Buyers may be unable to place orders.', steps: ['Read the last 50 error logs.', 'Identify the failing checkout route and request IDs.', 'Check the Payment gateway service state and adapter configuration.', 'Check the circuit breaker state and wait for the half-open probe.', 'Verify the checkout 5xx rate is below 1 percent.'], verify: 'Checkout error rate is below 1 percent and a successful test checkout is recorded.' },
  { id: 'RB-03', title: 'Circuit breaker open', trigger: 'circuit_open', impact: 'Checkout is temporarily rejected to prevent cascading failures.', steps: ['Confirm breaker state and failure count in Reliability.', 'Confirm checkout shows the retry response.', 'Inspect structured logs for the originating route and request IDs.', 'Fix the dependency or configuration that caused failures.', 'Wait for the probe window and verify the breaker closes.'], verify: 'Circuit breaker is CLOSED and checkout returns to normal.' },
  { id: 'RB-04', title: 'Stock mismatch', trigger: 'stock_mismatch', impact: 'Inventory counts may be unsafe for fulfillment.', steps: ['Pause manual stock adjustments and transfers.', 'Compare current stock values against the movement ledger when available.', 'Open or update a SEV1 incident.', 'Correct stock with an audited ADJUST movement and mandatory reason.', 'Run the stock integrity check again.'], verify: 'No negative stock or ledger mismatch remains. An immutable movement ledger is required for full reconciliation.' },
  { id: 'RB-05', title: 'WebSocket drop', trigger: 'ws_drop', impact: 'Live Activity and Reliability updates may be delayed.', steps: ['Check the current WebSocket client count and ping round-trip samples.', 'Check process memory and event-loop lag.', 'Review proxy idle timeout and WebSocket upgrade configuration.', 'Ask connected clients to reconnect using exponential backoff.', 'Verify client count and ping latency recover.'], verify: 'WebSocket client count recovers and ping responses are under 2 seconds.' },
  { id: 'RB-06', title: 'Database unreachable', trigger: 'db_slow or health down', impact: 'Persistence may be unavailable; writes must not be assumed saved.', steps: ['Confirm Atlas cluster status or the local file adapter state.', 'Inspect database latency and the last persistence error.', 'Serve only safe cached reads; do not acknowledge writes that were not persisted.', 'Restore the connection and verify the active database adapter.', 'Run a harmless write/read verification in a controlled environment.'], verify: 'Database health is UP and a controlled write/read check succeeds.' },
  { id: 'RB-07', title: 'Error budget low', trigger: 'budget_low', impact: 'The service is consuming reliability budget too quickly.', steps: ['Review the 30-day burn chart and remaining error budget.', 'Freeze risky releases and non-essential operational changes.', 'Open or update an incident with the affected SLO.', 'Identify the dominant source of bad events and fix it.', 'Verify burn rate is below 1 and budget recovery is stable.'], verify: 'Budget is above 20 percent or an approved mitigation plan is recorded.' }
];

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))] * 100) / 100;
}

function createSRE(deps) {
  const requests = [];
  const samples = [];
  const dbLatencies = [];
  const wsLatencies = [];
  const pendingPings = new Map();
  let currentBucket = null;
  const healthFailures = new Map();
  const ruleStartedAt = new Map();
  const ruleClearAt = new Map();
  const rateBuckets = new Map();
  let lastTickAt = Date.now();
  let recentClientCounts = [];
  let circuitFailures = 0;
  let circuitOpenedAt = null;
  let timers = [];
  let started = false;

  function getDb() {
    const db = deps.getDb();
    if (!db) throw new Error('Database has not been initialized');
    if (!db.sre) db.sre = {};
    const s = db.sre;
    if (!Array.isArray(s.alerts)) s.alerts = [];
    if (!Array.isArray(s.incidents)) s.incidents = [];
    if (!Array.isArray(s.healthChecks)) s.healthChecks = [];
    if (!Array.isArray(s.audit)) s.audit = [];
    if (!Array.isArray(s.loginAttempts)) s.loginAttempts = [];
    if (!Array.isArray(s.backupHistory)) s.backupHistory = [];
    if (!s.runbookProgress || typeof s.runbookProgress !== 'object') s.runbookProgress = {};
    if (!s.chaos) s.chaos = { mode: 'reset', expiresAt: null, activatedAt: null };
    return db;
  }

  function log(level, msg, fields = {}) {
    const entry = { ts: new Date().toISOString(), level, msg, ...fields };
    try { process.stdout.write(JSON.stringify(entry) + '\n'); } catch (_error) { /* stdout can be unavailable during shutdown */ }
    try {
      const db = getDb();
      if (Array.isArray(db.logs)) {
        db.logs.unshift({ id: randomUUID(), type: 'SRE', level, message: msg, timestamp: entry.ts, metadata: fields });
        db.logs = db.logs.slice(0, 500);
      }
    } catch (_error) { /* startup may not have loaded the database yet */ }
  }

  function audit(action, actor, meta = {}) {
    try {
      const db = getDb();
      db.sre.audit.unshift({ id: randomUUID(), actorId: actor?.id || null, actorRole: actor?.role || 'system', action, meta, at: new Date().toISOString() });
      db.sre.audit = db.sre.audit.slice(0, 1000);
      Promise.resolve(deps.persist?.()).catch((error) => log('ERROR', 'SRE audit persistence failed', { error: error.message }));
    } catch (error) { log('ERROR', 'SRE audit write failed', { error: error.message }); }
  }

  function recordRequest(event) {
    const now = Date.now();
    requests.push({ at: now, path: event.path, method: event.method, status: event.status, ms: Number(event.ms) || 0 });
    while (requests.length && requests[0].at < now - WINDOW_MS) requests.shift();
    if (event.status >= 500 && isChaosTarget(event.path)) {
      circuitFailures += 1;
      if (circuitFailures >= 25 && !circuitOpenedAt) openCircuit('25 failed target requests');
    }
  }

  function recordDbLatency(ms) {
    dbLatencies.push({ at: Date.now(), ms: Number(ms) || 0 });
    while (dbLatencies.length && dbLatencies[0].at < Date.now() - 60_000) dbLatencies.shift();
  }

  function recordWebSocketLatency(ms) {
    wsLatencies.push({ at: Date.now(), ms: Number(ms) || 0 });
    while (wsLatencies.length && wsLatencies[0].at < Date.now() - WINDOW_MS) wsLatencies.shift();
  }

  function isChaosTarget(route) {
    return ['/api/products', '/api/orders/checkout', '/api/checkout'].includes(route);
  }

  function activeChaos() {
    const db = getDb();
    const chaos = db.sre.chaos;
    if (chaos.expiresAt && Date.now() >= Date.parse(chaos.expiresAt)) {
      db.sre.chaos = { mode: 'reset', expiresAt: null, activatedAt: null };
      if (circuitOpenedAt) {
        circuitOpenedAt = null;
        circuitFailures = 0;
        log('INFO', 'Circuit breaker returned to CLOSED after the 60-second recovery window.');
      }
      return db.sre.chaos;
    }
    return chaos;
  }

  function openCircuit(reason) {
    circuitOpenedAt = Date.now();
    const db = getDb();
    db.sre.chaos = { ...db.sre.chaos, mode: 'circuit-open', expiresAt: new Date(Date.now() + 60_000).toISOString(), activatedAt: new Date().toISOString(), reason };
    fireAlert('circuit_open', 'critical', circuitFailures, 25, 'Circuit breaker entered OPEN state.');
    log('CRITICAL', 'Circuit breaker opened', { reason, failures: circuitFailures });
    deps.broadcast?.({ type: 'CIRCUIT_OPEN', level: 'CRITICAL', message: 'Checkout is temporarily paused while the circuit breaker recovers.', timestamp: new Date().toISOString() });
    Promise.resolve(deps.persist?.()).catch((error) => log('ERROR', 'Circuit state persistence failed', { error: error.message }));
  }

  function currentMetrics() {
    const now = Date.now();
    const recent = requests.filter((entry) => entry.at >= now - 60_000);
    const latencies = recent.map((entry) => entry.ms);
    const total = recent.length;
    const errors = recent.filter((entry) => entry.status >= 500).length;
    const clients = deps.getWebSocketClients ? deps.getWebSocketClients() : 0;
    const memory = process.memoryUsage();
    const heapLimit = Math.max(v8.getHeapStatistics().heap_size_limit, 1);
    const dbWindow = dbLatencies.filter((entry) => entry.at >= now - 60_000).map((entry) => entry.ms);
    return {
      at: new Date(now).toISOString(),
      rps: Math.round((total / 60) * 100) / 100,
      p50: percentile(latencies, 0.50),
      p95: percentile(latencies, 0.95),
      p99: percentile(latencies, 0.99),
      errorRate: total ? Math.round((errors / total) * 10000) / 10000 : 0,
      wsClients: clients,
      memMb: Math.round(memory.heapUsed / 1024 / 1024 * 100) / 100,
      heapUsedPct: Math.round(memory.heapUsed / heapLimit * 10000) / 100,
      eventLoopLagMs: Math.max(0, Date.now() - lastTickAt - 1000),
      dbLatencyMs: percentile(dbWindow, 0.95),
      orderThroughput: recent.filter((entry) => entry.path.includes('checkout') && entry.status < 500).length
    };
  }

  function sloReport() {
    const now = Date.now();
    const inWindow = requests.filter((event) => event.at >= now - WINDOW_MS);
    const db = getDb();
    const health = db.sre.healthChecks.filter((entry) => Date.parse(entry.at) >= now - WINDOW_MS);
    const negativeStock = (db.products || []).some((product) => Number(product.stock) < 0);
    return SLOS.map((slo) => {
      let selected = [];
      let bad = 0;
      if (slo.id === 'SLO-1') {
        selected = inWindow.filter((event) => ['/api/products', '/api/health', '/health'].includes(event.path));
        bad = selected.filter((event) => event.ms >= 150 || event.status >= 500).length;
      } else if (slo.id === 'SLO-2') {
        selected = inWindow.filter((event) => ['/api/orders/checkout', '/api/checkout'].includes(event.path));
        bad = selected.filter((event) => event.status >= 500).length;
      } else if (slo.id === 'SLO-3') {
        selected = [{ at: now }];
        bad = negativeStock ? 1 : 0;
      } else if (slo.id === 'SLO-4') {
        selected = wsLatencies.filter((event) => event.at >= now - WINDOW_MS);
        bad = selected.filter((event) => event.ms > 2000).length;
      } else if (slo.id === 'SLO-5') {
        selected = health;
        bad = selected.filter((entry) => entry.status !== 'up').length;
      } else if (slo.id === 'SLO-6') {
        const orders = (db.orders || []).filter((order) => Date.parse(order.createdAt || 0) >= now - WINDOW_MS);
        const matured = orders.filter((order) => {
          const created = Date.parse(order.createdAt || 0);
          const dispatched = ['dispatched', 'delivered', 'DISPATCHED', 'DELIVERED'].includes(order.status);
          return dispatched || now - created >= 24 * 60 * 60 * 1000;
        });
        selected = matured;
        bad = matured.filter((order) => !['dispatched', 'delivered', 'DISPATCHED', 'DELIVERED'].includes(order.status)).length;
      }
      const total = selected.length;
      const observed = total ? (total - bad) / total : 1;
      const allowedBad = slo.zeroTolerance ? 0 : (1 - slo.target) * total;
      const remaining = slo.zeroTolerance ? (bad ? 0 : 1) : allowedBad > 0 ? Math.max(0, Math.min(1, 1 - bad / allowedBad)) : 1;
      const lastHour = inWindow.filter((event) => event.at >= now - 60 * 60 * 1000 && ((slo.id === 'SLO-1' && ['/api/products', '/api/health', '/health'].includes(event.path)) || (slo.id === 'SLO-2' && ['/api/orders/checkout', '/api/checkout'].includes(event.path))));
      const recentBad = lastHour.filter((event) => (slo.id === 'SLO-1' ? event.ms >= 150 || event.status >= 500 : event.status >= 500)).length;
      const burnRate = slo.zeroTolerance ? (bad ? 'infinite' : 0) : lastHour.length ? Math.round((recentBad / lastHour.length / (1 - slo.target)) * 100) / 100 : 0;
      return { ...slo, observed: Math.round(observed * 10000) / 10000, totalEvents: total, badEvents: bad, allowedBad: Math.round(allowedBad * 10000) / 10000, budgetRemaining: remaining, burnRate, budgetState: remaining < 0.2 || burnRate === 'infinite' || burnRate > 14 ? 'danger' : remaining < 0.5 ? 'warning' : 'normal' };
    });
  }

  function fireAlert(rule, severity, value, threshold, message) {
    const db = getDb();
    const existing = db.sre.alerts.find((alert) => alert.rule === rule && alert.status !== 'resolved');
    if (existing) {
      existing.lastSeenAt = new Date().toISOString();
      existing.value = value;
      return existing;
    }
    const alert = { id: 'ALT-' + randomUUID(), rule, severity, value, threshold, message, status: 'firing', firedAt: new Date().toISOString(), ackBy: null, ackAt: null, resolvedAt: null };
    db.sre.alerts.unshift(alert);
    db.sre.alerts = db.sre.alerts.slice(0, 500);
    log(severity === 'critical' ? 'CRITICAL' : 'WARN', 'Alert fired: ' + rule, { alertId: alert.id, value, threshold });
    deps.broadcast?.({ type: 'ALERT_FIRED', level: severity.toUpperCase(), message, alert });
    if (severity === 'critical') {
      const incidentSeverity = ['stock_mismatch', 'circuit_open'].includes(rule) ? 'SEV1' : 'SEV2';
      const incident = {
        id: 'INC-' + randomUUID(),
        code: 'INC-' + Date.now(),
        title: message,
        severity: incidentSeverity,
        status: 'draft',
        ownerId: null,
        summary: 'Automatically opened from alert ' + rule + '.',
        alertId: alert.id,
        timeline: [{ at: new Date().toISOString(), actorId: null, note: 'Incident automatically drafted from a critical alert.' }],
        createdAt: new Date().toISOString(),
        resolvedAt: null
      };
      db.sre.incidents.unshift(incident);
      log('CRITICAL', 'Incident draft created from critical alert', { incidentId: incident.id, severity: incidentSeverity, rule });
      deps.broadcast?.({ type: 'INCIDENT_OPENED', level: 'CRITICAL', incident });
    }
    Promise.resolve(deps.persist?.()).catch((error) => log('ERROR', 'Alert persistence failed', { error: error.message }));
    return alert;
  }

  function evaluateRule(rule, condition, severity, value, threshold, message, immediate = false) {
    const now = Date.now();
    if (condition) {
      ruleClearAt.delete(rule);
      if (!ruleStartedAt.has(rule)) ruleStartedAt.set(rule, now);
      if (immediate || now - ruleStartedAt.get(rule) >= 60_000) fireAlert(rule, severity, value, threshold, message);
    } else {
      ruleStartedAt.delete(rule);
      if (!ruleClearAt.has(rule)) ruleClearAt.set(rule, now);
      if (now - ruleClearAt.get(rule) >= 60_000) {
        const alert = getDb().sre.alerts.find((entry) => entry.rule === rule && entry.status !== 'resolved');
        if (alert) {
          alert.status = 'resolved';
          alert.resolvedAt = new Date().toISOString();
          deps.broadcast?.({ type: 'ALERT_RESOLVED', level: 'INFO', alertId: alert.id, rule });
          Promise.resolve(deps.persist?.()).catch((error) => log('ERROR', 'Alert resolution persistence failed', { error: error.message }));
        }
      }
    }
  }

  function evaluateAlerts() {
    const metrics = currentMetrics();
    const db = getDb();
    const samples60 = samples.filter((sample) => Date.parse(sample.at) >= Date.now() - 60_000);
    const avgP95 = samples60.length ? Math.max(...samples60.map((sample) => sample.p95)) : 0;
    const avgDb = samples60.length ? Math.max(...samples60.map((sample) => sample.dbLatencyMs)) : 0;
    const counts = recentClientCounts.filter((entry) => entry.at >= Date.now() - 30_000).map((entry) => entry.count);
    const wsDrop = counts.length > 1 && Math.max(...counts) > 0 && Math.min(...counts) <= Math.max(...counts) * 0.5;
    const negativeStock = (db.products || []).some((product) => Number(product.stock) < 0);
    const budgetLow = sloReport().some((slo) => slo.budgetRemaining < 0.2);
    evaluateRule('latency_p95_high', avgP95 > 150, 'warn', avgP95, 150, 'API p95 latency has exceeded 150ms for 60 seconds.');
    evaluateRule('error_rate_high', metrics.errorRate > 0.01, 'critical', metrics.errorRate, 0.01, 'API 5xx error rate has exceeded 1 percent for 60 seconds.');
    evaluateRule('circuit_open', Boolean(circuitOpenedAt) || activeChaos().mode === 'circuit-open', 'critical', circuitFailures, 25, 'Circuit breaker is OPEN.', true);
    evaluateRule('stock_mismatch', negativeStock, 'critical', negativeStock ? 1 : 0, 0, 'Stock integrity check detected negative stock.', true);
    evaluateRule('db_slow', avgDb > 300, 'warn', avgDb, 300, 'Database p95 latency has exceeded 300ms for 60 seconds.');
    evaluateRule('ws_drop', wsDrop, 'warn', counts, '50% drop', 'WebSocket client count dropped by at least 50 percent within 30 seconds.');
    evaluateRule('memory_high', metrics.heapUsedPct > 85, 'warn', metrics.heapUsedPct, 85, 'Node.js heap usage exceeded 85 percent of its heap limit.');
    evaluateRule('budget_low', budgetLow, 'warn', sloReport().filter((slo) => slo.budgetRemaining < 0.2).map((slo) => slo.id), 0.2, 'At least one SLO error budget has less than 20 percent remaining.');
  }

  function tick() {
    const now = Date.now();
    const metric = currentMetrics();
    samples.push(metric);
    if (samples.length > SAMPLE_LIMIT) samples.splice(0, samples.length - SAMPLE_LIMIT);
    const bucketStart = Math.floor(now / 300_000) * 300_000;
    if (!currentBucket || currentBucket.start !== bucketStart) {
      currentBucket = {
        start: bucketStart, samples: 0, rpsTotal: 0, p50Max: 0, p95Max: 0, p99Max: 0,
        errorRateMax: 0, wsClientsMax: 0, memMbMax: 0, eventLoopLagMsMax: 0,
        dbLatencyMsMax: 0, orderThroughputTotal: 0
      };
      const db = getDb();
      if (!Array.isArray(db.sre.telemetryBuckets)) db.sre.telemetryBuckets = [];
      db.sre.telemetryBuckets.push(currentBucket);
      db.sre.telemetryBuckets = db.sre.telemetryBuckets.slice(-8640);
      Promise.resolve(deps.persist?.()).catch((error) => log('ERROR', 'Telemetry bucket persistence failed', { error: error.message }));
    }
    currentBucket.samples += 1;
    currentBucket.rpsTotal += metric.rps;
    currentBucket.p50Max = Math.max(currentBucket.p50Max, metric.p50);
    currentBucket.p95Max = Math.max(currentBucket.p95Max, metric.p95);
    currentBucket.p99Max = Math.max(currentBucket.p99Max, metric.p99);
    currentBucket.errorRateMax = Math.max(currentBucket.errorRateMax, metric.errorRate);
    currentBucket.wsClientsMax = Math.max(currentBucket.wsClientsMax, metric.wsClients);
    currentBucket.memMbMax = Math.max(currentBucket.memMbMax, metric.memMb);
    currentBucket.eventLoopLagMsMax = Math.max(currentBucket.eventLoopLagMsMax, metric.eventLoopLagMs);
    currentBucket.dbLatencyMsMax = Math.max(currentBucket.dbLatencyMsMax, metric.dbLatencyMs);
    currentBucket.orderThroughputTotal += metric.orderThroughput;
    recentClientCounts.push({ at: now, count: metric.wsClients });
    recentClientCounts = recentClientCounts.filter((entry) => entry.at >= now - 30_000);
    lastTickAt = now;
    deps.broadcast?.({ type: 'TELEMETRY_TICK', level: 'INFO', message: 'SRE telemetry sample recorded.', timestamp: metric.at, metrics: metric });
  }

  async function healthCheck() {
    const checks = [];
    async function run(service, fn) {
      const startedAt = Date.now();
      let error = null;
      try { await fn(); } catch (caught) { error = caught; }
      const latencyMs = Date.now() - startedAt;
      const failures = error ? (healthFailures.get(service) || 0) + 1 : 0;
      healthFailures.set(service, failures);
      const status = error && failures >= 3 ? 'down' : error || latencyMs >= 300 ? 'degraded' : 'up';
      checks.push({ service, status, latencyMs, error: error ? error.message : null, at: new Date().toISOString() });
    }
    await run('API', async () => {
      if (deps.isApiReady && !deps.isApiReady()) throw new Error('HTTP server is not listening');
    });
    await run('Database', async () => {
      const client = deps.getMongoClient?.();
      if (client) {
        const collection = deps.getStateCollection?.();
        if (!collection) throw new Error('MongoDB collection is not ready');
        await collection.db.command({ ping: 1 });
      } else {
        const dbPath = deps.getDbPath?.();
        if (!dbPath) throw new Error('Local storage path is not configured');
        await fs.access(path.dirname(dbPath));
      }
    });
    await run('WebSocket', async () => {
      if (deps.isWebSocketReady && !deps.isWebSocketReady()) throw new Error('WebSocket server is not ready');
    });
    await run('Stock ledger', async () => {
      const db = getDb();
      if ((db.products || []).some((product) => Number(product.stock) < 0)) throw new Error('Negative stock detected');
      if (!Array.isArray(db.movements)) throw new Error('Immutable stock movement ledger is not configured in the current repository');
    });
    await run('Payment gateway', async () => {
      throw new Error('External payment gateway is not configured; current checkout adapter is simulated');
    });

    const db = getDb();
    db.sre.healthChecks.push(...checks);
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    db.sre.healthChecks = db.sre.healthChecks.filter((entry) => Date.parse(entry.at) >= cutoff).slice(-50_000);
    await deps.persist?.().catch((error) => log('ERROR', 'Health check persistence failed', { error: error.message }));
    for (const entry of checks.filter((item) => item.status === 'down')) log('CRITICAL', 'Service health check is DOWN', { service: entry.service, error: entry.error });
    return checks;
  }

  function healthSummary() {
    const latest = new Map();
    for (const check of getDb().sre.healthChecks) {
      const prior = latest.get(check.service);
      if (!prior || Date.parse(check.at) > Date.parse(prior.at)) latest.set(check.service, check);
    }
    const services = ['API', 'Database', 'WebSocket', 'Stock ledger', 'Payment gateway'].map((service) => latest.get(service) || { service, status: 'unknown', latencyMs: null, error: 'Awaiting first health check', at: null });
    const degraded = services.some((service) => ['degraded', 'unknown', 'down'].includes(service.status));
    return { status: degraded ? 'degraded' : 'ok', services, checkedAt: services.map((entry) => entry.at).filter(Boolean).sort().at(-1) || null };
  }

  function dashboard() {
    return {
      slos: sloReport(),
      metrics: currentMetrics(),
      samples: samples.slice(-120),
      services: healthSummary(),
      alerts: getDb().sre.alerts.slice(0, 100),
      incidents: getDb().sre.incidents.filter((incident) => incident.status !== 'resolved').slice(0, 100),
      chaos: activeChaos(),
      runbooks: RUNBOOKS
    };
  }

  function middleware() {
    return (req, res, next) => {
      const requestId = String(req.get('x-request-id') || randomUUID()).slice(0, 128);
      req.requestId = requestId;
      res.setHeader('x-request-id', requestId);
      const start = process.hrtime.bigint();
      res.on('finish', () => {
        const ms = Number(process.hrtime.bigint() - start) / 1e6;
        const route = req.route?.path ? (req.baseUrl || '') + req.route.path : req.path;
        recordRequest({ path: route, method: req.method, status: res.statusCode, ms });
        log(res.statusCode >= 500 ? 'ERROR' : res.statusCode >= 400 ? 'WARN' : 'INFO', 'HTTP request completed', {
          route, status: res.statusCode, ms: Math.round(ms * 100) / 100, userId: req.user?.id || null, reqId: requestId
        });
      });
      next();
    };
  }

  function rateLimit({ limit, windowMs, name }) {
    return (req, res, next) => {
      const key = name + ':' + (req.ip || req.socket.remoteAddress || 'unknown');
      const now = Date.now();
      let bucket = rateBuckets.get(key);
      if (!bucket || now - bucket.start >= windowMs) bucket = { start: now, count: 0 };
      bucket.count += 1;
      rateBuckets.set(key, bucket);
      if (rateBuckets.size > 5000) for (const [k, value] of rateBuckets) if (now - value.start > windowMs) rateBuckets.delete(k);
      if (bucket.count > limit) return res.status(429).json({ error: 'Rate limit exceeded. Try again later.' });
      next();
    };
  }

  async function chaosMiddleware(req, res, next) {
    if (!isChaosTarget(req.path)) return next();
    const chaos = activeChaos();
    if (['circuit-open', 'circuit'].includes(chaos.mode)) return res.status(503).json({ error: 'Checkout is temporarily paused while the circuit breaker recovers.', code: 'CIRCUIT_OPEN', retryAfterSeconds: 60 });
    if (chaos.mode === 'latency') await new Promise((resolve) => setTimeout(resolve, 500));
    if (chaos.mode === 'db_slow') await new Promise((resolve) => setTimeout(resolve, 400));
    if (chaos.mode === 'errors' && Math.random() < 0.05) return res.status(500).json({ error: 'Controlled chaos experiment injected a server error.', code: 'CHAOS_INJECTED' });
    next();
  }

  function attachWebSocket(websocket) {
    websocket.on('pong', (data) => {
      const sentAt = Number(data?.toString());
      if (Number.isFinite(sentAt)) {
        const timeout = pendingPings.get(websocket);
        if (timeout) clearTimeout(timeout);
        pendingPings.delete(websocket);
        recordWebSocketLatency(Date.now() - sentAt);
      }
    });
    websocket.on('close', () => {
      const timeout = pendingPings.get(websocket);
      if (timeout) clearTimeout(timeout);
      pendingPings.delete(websocket);
    });
  }

  function pingWebSockets(websocketServer) {
    if (!websocketServer) return;
    for (const client of websocketServer.clients) {
      if (client.readyState !== 1) continue;
      const sentAt = Date.now();
      const prior = pendingPings.get(client);
      if (prior) clearTimeout(prior);
      client.ping(String(sentAt));
      const timeout = setTimeout(() => {
        if (!pendingPings.has(client)) return;
        pendingPings.delete(client);
        recordWebSocketLatency(2001);
      }, 2000);
      timeout.unref();
      pendingPings.set(client, timeout);
    }
  }

  const router = express.Router();
  router.get('/', (_req, res) => res.json(dashboard()));
  router.get('/health', (_req, res) => res.json(healthSummary()));
  router.get('/metrics', (_req, res) => res.json({ metrics: currentMetrics(), samples: samples.slice(-120), slos: sloReport() }));
  router.get('/alerts', (_req, res) => res.json(getDb().sre.alerts));
  router.patch('/alerts/:id/ack', (req, res) => {
    const alert = getDb().sre.alerts.find((entry) => entry.id === req.params.id);
    if (!alert) return res.status(404).json({ error: 'Alert not found' });
    alert.status = 'acknowledged';
    alert.ackBy = req.user.id;
    alert.ackAt = new Date().toISOString();
    audit('alert.acknowledge', req.user, { alertId: alert.id, rule: alert.rule });
    res.json({ alert });
  });
  router.patch('/alerts/:id/resolve', (req, res) => {
    const alert = getDb().sre.alerts.find((entry) => entry.id === req.params.id);
    if (!alert) return res.status(404).json({ error: 'Alert not found' });
    alert.status = 'resolved';
    alert.resolvedAt = new Date().toISOString();
    audit('alert.resolve', req.user, { alertId: alert.id, rule: alert.rule });
    res.json({ alert });
  });
  router.get('/incidents', (_req, res) => res.json(getDb().sre.incidents));
  const incidentSchema = z.object({
    title: z.string().trim().min(3).max(160),
    severity: z.enum(['SEV1', 'SEV2', 'SEV3']),
    status: z.enum(['draft', 'open', 'investigating', 'mitigated', 'resolved']).default('open'),
    summary: z.string().trim().max(5000).default('')
  });
  router.post('/incidents', (req, res) => {
    const parsed = incidentSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid incident', details: parsed.error.issues });
    const incident = {
      id: 'INC-' + randomUUID(), code: 'INC-' + Date.now(), ...parsed.data, ownerId: req.user.id,
      timeline: [{ at: new Date().toISOString(), actorId: req.user.id, note: 'Incident created.' }],
      createdAt: new Date().toISOString(), resolvedAt: parsed.data.status === 'resolved' ? new Date().toISOString() : null
    };
    getDb().sre.incidents.unshift(incident);
    audit('incident.create', req.user, { incidentId: incident.id, severity: incident.severity });
    res.status(201).json({ incident });
  });
  router.patch('/incidents/:id', (req, res) => {
    const incident = getDb().sre.incidents.find((entry) => entry.id === req.params.id);
    if (!incident) return res.status(404).json({ error: 'Incident not found' });
    const parsed = incidentSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid incident update', details: parsed.error.issues });
    Object.assign(incident, parsed.data);
    if (parsed.data.status === 'resolved') incident.resolvedAt = new Date().toISOString();
    incident.timeline.push({ at: new Date().toISOString(), actorId: req.user.id, note: 'Incident updated.' });
    audit('incident.update', req.user, { incidentId: incident.id, changes: Object.keys(parsed.data) });
    res.json({ incident });
  });
  router.post('/incidents/:id/notes', (req, res) => {
    const incident = getDb().sre.incidents.find((entry) => entry.id === req.params.id);
    if (!incident) return res.status(404).json({ error: 'Incident not found' });
    const parsed = z.object({ note: z.string().trim().min(1).max(2000) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'A note is required.' });
    incident.timeline.push({ at: new Date().toISOString(), actorId: req.user.id, note: parsed.data.note });
    audit('incident.note', req.user, { incidentId: incident.id });
    res.status(201).json({ incident });
  });
  router.delete('/incidents/:id', (req, res) => {
    const db = getDb();
    const index = db.sre.incidents.findIndex((entry) => entry.id === req.params.id);
    if (index < 0) return res.status(404).json({ error: 'Incident not found' });
    db.sre.incidents.splice(index, 1);
    audit('incident.delete', req.user, { incidentId: req.params.id });
    res.json({ success: true });
  });
  router.get('/runbooks', (req, res) => {
    const progress = getDb().sre.runbookProgress[req.user.id] || {};
    res.json(RUNBOOKS.map((book) => ({ ...book, checkedSteps: progress[book.id] || [] })));
  });
  router.put('/runbooks/:id/progress', (req, res) => {
    const book = RUNBOOKS.find((entry) => entry.id === req.params.id);
    if (!book) return res.status(404).json({ error: 'Runbook not found' });
    const parsed = z.object({ checkedSteps: z.array(z.number().int().min(0).max(book.steps.length - 1)) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid runbook progress' });
    const db = getDb();
    if (!db.sre.runbookProgress[req.user.id]) db.sre.runbookProgress[req.user.id] = {};
    db.sre.runbookProgress[req.user.id][book.id] = [...new Set(parsed.data.checkedSteps)];
    audit('runbook.progress', req.user, { runbookId: book.id, checkedSteps: parsed.data.checkedSteps });
    res.json({ runbookId: book.id, checkedSteps: db.sre.runbookProgress[req.user.id][book.id] });
  });
  router.get('/chaos', (_req, res) => res.json({ ...activeChaos(), breaker: { state: circuitOpenedAt ? 'OPEN' : 'CLOSED', failures: circuitFailures } }));
  router.post('/chaos', (req, res) => {
    const parsed = z.object({ mode: z.enum(['latency', 'errors', 'db_slow', 'circuit', 'reset']) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid chaos mode', allowed: ['latency', 'errors', 'db_slow', 'circuit', 'reset'] });
    const mode = parsed.data.mode;
    const db = getDb();
    if (mode === 'reset') {
      db.sre.chaos = { mode: 'reset', expiresAt: null, activatedAt: new Date().toISOString() };
      circuitFailures = 0;
      circuitOpenedAt = null;
    } else {
      db.sre.chaos = { mode, expiresAt: new Date(Date.now() + 60_000).toISOString(), activatedAt: new Date().toISOString() };
      if (mode === 'circuit') openCircuit('manual chaos control');
    }
    audit('chaos.execute', req.user, { mode, expiresAt: db.sre.chaos.expiresAt });
    deps.broadcast?.({ type: 'CHAOS_UPDATED', level: mode === 'reset' ? 'INFO' : 'WARN', message: 'Chaos mode ' + mode + ' is active.', chaos: db.sre.chaos });
    res.json({ success: true, chaos: db.sre.chaos, breaker: { state: circuitOpenedAt ? 'OPEN' : 'CLOSED', failures: circuitFailures } });
  });

  function exportSnapshot() {
    return { exportedAt: new Date().toISOString(), format: 'velosupply-backup-v1', data: getDb() };
  }

  async function backup() {
    const db = getDb();
    const backupsDir = path.join(__dirname, 'backups');
    await fs.mkdir(backupsDir, { recursive: true, mode: 0o700 });
    const today = new Date().toISOString().slice(0, 10);
    const target = path.join(backupsDir, today + '.json');
    const temporary = target + '.' + process.pid + '.tmp';
    await fs.writeFile(temporary, JSON.stringify(exportSnapshot(), null, 2) + '\n', { mode: 0o600 });
    await fs.rename(temporary, target);
    const entries = (await fs.readdir(backupsDir)).filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name)).sort().reverse();
    for (const old of entries.slice(7)) await fs.rm(path.join(backupsDir, old), { force: true });
    db.sre.backupHistory.unshift({ date: today, path: target, at: new Date().toISOString() });
    db.sre.backupHistory = db.sre.backupHistory.slice(0, 30);
    return { path: target, date: today };
  }

  async function scheduledBackup() {
    const isAtlas = Boolean(deps.getMongoClient?.());
    const enabled = process.env.BACKUP_EXPORT === 'true';
    const now = new Date();
    const db = getDb();
    const last = db.sre.backupHistory[0]?.date;
    const today = now.toISOString().slice(0, 10);
    if (!isAtlas && last !== today) {
      await backup();
      await deps.persist?.();
    } else if (isAtlas && enabled && now.getUTCDay() === 0 && last !== today) {
      await backup();
      await deps.persist?.();
    }
  }

  function start() {
    if (started) return;
    started = true;
    timers.push(setInterval(tick, 1000));
    timers.push(setInterval(evaluateAlerts, 5000));
    timers.push(setInterval(() => healthCheck().catch((error) => log('ERROR', 'Health check job failed', { error: error.message })), 10_000));
    timers.push(setInterval(() => pingWebSockets(deps.getWebSocketServer?.()), 30_000));
    timers.push(setInterval(() => scheduledBackup().catch((error) => log('ERROR', 'Scheduled backup failed', { error: error.message })), 60 * 60 * 1000));
    for (const timer of timers) timer.unref();
    tick();
    healthCheck().catch((error) => log('ERROR', 'Initial health check failed', { error: error.message }));
    scheduledBackup().catch((error) => log('ERROR', 'Initial backup failed', { error: error.message }));
  }

  function stop() {
    for (const timer of timers) clearInterval(timer);
    timers = [];
    started = false;
  }

  return { router, middleware, rateLimit, chaosMiddleware, start, stop, recordDbLatency, recordWebSocketLatency, attachWebSocket, pingWebSockets, currentMetrics, sloReport, healthCheck, healthSummary, dashboard, exportSnapshot, backup, RUNBOOKS, SLOS };
}

module.exports = { createSRE, SLOS, RUNBOOKS, percentile };
