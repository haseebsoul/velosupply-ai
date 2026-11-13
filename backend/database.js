const fs = require('node:fs/promises');
const { MongoClient } = require('mongodb');
const { DB_PATH, createInitialSeedData, hasCurrentSchema } = require('./seed');

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
    if (hasCurrentSchema(legacy)) {
      initialState = legacy;
      if (process.env.NODE_ENV === 'production') {
        const secureInitialState = await createInitialSeedData();
        initialState.users = secureInitialState.users;
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  if (!initialState) initialState = await createInitialSeedData();

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
