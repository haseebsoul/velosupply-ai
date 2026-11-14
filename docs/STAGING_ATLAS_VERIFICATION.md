# VeloSupply Atlas staging verification

## Isolated staging resources

A separate free-tier Atlas environment was provisioned so application tests do not touch the existing `VeloSupplyCluster` project.

- Atlas project: `VeloSupply Staging`
- Project ID: `6af7b228f139053a1da42527`
- Cluster: `VeloSupplyStaging`
- Cluster ID: `6af7b2378443c48302c19fd6`
- Tier/region: Free M0, AWS `AP_SOUTHEAST_1` (Singapore), MongoDB 8.0.37
- Application database: `velosupply_staging`
- Current network access list: empty
- Database user: not yet created

The original `VeloSupply AI` project and `VeloSupplyCluster` were not changed. Its database remains `velosupply`, with its existing empty production bootstrap document.

## What the verifier does

Run from `backend/`:

```powershell
$env:MONGODB_STAGING_URI = "<staging Atlas URI from your secret store>"
$env:MONGODB_STAGING_DB_NAME = "velosupply_staging"
$env:ATLAS_STAGING_CONFIRM = "I_CONFIRM_VELOSUPPLY_STAGING_ONLY"
npm run test:atlas:staging
```

The verifier:

1. Connects with the official MongoDB Node.js driver and checks the Atlas replica-set primary.
2. Initializes the real Mongo adapter, collection validators and indexes in `velosupply_staging`.
3. Refuses to start if users, warehouses, products or orders already exist in this staging database, or if the database name/confirmation do not match.
4. Attaches the real Mongo adapter to the Express app and exercises the actual Express route handlers.
5. Creates a staging warehouse and product, checks product reads, places an idempotent COD order, verifies stock reservation and cancellation/release, and checks actor audit entries.
6. Injects an exception inside a MongoDB transaction after writing a stock change and movement, then verifies both writes rolled back.
7. Adjusts inventory to zero, verifies the stock projection reconciles with the movement ledger, and archives the test product and warehouse.
8. Removes mutable test fixtures. Append-only movement and audit evidence remains in this dedicated staging database.

Tariff rules created by this test are explicitly marked `demo-estimate`; the test does not create a real tax quote or charge a payment method.

## Required one-time Atlas setup

1. Create a database user on `VeloSupplyStaging` with only `readWrite` on `velosupply_staging`. Do not reuse the production database user.
2. Add only the fixed public egress IP of the machine or self-hosted runner that will run the test. If the hosting environment has changing egress IPs, use its documented static-egress feature or a private network. Do not add `0.0.0.0/0`.
3. Store the staging URI in the machine/CI secret store as `MONGODB_STAGING_URI`. Set the database name and explicit confirmation variables shown above.
4. Run the command from a host that is included in the staging cluster's network access list.

Do not put a URI, password or API key in this repository, commit, log output, or chat.

## Verification boundary

The staging project and M0 cluster are provisioned and inspectable, but the application runtime test has **not** been run yet. The Atlas connector's own connection is not the same as the Express application's connection. The live verifier will pass only after the dedicated database user, fixed host egress allowlist and secret-store URI are configured.

M0 is suitable for integration smoke tests, not production load, high availability or disaster-recovery acceptance. Before production, repeat on a production-sized Atlas tier and complete backup/restore and failover drills.

## Rebase note

The verifier creates both a synthetic administrator and a synthetic buyer account. Checkout is sent with the buyer's short-lived test token because the application starts with production-mode state and rejects guest checkout. The administrator token is used for stock operations and cancellation. The verifier remains opt-in and is not part of CI; do not run it until the dedicated staging database user, restricted network access and secret-store URI are configured.


## Rebased validation boundary

This PR now sits directly on the reconciled v17 API lifecycle branch. CI validates script syntax and the configuration safety tests only; it does not run the live verifier. The live verifier includes a synthetic buyer session for production-mode checkout and must remain unexecuted until the isolated staging database user, restricted network route and secret-store URI are configured.
