import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const backendDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('startup secret logging', () => {
  it('does not print the generated development JWT secret', () => {
    const childScript = [
      "delete process.env.JWT_SECRET;",
      "const captured = [];",
      "process.stdout.write = (chunk) => { captured.push(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)); return true; };",
      "require('./server.js');",
      "const output = captured.join('');",
      "const secret = process.env.JWT_SECRET;",
      "if (!secret || output.includes(secret)) process.exit(21);",
      "const records = output.trim().split(/\\r?\\n/).filter(Boolean).map((line) => JSON.parse(line));",
      "if (records.length !== 1 || records[0].level !== 'WARN' || records[0].msg !== 'A development default was generated; secret values are omitted.' || Object.prototype.hasOwnProperty.call(records[0], 'defaults')) process.exit(22);",
      "process.stderr.write('startup-secret-log-check:passed\\n');"
    ].join('\n');

    const result = spawnSync(process.execPath, ['-e', childScript], {
      cwd: backendDirectory,
      encoding: 'utf8',
      timeout: 10_000,
      env: {
        ...process.env,
        NODE_ENV: 'development',
        CORS_ORIGIN: 'http://localhost:5173'
      }
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr.trim()).toBe('startup-secret-log-check:passed');
    expect(result.stderr).not.toMatch(/[A-Za-z0-9_-]{43}/);
  });
});
