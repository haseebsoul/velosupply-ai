import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { CONFIRMATION, STAGING_DATABASE, loadStagingConfiguration } = require('../scripts/verify-atlas-staging.js');

const atlasUri = 'mongodb+srv://staging_user:placeholder-password@velosupplystaging.example.mongodb.net/?retryWrites=true&w=majority';

describe('Atlas staging verifier configuration', () => {
  it('requires an explicit staging URI before making any connection', () => {
    expect(() => loadStagingConfiguration({
      MONGODB_STAGING_DB_NAME: STAGING_DATABASE,
      ATLAS_STAGING_CONFIRM: CONFIRMATION
    })).toThrow(/MONGODB_STAGING_URI is required/);
  });

  it('rejects a non-Atlas or non-SRV URI', () => {
    expect(() => loadStagingConfiguration({
      MONGODB_STAGING_URI: 'mongodb://localhost:27017',
      MONGODB_STAGING_DB_NAME: STAGING_DATABASE,
      ATLAS_STAGING_CONFIRM: CONFIRMATION
    })).toThrow(/Atlas SRV/);
  });

  it('refuses to target the normal application database', () => {
    expect(() => loadStagingConfiguration({
      MONGODB_STAGING_URI: atlasUri,
      MONGODB_STAGING_DB_NAME: 'velosupply',
      ATLAS_STAGING_CONFIRM: CONFIRMATION
    })).toThrow(/must be exactly "velosupply_staging"/);
  });

  it('requires a deliberate staging-only confirmation', () => {
    expect(() => loadStagingConfiguration({
      MONGODB_STAGING_URI: atlasUri,
      MONGODB_STAGING_DB_NAME: STAGING_DATABASE
    })).toThrow(/must explicitly confirm/);
  });

  it('accepts only the isolated staging database', () => {
    expect(loadStagingConfiguration({
      MONGODB_STAGING_URI: atlasUri,
      MONGODB_STAGING_DB_NAME: STAGING_DATABASE,
      ATLAS_STAGING_CONFIRM: CONFIRMATION
    })).toEqual({ uri: atlasUri, databaseName: STAGING_DATABASE });
  });

  it('does not include a supplied URI/password in configuration errors', () => {
    const secretUri = 'mongodb+srv://private-user:never-print-this@velosupplystaging.example.mongodb.net/';
    let message = '';
    try {
      loadStagingConfiguration({
        MONGODB_STAGING_URI: secretUri,
        MONGODB_STAGING_DB_NAME: 'velosupply',
        ATLAS_STAGING_CONFIRM: CONFIRMATION
      });
    } catch (error) {
      message = error.message;
    }
    expect(message).not.toContain('never-print-this');
    expect(message).not.toContain('private-user');
  });
});
