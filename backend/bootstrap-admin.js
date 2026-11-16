'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const readline = require('node:readline/promises');
const { stdin, stdout } = require('node:process');
const { randomUUID } = require('node:crypto');
const bcrypt = require('bcryptjs');
const { MongoClient } = require('mongodb');
const { createRepository } = require('./repository');
const { createEmptyProductionState } = require('./production-state');

const envPath = path.join(__dirname, '.env');

async function loadLocalEnvironment() {
  let source;
  try {
    source = await fs.readFile(envPath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('backend/.env is missing. Copy backend/.env.example and configure Atlas first.');
    throw error;
  }
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    if (Object.prototype.hasOwnProperty.call(process.env, key)) continue;
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function askHidden(prompt) {
  if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
    return Promise.reject(new Error('Run this command in an interactive PowerShell or terminal so the password can be entered without echo.'));
  }
  return new Promise((resolve, reject) => {
    stdout.write(prompt);
    let value = '';
    const wasRaw = stdin.isRaw;
    const finish = (error) => {
      stdin.removeListener('data', onData);
      stdin.setRawMode(Boolean(wasRaw));
      stdin.pause();
      stdout.write('\n');
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk) => {
      for (const char of String(chunk)) {
        if (char === '\u0003') return finish(new Error('Setup cancelled.'));
        if (char === '\r' || char === '\n') return finish();
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
        else if (char >= ' ' && char !== '\u007f') value += char;
      }
    };
    stdin.setRawMode(true);
    stdin.setEncoding('utf8');
    stdin.resume();
    stdin.on('data', onData);
  });
}

async function retireLocalSecret(secretName) {
  const source = await fs.readFile(envPath, 'utf8');
  const matcher = new RegExp('^\\s*' + secretName + '\\s*=.*

async function main() {
  await loadLocalEnvironment();
  const mode = process.argv.includes('--recover') ? 'recover' : 'bootstrap';
  const secretName = mode === 'recover' ? 'ADMIN_RECOVERY_KEY' : 'ADMIN_BOOTSTRAP_KEY';
  const ownerSecret = String(process.env[secretName] || '').trim();
  const uri = String(process.env.MONGODB_URI || '').trim();
  if (!uri) throw new Error('MONGODB_URI is not configured in backend/.env.');
  if (ownerSecret.length < 32) {
    throw new Error('Set a new, randomly generated ' + secretName + ' of at least 32 characters in backend/.env before running this owner-only command.');
  }
  const databaseName = process.env.MONGODB_DB_NAME || 'velosupply';
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000, maxPoolSize: 5 });
  let rl;
  try {
    await client.connect();
    const database = client.db(databaseName);
    await database.command({ ping: 1 });
    const repository = createRepository({
      client,
      database,
      legacyCollectionName: process.env.MONGODB_STATE_COLLECTION || 'application_state'
    });
    await repository.initialize({ fallbackState: createEmptyProductionState() });

    const activeAdmins = await repository.find('users', {
      role: 'admin', isActive: true, deletedAt: null
    }, { limit: 100 });

    rl = readline.createInterface({ input: stdin, output: stdout });
    stdout.write(mode === 'recover'
      ? 'VeloSupply AI · Existing Administrator password recovery\n'
      : 'VeloSupply AI · First Administrator setup\n');
    stdout.write('Connected to the configured MongoDB database. No secret values will be displayed.\n\n');

    if (mode === 'bootstrap' && activeAdmins.length) {
      throw new Error('An active Administrator already exists. Use npm run admin:recover to restore that account; this command will not create a duplicate.');
    }

    let name = '';
    let email = '';
    let targetId = '';
    if (mode === 'bootstrap') {
      name = (await rl.question('Administrator full name: ')).trim();
      email = (await rl.question('Administrator email: ')).trim().toLowerCase();
      if (name.length < 2 || name.length > 100) throw new Error('Name must be between 2 and 100 characters.');
      if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email) || email.length > 254) throw new Error('Enter a valid email address.');
    } else {
      email = (await rl.question('Email of the existing active Administrator: ')).trim().toLowerCase();
      if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email) || email.length > 254) throw new Error('Enter a valid email address.');
      const matches = activeAdmins.filter((admin) => String(admin.email || '').toLowerCase() === email);
      if (matches.length !== 1) throw new Error('That email does not identify exactly one active Administrator. No account was changed.');
      targetId = matches[0].id;
    }

    rl.close();
    rl = null;
    const password = await askHidden('New password (hidden): ');
    const confirmation = await askHidden('Confirm new password (hidden): ');
    validatePassword(password, confirmation);

    const passwordHash = await bcrypt.hash(password, 12);
    const now = new Date().toISOString();
    if (mode === 'recover') {
      await repository.withTransaction(async ({ repository: tx }) => {
        const admins = await tx.find('users', {
          role: 'admin', isActive: true, deletedAt: null
        });
        const target = admins.find((admin) =>
          admin.id === targetId && String(admin.email || '').toLowerCase() === email
        );
        if (!target) throw new Error('The target Administrator changed during recovery. No account was changed.');
        await tx.update('users', target.id, { passwordHash, updatedAt: now });
        await tx.insert('auditLogs', {
          id: 'AUD-' + randomUUID(), actorId: target.id, actorRole: 'admin',
          action: 'user.admin_password_recovery', targetType: 'user', targetId: target.id,
          meta: { source: 'owner_cli_recovery' }, at: now
        });
      });
    } else {
      const duplicate = await repository.find('users', { email }, { limit: 1 });
      if (duplicate.length) throw new Error('That email address is already registered.');
      const userId = 'USER-' + randomUUID();
      await repository.withTransaction(async ({ repository: tx }) => {
        const admins = await tx.find('users', {
          role: 'admin', isActive: true, deletedAt: null
        }, { limit: 1 });
        if (admins.length) throw new Error('An Administrator was created while setup was in progress. No account was changed.');
        const emailRows = await tx.find('users', { email }, { limit: 1 });
        if (emailRows.length) throw new Error('That email address was registered while setup was in progress.');
        await tx.insert('users', {
          id: userId, name, email, role: 'admin', passwordHash,
          isActive: true, deletedAt: null, createdAt: now, updatedAt: now
        });
        const bootstrapInvitations = await tx.find('invitations', { createdBy: 'system:bootstrap', status: 'active' });
        for (const invitation of bootstrapInvitations) {
          await tx.update('invitations', invitation.id, {
            status: 'revoked', revokedAt: now, updatedAt: now
          });
        }
        await tx.insert('auditLogs', {
          id: 'AUD-' + randomUUID(), actorId: userId, actorRole: 'admin',
          action: 'user.bootstrap_create', targetType: 'user', targetId: userId,
          meta: { source: 'owner_cli_bootstrap', bootstrapInvitationsRevoked: bootstrapInvitations.length },
          at: now
        });
      });
    }

    try {
      await retireLocalSecret(secretName);
      stdout.write(mode === 'recover'
        ? '\nThe existing Administrator password was reset. The one-time recovery secret has been cleared from backend/.env.\n'
        : '\nThe first Administrator account was created in MongoDB. The one-time bootstrap secret has been cleared from backend/.env.\n');
    } catch (_error) {
      stdout.write('\nThe database change succeeded, but backend/.env could not be rewritten. Remove ' + secretName + ' from that file before restarting.\n');
    }
    stdout.write('Next: run npm run dev from the repository root and sign in at http://localhost:5173/login.\n');
  } finally {
    if (rl) rl.close();
    await client.close().catch(() => {});
  }
}
main().catch((error) => {
  stdout.write('\nAdministrator setup failed: ' + String(error.message || 'Unknown error') + '\n');
  process.exitCode = 1;
});
, 'm');
  const updated = source.replace(matcher, secretName + '=');
  if (updated !== source) {
    const temporary = envPath + '.' + process.pid + '.tmp';
    await fs.writeFile(temporary, updated, { encoding: 'utf8', mode: 0o600 });
    await fs.rename(temporary, envPath);
  }
  process.env[secretName] = '';
}

