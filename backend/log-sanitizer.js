'use strict';

const REDACTED = '[REDACTED]';
const SENSITIVE_KEY = /(?:password|passwd|passphrase|secret|token|authorization|cookie|api.?key|access.?key|client.?secret|private.?key|connection.?string|connection.?uri|mongodb.?uri|invite|cnic|national.?id|phone|email|address|iban|account.?number|card.?number|cvv|(?:^|_)ip(?:address)?(?:_|$))/i;

function isSensitiveKey(key) {
  const normalized = String(key)
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-z0-9]+/gi, '_')
    .toLowerCase();
  return SENSITIVE_KEY.test(normalized);
}

const TEXT_REDACTIONS = [
  [/mongodb(?:\+srv)?:\/\/[^\s"'<>]+/gi, '[REDACTED_MONGODB_URI]'],
  [/https?:\/\/[^\s/@:]+:[^\s/@]+@/gi, 'https://[REDACTED]@'],
  [/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+\/-]+=*/gi, '[REDACTED_AUTH_CREDENTIAL]'],
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g, '[REDACTED_JWT]'],
  [/\b\d{5}-\d{7}-\d\b/g, '[REDACTED_CNIC]'],
  [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[REDACTED_EMAIL]'],
  [/(?:\+92|0092|0)[ -]?3\d{2}[- ]?\d{7}\b/g, '[REDACTED_PHONE]'],
  [/([?&](?:access_token|refresh_token|token|api_key|key|secret|password|signature|sig)=)[^&#\s]+/gi, '$1[REDACTED]'],
  [/\b(password|passwd|passphrase|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|invitation[_-]?key|authorization)\b(\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1$2[REDACTED]']
];

function redactText(value) {
  let output = String(value);
  for (const [pattern, replacement] of TEXT_REDACTIONS) {
    output = output.replace(pattern, replacement);
  }
  const maxLength = 4000;
  if (output.length > maxLength) output = output.slice(0, maxLength) + '…[truncated]';
  return output;
}

function sanitizeLogValue(value, options = {}) {
  const seen = new WeakSet();
  const maxDepth = Number.isInteger(options.maxDepth) ? Math.max(1, Math.min(options.maxDepth, 16)) : 8;

  function visit(input, key, depth) {
    if (key && isSensitiveKey(key)) return REDACTED;
    if (input === null || input === undefined || typeof input === 'boolean' || typeof input === 'number') return input;
    if (typeof input === 'string') return redactText(input);
    if (typeof input === 'bigint') return input.toString();
    if (typeof input === 'function' || typeof input === 'symbol') return '[UNSERIALIZABLE]';
    if (input instanceof Date) return Number.isNaN(input.getTime()) ? '[INVALID_DATE]' : input.toISOString();
    if (input instanceof Error) {
      if (depth >= maxDepth) return '[MAX_DEPTH]';
      return {
        name: redactText(input.name || 'Error'),
        message: redactText(input.message || ''),
        ...(input.code !== undefined ? { code: visit(input.code, 'code', depth + 1) } : {}),
        ...(input.stack ? { stack: redactText(input.stack) } : {})
      };
    }
    if (typeof input === 'object') {
      if (seen.has(input)) return '[CIRCULAR]';
      if (depth >= maxDepth) return '[MAX_DEPTH]';
      seen.add(input);
      try {
        if (Array.isArray(input)) {
          return input.slice(0, 200).map((item) => visit(item, '', depth + 1));
        }
        const output = {};
        for (const [childKey, childValue] of Object.entries(input)) {
          output[childKey] = visit(childValue, childKey, depth + 1);
        }
        return output;
      } finally {
        seen.delete(input);
      }
    }
    return String(input);
  }

  return visit(value, '', 0);
}

module.exports = { REDACTED, redactText, sanitizeLogValue };
