import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url);
const { PILOT_POLICY, getPilotAuthorization, getPilotPublicStatus, getPilotAllowedSkus, getPilotAllowedAreas, getPakistanDayKey } = require('../pilot-policy.js');

describe('controlled Karachi pilot policy', () => {
  it('fails closed by default and keeps HUB-KHI proposed', () => {
    const status = getPilotPublicStatus({});
    expect(status).toMatchObject({ status: 'proposed_not_authorized', authorized: false,
      site: { code: 'HUB-KHI', city: 'Karachi', status: 'proposed' },
      payment: { method: 'COD', providerVerified: false, independentlyVerified: false },
      delivery: { mode: 'operator_reported', providerVerified: false, independentlyVerified: false },
      inventory: { status: 'not_verified', physicalCountVerified: false, independentlyVerified: false } });
    expect(status).not.toHaveProperty('siteEvidenceRef');
    expect(status).not.toHaveProperty('ownerApprovalRef');
  });
  it('requires all four explicit gates and never exposes their reference values', () => {
    const env = { VELOSUPPLY_PILOT_ENABLED: 'true', VELOSUPPLY_PILOT_SITE_VERIFIED: 'true',
      VELOSUPPLY_PILOT_SITE_EVIDENCE_REF: 'test-only-site-evidence',
      VELOSUPPLY_PILOT_OWNER_APPROVAL_REF: 'test-only-owner-approval',
      VELOSUPPLY_PILOT_ALLOWED_SKUS: 'sku-1, SKU-2',
      VELOSUPPLY_PILOT_ALLOWED_AREAS: 'Clifton, DHA Phase 6',
      VELOSUPPLY_PILOT_OPENING_STOCK_VERIFIED: 'true',
      VELOSUPPLY_PILOT_OPENING_STOCK_EVIDENCE_REF: 'test-only-stock-count' };
    expect(getPilotAuthorization(env).enabled).toBe(true);
    for (const key of Object.keys(env)) expect(getPilotAuthorization({ ...env, [key]: '' }).enabled).toBe(false);
    const safe = getPilotPublicStatus(env);
    expect(safe.authorized).toBe(true);
    expect(safe.prerequisites).toMatchObject({ allowedSkusConfigured: true, allowedAreasConfigured: true, openingStockVerified: true, openingStockEvidenceConfigured: true });
    expect(safe.inventory).toMatchObject({ status: 'owner_evidence_configured', physicalCountVerified: false, independentlyVerified: false });
    expect(getPilotAllowedSkus(env)).toEqual(['SKU-1', 'SKU-2']);
    expect(getPilotAllowedAreas(env)).toEqual(['clifton', 'dha phase 6']);
    expect(JSON.stringify(safe)).not.toContain('test-only');
  });
  it('defines low proposed caps and uses Pakistan-local calendar days', () => {
    expect(PILOT_POLICY.limits).toEqual({ maxOrdersPerPakistanDay: 5,
      maxOrdersPerBuyerPerPakistanDay: 1, maxUnitsPerOrder: 5,
      maxOrderAmountMinor: 2500000, maxOutstandingCodMinor: 5000000 });
    expect(getPakistanDayKey('2026-11-14T19:30:00.000Z')).toBe('2026-11-15');
  });
});
