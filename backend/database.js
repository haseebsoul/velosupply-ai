const fs = require('node:fs/promises');
const { MongoClient } = require('mongodb');
const { DB_PATH, createSeedData, hasCurrentSchema } = require('./seed');

let client;
let stateCollection;

async function connectState() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI is required. Copy backend/.env.example to backend/.env and configure Atlas.');
  }

  client = new MongoClient(uri, {
    maxPoolSize: 10,
    minPoolSize: 0,
    serverSelectionTimeoutMS: 10000
  });
  await client.connect();

  const databaseName = process.env.MONGODB_DB_NAME || 'velosupply';
  stateCollection = client.db(databaseName).collection('application_state');

  const stored = await stateCollection.findOne({ _id: 'primary' });
  if (stored?.state && typeof stored.state === 'object') {
    return stored.state;
  }

  let initialState;
  try {
    const legacy = JSON.parse(await fs.readFile(DB_PATH, 'utf8'));
    if (hasCurrentSchema(legacy)) initialState = legacy;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  if (!initialState) {
    if (process.env.NODE_ENV === 'production') {
      const name = process.env.BOOTSTRAP_ADMIN_NAME?.trim();
      const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
      const password = process.env.BOOTSTRAP_ADMIN_PASSWORD || '';

      if (!name || name.length < 2 || !email || !email.includes('@') || password.length < 16) {
        throw new Error(
          'For a new production database, set BOOTSTRAP_ADMIN_NAME, BOOTSTRAP_ADMIN_EMAIL, and BOOTSTRAP_ADMIN_PASSWORD (16+ characters) before starting the API.'
        );
      }

      initialState = await createSeedData({
        production: true,
        bootstrapAdmin: { name, email, password }
      });
    } else {
      initialState = await createSeedData();
    }
  }

  await stateCollection.insertOne({
    _id: 'primary',
    state: initialState,
    updatedAt: new Date()
  });

  return initialState;
}

async function persistState(state) {
  if (!stateCollection) throw new Error('MongoDB state collection is not connected');
  await stateCollection.replaceOne(
    { _id: 'primary' },
    { _id: 'primary', state, updatedAt: new Date() },
    { upsert: true }
  );
}

async function closeState() {
  if (client) {
    await client.close();
    client = undefined;
    stateCollection = undefined;
  }
}

module.exports = { connectState, persistState, closeState };
