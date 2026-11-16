import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const keys = ['NODE_ENV', 'JWT_SECRET', 'CORS_ORIGIN', 'MONGODB_URI'];
const previous = new Map(keys.map((key) => [key, process.env[key]]));
afterEach(() => {
  for (const key of keys) {
    if (previous.get(key) === undefined) delete process.env[key];
    else process.env[key] = previous.get(key);
  }
});

describe('production storage configuration', () => {
  it('fails closed when production starts without MONGODB_URI', async () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'test-only-access-secret';
    process.env.CORS_ORIGIN = 'https://example.invalid';
    // Preserve an explicitly empty value so server.js's local .env loader
    // cannot restore a developer's real MongoDB URI during this safety test.
    process.env.MONGODB_URI = '';
    const serverModule = require('../server.js');
    await expect(serverModule.loadDatabaseState()).rejects.toThrow('MONGODB_URI must be set in production');
  });
});