function validatePassword(password, confirmation) {
  if (password !== confirmation) throw new Error('The passwords do not match.');
  if (password.length < 8 || password.length > 128 || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
    throw new Error('Password must be 8–128 characters and include at least one uppercase letter and one number.');
  }
}

async function main() {
  await loadLocalEnvironment();
  const uri = String(process.env.MONGODB_URI || '').trim();
  const bootstrapKey = String(process.env.ADMIN_BOOTSTRAP_KEY || '').trim();
  if (!uri) throw new Error('MONGODB_URI is not configured in backend/.env.');
  if (bootstrapKey.length < 32) throw new Error('Set a new, randomly generated ADMIN_BOOTSTRAP_KEY of at least 32 characters in backend/.env before running this one-time setup.');
  const databaseName = process.env.MONGODB_DB_NAME || 'velosupply';
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000, maxPoolSize: 5 });
  let rl;
  try {
    await client.connect();
    const database = client.db(databaseName);
    await database.command({ ping: 1 });
    const repository = createRepository({
      client,
      database,
      legacyCollectionName: process.env.MONGODB_STATE_COLLECTION || 'application_state'
    });
    await repository.initialize({ fallbackState: createEmptyProductionState() });

    const existingAdmins = await repository.find('users', { role: 'admin', isActive: true }, { limit: 1 });
    if (existingAdmins.length) {
      throw new Error('An active Administrator already exists. Sign in with that account; this setup command will not replace or reset it.');
    }

    rl = readline.createInterface({ input: stdin, output: stdout });
    stdout.write('VeloSupply AI · First Administrator setup\n');
    stdout.write('Connected to the configured MongoDB database. No secret values will be displayed.\n\n');
    const name = (await rl.question('Administrator full name: ')).trim();
    const email = (await rl.question('Administrator email: ')).trim().toLowerCase();
    rl.close();
    rl = null;
    if (name.length < 2 || name.length > 100) throw new Error('Name must be between 2 and 100 characters.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new Error('Enter a valid email address.');
    const password = await askHidden('Password (hidden): ');
    const confirmation = await askHidden('Confirm password (hidden): ');
    if (password !== confirmation) throw new Error('The passwords do not match.');
    if (password.length < 8 || password.length > 128 || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
      throw new Error('Password must be 8–128 characters and include at least one uppercase letter and one number.');
    }

    const duplicate = await repository.find('users', { email }, { limit: 1 });
    if (duplicate.length) throw new Error('That email address is already registered.');
    const now = new Date().toISOString();
    const userId = 'USER-' + randomUUID();
    const passwordHash = await bcrypt.hash(password, 12);
    await repository.withTransaction(async ({ repository: tx }) => {
      const admins = await tx.find('users', { role: 'admin', isActive: true }, { limit: 1 });
      if (admins.length) throw new Error('An Administrator was created while setup was in progress. No account was changed.');
      const emailRows = await tx.find('users', { email }, { limit: 1 });
      if (emailRows.length) throw new Error('That email address was registered while setup was in progress.');
      await tx.insert('users', {
        id: userId, name, email, role: 'admin', passwordHash,
        isActive: true, deletedAt: null, createdAt: now, updatedAt: now
      });
      const bootstrapInvitations = await tx.find('invitations', { createdBy: 'system:bootstrap', status: 'active' });
      for (const invitation of bootstrapInvitations) {
        await tx.update('invitations', invitation.id, {
          status: 'revoked', revokedAt: now, updatedAt: now
        });
      }
      await tx.insert('auditLogs', {
        id: 'AUD-' + randomUUID(), actorId: userId, actorRole: 'admin',
        action: 'user.bootstrap_create', targetType: 'user', targetId: userId,
        meta: { source: 'owner_cli_bootstrap', bootstrapInvitationsRevoked: bootstrapInvitations.length },
        at: now
      });
    });

    try {
      await retireBootstrapSecret();
      stdout.write('\nAdministrator account created in MongoDB. The one-time bootstrap secret has been cleared from backend/.env.\n');
    } catch (_error) {
      stdout.write('\nAdministrator account created in MongoDB, but backend/.env could not be rewritten. Remove ADMIN_BOOTSTRAP_KEY from that file manually before restarting.\n');
    }
    stdout.write('Next: run npm run dev from the repository root and sign in at http://localhost:5173/login.\n');
  } finally {
    if (rl) rl.close();
    await client.close().catch(() => {});
  }
}

main().catch((error) => {
  stdout.write('\nAdministrator setup failed: ' + String(error.message || 'Unknown error') + '\n');
  process.exitCode = 1;
});
