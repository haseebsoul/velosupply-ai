'use strict';

const { createFileAdapter } = require('./file-adapter');
const { createMongoAdapter } = require('./mongo-adapter');

function createRepository(options = {}) {
  if (options.client && options.database) {
    return createMongoAdapter(options);
  }
  if (options.filePath && typeof options.loadInitial === 'function') {
    return createFileAdapter(options);
  }
  throw new Error('Repository configuration requires either a connected MongoClient/database or filePath/loadInitial.');
}

module.exports = { createRepository, createFileAdapter, createMongoAdapter };
