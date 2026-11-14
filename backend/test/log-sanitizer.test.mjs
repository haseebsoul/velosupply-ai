import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { createSRE } = require('../sre.js');
const { REDACTED, redactText, sanitizeLogValue } = require('../log-sanitizer.js');

function createSreState() {
  return {
    products: [],
    orders: [],
    movements: [],
    logs: [],
    sre: {
      alerts: [],
      incidents: [],
      healthChecks: [],
      audit: [],
      loginAttempts: [],
      backupHistory: [],
      runbookProgress: {},
      chaos: { mode: 'reset', expiresAt: null, activatedAt: null }
    }
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('structured log sanitization', () => {
  it('redacts sensitive structured keys at every nesting level', () => {
    const input = {
      route: '/api/auth/login',
      status: 401,
      userId: 'USER-123',
      email: 'buyer@example.com',
      password: 'do-not-log-this',
      headers: {
        authorization: 'Bearer a.b.c',
        cookie: 'session=private',
        'x-api-key': 'api-secret',
        nested: [{ cnic: '12345-1234567-1', phone: '03001234567', city: 'Karachi' }]
      }
    };

    const safe = sanitizeLogValue(input);
    expect(safe).toMatchObject({
      route: '/api/auth/login',
      status: 401,
      userId: 'USER-123',
      email: REDACTED,
      password: REDACTED,
      headers: {
        authorization: REDACTED,
        cookie: REDACTED,
        'x-api-key': REDACTED,
        nested: [{ cnic: REDACTED, phone: REDACTED, city: 'Karachi' }]
      }
    });
    expect(JSON.stringify(safe)).not.toContain('do-not-log-this');
    expect(JSON.stringify(safe)).not.toContain('buyer@example.com');
  });

  it('redacts credentials, database URIs, bearer tokens, emails, CNICs and phone numbers in free text', () => {
    const message = [
      'Mongo connection mongodb+srv://user:db-secret@cluster.example.mongodb.net/app',
      'authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature',
      'buyer@example.com',
      '12345-1234567-1',
      '+92 300 1234567',
      'password=hunter2',
      'https://service-user:service-pass@example.test/resource?access_token=oauth-secret&token=query-token-secret'
    ].join(' ');

    const safe = redactText(message);
    for (const secret of [
      'db-secret',
      'eyJhbGciOiJIUzI1NiJ9',
      'buyer@example.com',
      '12345-1234567-1',
      '+92 300 1234567',
      'hunter2',
      'service-user',
      'service-pass',
      'oauth-secret',
      'query-token-secret'
    ]) {
      expect(safe).not.toContain(secret);
    }
    expect(safe).toContain('[REDACTED_MONGODB_URI]');
    expect(safe).toContain('[REDACTED_EMAIL]');
    expect(safe).toContain('[REDACTED_CNIC]');
  });

  it('matches IP keys as complete tokens and preserves descriptive keys with incidental letters', () => {
    const sanitized = sanitizeLogValue({
      description: 'A receipt was inspected during dispatch.',
      clientIp: '192.0.2.44',
      requestIP: '192.0.2.45',
      ipAddress: '192.0.2.46'
    });

    expect(sanitized.description).toBe('A receipt was inspected during dispatch.');
    expect(sanitized.clientIp).toBe(REDACTED);
    expect(sanitized.requestIP).toBe(REDACTED);
    expect(sanitized.ipAddress).toBe(REDACTED);
  });

  it('handles errors, dates, cycles and deep objects without changing the input', () => {
    const error = new Error('failed with password=private-value');
    error.code = 'ECONNRESET';
    const circular = { error, at: new Date('2026-11-14T00:00:00.000Z') };
    circular.self = circular;
    const safe = sanitizeLogValue(circular);

    expect(safe.error.message).toContain('password=[REDACTED]');
    expect(safe.error.code).toBe('ECONNRESET');
    expect(safe.at).toBe('2026-11-14T00:00:00.000Z');
    expect(safe.self).toBe('[CIRCULAR]');
    const shared = { route: '/api/health', description: 'Shared safe context' };
    const repeated = sanitizeLogValue({ first: shared, second: shared });
    expect(repeated.first).toEqual(shared);
    expect(repeated.second).toEqual(shared);
    expect(error.message).toBe('failed with password=private-value');
    expect(sanitizeLogValue({ a: { b: { c: 'value' } } }, { maxDepth: 2 }).a.b).toBe('[MAX_DEPTH]');
  });

  it('redacts a failed Atlas health-check error before both stdout and persisted SRE logs', async () => {
    const state = createSreState();
    const output = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      output.push(String(chunk));
      return true;
    });
    const mongoError = new Error(
      'server selection failed mongodb+srv://staging-user:atlas-secret@cluster.example.mongodb.net/app password=uri-pass buyer@example.com 12345-1234567-1'
    );
    const sre = createSRE({
      getDb: () => state,
      persist: async () => {},
      broadcast: () => {},
      getMongoClient: () => ({}),
      getStateCollection: () => ({ db: { command: async () => { throw mongoError; } } }),
      getDbPath: () => '/tmp/velosupply-log-redaction/db.json',
      getWebSocketClients: () => 0,
      isApiReady: () => true,
      isWebSocketReady: () => true
    });

    try {
      await sre.healthCheck();
      await sre.healthCheck();
      await sre.healthCheck();

      const databaseLog = state.logs.find((entry) =>
        entry.message === 'Service health check is DOWN' && entry.metadata.service === 'Database'
      );
      expect(databaseLog).toBeTruthy();

      const serialized = output.join(' ') + JSON.stringify(databaseLog.metadata);
      for (const secret of ['atlas-secret', 'uri-pass', 'buyer@example.com', '12345-1234567-1']) {
        expect(serialized).not.toContain(secret);
      }
      expect(serialized).toContain('[REDACTED_MONGODB_URI]');
      expect(databaseLog.metadata.error).toContain('[REDACTED_EMAIL]');
    } finally {
      sre.stop();
    }
  });
});
