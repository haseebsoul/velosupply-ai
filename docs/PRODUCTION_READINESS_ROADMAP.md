# VeloSupply production-readiness roadmap

Status snapshot: 2026-11-14. This roadmap is a release-gate plan, not a claim that VeloSupply is production-ready. PR #4 is merged into `main` (merge commit `ac030ce64c59002987d62c60fd5f1afa5a2e3dd3`); no production deployment has been performed.

## Release dependency order

- PR #4 (`pakistan/v16-multi-collection`) is the persistence foundation and targets `main`.
- PR #6 (`pakistan/v17-api-lifecycle`) now targets the merged `main` base and is the selected v17 foundation for this chain.
- PR #7 (`pakistan/v18-atlas-staging-verification`) is stacked on the reconciled PR #6 branch and its rebased head CI passed.
- PR #8 (`pakistan/v19-auth-repository-routes`) is stacked on the updated PR #7 branch.
- PR #5 (`pakistan/v17-route-integration`) is a parallel, overlapping v17 alternative targeting `main`. Code-level comparison found different COD/refund route contracts; PR #6 is the selected foundation because its route contracts match PR #7's verifier. Keep #5 as an alternative for review; do not merge both blindly.

Required merge order for the selected line: **#4 (merged) → #6 → #7 → #8**. Keep all drafts until their own review and runtime gates are satisfied.

## Milestones

### M0 — Select one v17 route implementation

Status: **#6 selected for the #6 → #7 → #8 stack; #5 remains an unmerged alternative**.

The code and API contracts have been compared. PR #6's collection-backed product/warehouse routes and manual-only COD/refund endpoints are the contracts exercised by PR #7's guarded verifier. PR #5 uses a different COD collection/refund decision API. Preserve #5 for independent review; do not merge the competing implementations together.

Exit gate: reviewer review of #6 and the rebased chain, followed by CI on each updated head.

### M1 — Execute the isolated Atlas staging integration test

Status: **harness implemented; live application test blocked by staging setup**.

Provisioned a separate Atlas project `VeloSupply Staging` and Free M0 cluster `VeloSupplyStaging`. Added `backend/scripts/verify-atlas-staging.js`, a test command, configuration guards and `docs/STAGING_ATLAS_VERIFICATION.md`. CI covers the verifier's guards, not the real connection.

Remaining setup: create a dedicated database user with only `readWrite` on `velosupply_staging`; allow only the fixed public egress IP of the test/app host; store `MONGODB_STAGING_URI` in that host's secret store; then run `cd backend && npm run test:atlas:staging` with the documented database and confirmation values.

Exit gate: the Express app uses the native Mongo adapter against Atlas and proves CRUD, checkout reservation/idempotency, cancellation/release, stock ledger reconciliation, transaction rollback, migration/initialization behavior, and fixture cleanup. Capture the exact cluster, database, commit and test output. A connector-only Atlas probe is not an application runtime test.

### M2 — Finish collection-backed API migration

Status: **partial**.

Already implemented in the v17 line: product/warehouse CRUD, checkout and order lifecycle services, stock movement and audit writes, return receipt/manual refund records, and collection-backed user registration/login/admin list/role/delete on the auth follow-up branch.

Still to migrate or explicitly isolate: newsletter subscriptions, reward claims, log and inventory-warning reads, order routing, simulation state, and any remaining handlers that read or mutate the compatibility snapshot. Review readiness/metrics/backup routes for stale snapshot use. Keep simulation writes out of real inventory and order collections unless they are operating on a separate synthetic tenant/database.

Exit gate: route inventory matches the SRS endpoint list; each route has an owning service/repository; no unintended write path relies on a process-local `db` snapshot; role scope, idempotency, transaction and audit behavior have route-level tests.

### M3 — Integrate real payment providers

Status: **not implemented**.

Manual COD collection/refund records are explicitly `providerVerified: false`; they are audit attestations, not verified settlement. Card, wallet and bank/instant-payment checkout must remain pending without a provider callback.

Human decisions required: supported provider(s) and payment methods; merchant account/contract and UAT access; settlement/fee/refund/reconciliation policy; webhook endpoint/domain; keys and signing secrets stored in a secret manager. Candidate providers must be selected by the business, not inferred by the implementation.

Implementation gate: payment intents, provider callbacks with signature verification, idempotent event processing, capture/settlement/refund states, reconciliation and failure/duplicate/timeout tests. No checkout method may be labelled paid until supported evidence exists.

