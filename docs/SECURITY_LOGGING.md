# Security logging and redaction

## Scope

`backend/sre.js` sends structured SRE events to stdout and the application `db.logs` collection. Those fields may include exception messages from MongoDB/network failures or future operational context. Both destinations now pass through `backend/log-sanitizer.js` before serialization or persistence.

## Redaction behavior

The sanitizer recursively redacts structured keys associated with credentials or personal data, including passwords, tokens, authorization/cookies, API keys, connection URIs, invitation keys, CNICs, emails, phone numbers, addresses, bank/card details and IP addresses. It also scrubs common free-text forms such as Atlas connection URIs, credential-bearing URLs, bearer/basic credentials, JWTs, CNIC patterns, email addresses, Pakistan mobile numbers and secret-bearing query/key-value parameters.

Ordinary operational context such as route, HTTP status, request ID, service name and error code is retained. Strings are bounded, recursion depth is limited, and cyclic references are made serializable. The tests also simulate an Atlas health-check exception and assert that neither stdout nor persisted SRE log metadata contains the sample credentials or identifiers.

## Important boundaries

- This change covers calls through the SRE `log()` function only.
- Legacy `server.js` `addLog()` calls and direct `console.*` calls are separate paths and still need an audit before claiming all application logs are redacted.
- The append-only SRE audit trail is intentionally not rewritten by this change; audit metadata requires its own field-by-field policy and retention controls.
- Redaction is defense in depth, not a substitute for avoiding secrets/PII in log messages and exception strings.
- Test fixtures use synthetic placeholder values only; the test suite makes no network call to Atlas or an external provider.
- No secret, credential, production record or customer data is required to run the unit/integration tests.

Run the focused suite with:

```bash
cd backend
npx vitest run test/log-sanitizer.test.mjs test/sre.test.mjs
```

## Review hardening on the current-main rebase

The structured-key matcher normalizes camelCase and separators before matching IP-address keys, so ordinary fields such as `description` are preserved while `clientIp`, `requestIP` and `ipAddress` are redacted. The traversal removes objects from its active recursion set after visiting them, so repeated shared references remain intact while true cycles are still marked. These cases are covered by focused regression tests.
