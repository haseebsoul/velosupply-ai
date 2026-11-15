'use strict';

const PILOT_POLICY = Object.freeze({
  siteCode: 'HUB-KHI',
  city: 'Karachi',
  limits: Object.freeze({
    maxOrdersPerPakistanDay: 5,
    maxOrdersPerBuyerPerPakistanDay: 1,
    maxUnitsPerOrder: 5,
    maxOrderAmountMinor: 2500000,
    maxOutstandingCodMinor: 5000000
  }),
  payment: Object.freeze({ method: 'COD', executionMode: 'manual', providerVerified: false, independentlyVerified: false }),
  delivery: Object.freeze({ mode: 'operator_reported', providerVerified: false, independentlyVerified: false })
});
const hasValue = (value) => typeof value === 'string' && value.trim().length > 0;

function parseList(value, normalize = (item) => item) {
  if (typeof value !== 'string') return [];
  return [...new Set(value.split(',').map((item) => normalize(item.trim())).filter(Boolean))];
}
function getPilotAllowedSkus(env = process.env) { return parseList(env.VELOSUPPLY_PILOT_ALLOWED_SKUS, (item) => item.toUpperCase()); }
function getPilotAllowedAreas(env = process.env) { return parseList(env.VELOSUPPLY_PILOT_ALLOWED_AREAS, (item) => item.toLocaleLowerCase('en')); }

function getPilotAuthorization(env = process.env) {
  const pilotEnabled = env.VELOSUPPLY_PILOT_ENABLED === 'true';
  const siteVerified = env.VELOSUPPLY_PILOT_SITE_VERIFIED === 'true';
  const siteEvidenceConfigured = hasValue(env.VELOSUPPLY_PILOT_SITE_EVIDENCE_REF);
  const ownerApprovalConfigured = hasValue(env.VELOSUPPLY_PILOT_OWNER_APPROVAL_REF);
  const allowedSkusConfigured = getPilotAllowedSkus(env).length > 0;
  const allowedAreasConfigured = getPilotAllowedAreas(env).length > 0;
  const openingStockVerified = env.VELOSUPPLY_PILOT_OPENING_STOCK_VERIFIED === 'true';
  const openingStockEvidenceConfigured = hasValue(env.VELOSUPPLY_PILOT_OPENING_STOCK_EVIDENCE_REF);
  return { enabled: pilotEnabled && siteVerified && siteEvidenceConfigured && ownerApprovalConfigured && allowedSkusConfigured && allowedAreasConfigured && openingStockVerified && openingStockEvidenceConfigured,
    pilotEnabled, siteVerified, siteEvidenceConfigured, ownerApprovalConfigured, allowedSkusConfigured, allowedAreasConfigured, openingStockVerified, openingStockEvidenceConfigured };
}

function getPilotPublicStatus(env = process.env) {
  const authorization = getPilotAuthorization(env);
  return {
    status: authorization.enabled ? 'configured_for_controlled_pilot' : 'proposed_not_authorized',
    authorized: authorization.enabled,
    site: { code: PILOT_POLICY.siteCode, city: PILOT_POLICY.city,
      status: authorization.siteVerified && authorization.siteEvidenceConfigured ? 'evidence_configured' : 'proposed' },
    payment: { method: 'COD', executionMode: 'manual', providerVerified: false, independentlyVerified: false },
    delivery: { mode: 'operator_reported', providerVerified: false, independentlyVerified: false },
    inventory: { status: authorization.openingStockVerified && authorization.openingStockEvidenceConfigured ? 'owner_evidence_configured' : 'not_verified', physicalCountVerified: false, independentlyVerified: false },
    limits: { ...PILOT_POLICY.limits, currency: 'PKR', amountUnits: 'minor units (paisa)' },
    prerequisites: { pilotEnabled: authorization.pilotEnabled,
      siteEvidenceConfigured: authorization.siteEvidenceConfigured,
      ownerApprovalConfigured: authorization.ownerApprovalConfigured,
      allowedSkusConfigured: authorization.allowedSkusConfigured,
      allowedAreasConfigured: authorization.allowedAreasConfigured,
      openingStockVerified: authorization.openingStockVerified,
      openingStockEvidenceConfigured: authorization.openingStockEvidenceConfigured }
  };
}

function getPakistanDayKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi',
    year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const part = (type) => parts.find((entry) => entry.type === type)?.value || '';
  return part('year') + '-' + part('month') + '-' + part('day');
}
module.exports = { PILOT_POLICY, getPilotAuthorization, getPilotPublicStatus, getPilotAllowedSkus, getPilotAllowedAreas, getPakistanDayKey };