### M4 — Integrate a courier provider

Status: **not implemented**.

Human decisions required: carrier/provider, service areas, rates, COD remittance terms, pickup/return process, merchant account, UAT credentials and webhook configuration.

Implementation gate: quote, shipment booking, label/reference persistence, tracking-event ingestion with signature/authentication, cancellation/return labels, delivered proof and webhook replay tests. No self-reported status may be called carrier-verified delivery.

### M5 — Complete customer and stakeholder workflows

Status: **needs product acceptance review**.

Verify the buyer journey (browse, register/sign in, cart/checkout, order history, invoice, cancel, return, refund and delivery tracking); operator journey (inventory count, paired stock transfers, pick/pack/dispatch, return receipt, purchase orders and offline recovery); admin journey (products, warehouses, suppliers, users, access, audit, settings, incidents and backups).

Also verify Urdu RTL, loading/empty/error states, 360/768/1440px layouts, real-time update reconnect/resync, accessibility and that all screens distinguish demo data from live data.

Exit gate: role-by-role acceptance checklist with captured staging evidence, not route presence alone.

### M6 — Security, operations and recovery

Status: **partial / not staging-verified**.

Required work: environment validation and secret management; TLS/domain/CORS/security headers; production auth/session policy and account recovery; authorization matrix; audit coverage; structured log redaction and retention; 30-day SLO data retention; alerts/runbooks; Atlas backups and a restore drill; migration rollback plan; deployment health/readiness checks; dependency/security scanning; load and failure/chaos tests; restore/failover verification.

Exit gate: documented deployment and rollback/recovery procedures exercised against staging, including backup restore and a failed-write/partial-failure drill.

### M7 — Production release approval

Status: **blocked**.

Production requires all previous exit gates, legal/business choices approved, no known production-blocking issues, provider UAT passed, production Atlas tier/network/backup policy configured, and a reviewed deployment/rollback plan. Require explicit owner approval before merging release branches or deploying.

## Human decisions that must not be invented

- Payment provider(s), supported methods, contracts, merchant onboarding, fees and settlement/refund policy.
- Courier provider(s), coverage, rates, COD remittance, return handling and tracking contract.
- Authoritative Pakistan GST/tax tariffs and effective dates, delivery price table and free-delivery threshold.
- Return window, refund amount rules, exclusions and evidence requirements.
- Production SKU/catalog, stock ownership/opening balances, warehouse locations/capacities and customer data.
- Hosting provider/runtime, production domain, TLS, static egress IP/private connectivity, region, capacity and backup retention.

Secrets must be configured directly in the selected runtime's secret store and must never be committed or pasted into source control/chat. Atlas network rules must be limited to exact trusted egress IPs or private connectivity; never use `0.0.0.0/0`.

## Current release boundary

Passing GitHub Actions is necessary but insufficient. The current CI runs test adapters and frontend build. The separate staging cluster exists, but the current Atlas metadata shows no database users and an empty network access list. Express-to-Atlas transactions have not yet run; the staging secret-store URI is not configured or available to this workflow. No real payment/courier provider is connected. No production deployment is authorized.

## Rebase verification snapshot

- PR #4 was merged to `main` as `ac030ce64c59002987d62c60fd5f1afa5a2e3dd3`.
- PR #6 was rebuilt on that main commit. CI passed on the rebased #6 head.
- PR #7 was rebuilt on the new #6 head. CI passed on its updated head; the live Atlas verifier was not executed.
- PR #8's auth changes have been rebased onto the updated #7 head; its rebased backend tests and frontend production build pass. The staging database user, restricted network allowlist and URI secret remain prerequisites for the separate runtime test.


## PR #8 rebase note

The auth follow-up is now rebased directly onto the updated PR #7 head. It preserves PR #6's transactional user creation and audit safeguards while adding repository-backed login lockout/success tracking and persisted-user authentication. CI must pass on this rebased head before the auth follow-up is treated as verified. This does not run the Atlas staging verifier or imply live database connectivity.


## Startup log secret redaction

The backend now logs only that a development default was generated; it does not log the generated JWT secret, CORS value, or a defaults object. A subprocess regression test captures startup output, verifies it does not contain the generated JWT secret, and checks the warning has no value fields. No production secret rotation was performed because the reviewed CI logs showed a generated development/test default rather than evidence of a real production credential disclosure.
