# VeloSupply AI

VeloSupply AI is an inventory, fulfillment, and commerce application. It combines an editorial hardware storefront with a role-scoped operations console backed by a persistent Express API, MongoDB Atlas collections, and live WebSocket telemetry.

## Architecture

- **Backend:** Node.js, Express, Zod, JWT, bcrypt, MongoDB Node.js driver, and `ws`; listens on port `8000`.
- **Persistence:** with `MONGODB_URI` configured, the backend connects to the named Atlas database using the native MongoDB driver, pings it, and persists users, invitations, products, warehouses, stock, orders, invoices, returns, purchase orders, movements, audit events and other domain entities to named collections. An Atlas connection failure never falls back to local JSON. Local development without a URI uses `backend/db.json`; production fails closed without MongoDB.
- **Frontend:** React, TypeScript, Vite, React Router, Zustand, TanStack Query, Recharts, and Tailwind CSS.
- **API proxy:** Vite forwards `/api` and `/ws` requests to the local backend.

## Start locally

Recommended single-command workflow from the repository root:

```powershell
npm run setup
npm run dev
```

The root launcher starts the backend on port 8000 and Vite on port 5173. It is Windows-safe and stops both services when either process exits.

The original two-terminal workflow remains supported. Install dependencies with `npm run setup`, then run these commands in separate terminals from the repository root:

```powershell
cd backend; npm start
```

```powershell
cd frontend; npm run dev
```

Open the Vite URL printed in the frontend terminal (normally `http://localhost:5173`). The backend health probe is available at `http://localhost:8000/api/health`. Run `npm run check` for backend tests, palette validation and the frontend production build.

## Demo accounts

### Atlas connection and owner account

1. Copy `backend/.env.example` to `backend/.env`. Set `MONGODB_URI` to the private connection URI for `VeloSupplyCluster`, keep `MONGODB_DB_NAME=velosupply`, and set a long random `JWT_SECRET`. Never paste these values into chat or commit the file.
2. The first-run schema upgrade applies the current validators to the `users` and `invitations` collections using MongoDB `collMod`. The Atlas database user needs `dbAdmin` on `velosupply` for this one-time upgrade in addition to `readWrite`. Temporarily grant `dbAdmin` to the database user configured in `MONGODB_URI`, run the owner command or start the API once, then remove `dbAdmin` and retain only the runtime `readWrite` role. The migration version is recorded so subsequent starts do not repeat `collMod`.
3. For a database with no active Administrator, set a fresh random `ADMIN_BOOTSTRAP_KEY` (at least 32 characters) in `backend/.env` and run `npm run bootstrap:admin` from the repository root. The CLI prompts for the owner identity and a hidden password, creates the first Admin transactionally, records an audit event, and clears the one-time key from the file.
4. For a database that already has an active Administrator whose password is unavailable, run `npm run prepare:admin-recovery` in PowerShell. It writes a fresh random `ADMIN_RECOVERY_KEY` into the ignored local `backend/.env` without displaying it. Then run `npm run admin:recover`. The CLI requires the exact email of an existing active Administrator, resets only that account's password, records an audit event, and clears the recovery key. It does not create a second Admin or change invitation records.
5. Run `npm run dev`, open `http://localhost:5173/login`, and sign in with the owner email and password.

Both owner commands connect directly to the configured Atlas database, ping it, and refuse to use the local JSON adapter. They never print the MongoDB URI, owner key, invitation codes, or password. Bootstrap refuses to create a duplicate Admin. Recovery refuses to change an account unless the entered email identifies exactly one active Administrator. If the Atlas user does not have the temporary `dbAdmin` permission, schema initialization fails closed; do not broaden the runtime account permanently.


Seeded local-development demo accounts use password `Velo@12345`; production startup does not seed these users. All new accounts—Administrator, Operations team, Buyer and Deliverer—require an active role-bound invitation. An Administrator manages keys from **Dashboard → Invitation keys**. Secrets are displayed only once, stored as SHA-256 hashes, atomically redeemed with account creation, linked to the redeeming user, and revoked or marked expired when no longer valid.

| Email | Role |
| --- | --- |
| `admin@velosupply.ai` | Admin |
| `operator@velosupply.ai` | Operator |
| `buyer@velosupply.ai` | Buyer |

Copy `backend/.env.example` to `backend/.env` and set `MONGODB_URI`, `MONGODB_DB_NAME=velosupply`, and a long random `JWT_SECRET`. The Atlas database user must have `readWrite` access to the `velosupply` database. On startup, Atlas creates indexes for the named collections. If the legacy `application_state` document exists and the new collections are empty, the repository backs it up into `migrationBackups` before migrating its data. If neither old state nor new collection data exists, the adapter creates an empty production state. Existing populated new collections without `application_meta` cause startup to fail closed rather than being overwritten. Sample catalog, demo users and demo orders are only loaded into Atlas when `SEED_DEMO_DATA=true` is explicitly set in a non-production environment. Local JSON mode continues to seed demo data for development. Invitation keys are stored in the `invitations` collection with a unique hash index and are managed from **Dashboard → Invitation keys**. For a fresh production database only, set a strong, one-time `ADMIN_BOOTSTRAP_KEY` in the deployment secret store; when there is no active Administrator the API records a single-use, seven-day invitation from its hash. Redeem it during `/register`, then remove the bootstrap secret. Never commit `.env` or real credentials. Production deployments must also set `CORS_ORIGIN` to the deployed frontend origin and terminate TLS at a trusted proxy. The `MONGODB_STATE_COLLECTION` variable identifies the legacy source collection to read during migration; new application writes do not go back into that collection.

## Routes

- `/` — editorial landing page, network telemetry preview, ROI estimator, and pricing.
- `/store` — searchable, filterable hardware catalog and checkout drawer.
- `/store/orders` — authenticated Buyer order tracking, scoped to the signed-in buyer.
- `/store/account` — Buyer identity and session controls.
- `/deliveries` — Deliverer workspace, limited to shipments assigned to the signed-in Deliverer.
- `/login` — role-aware sign-in; demo account fill is available only in local development.
- `/register` — invitation-backed registration for Administrator, Operations team, Buyer and Deliverer; the persisted invitation determines the account role.
- `/dashboard` — role-aware operations overview and recorded order metrics.
- `/dashboard/topology` — warehouse network and scenario simulations.
- `/dashboard/threats` — stock-cover alerts with available units, days of cover, supplier reliability and recommended draft purchase orders.
- `/dashboard/activity` — telemetry event stream and throughput chart.
- `/dashboard/messages` — Administrator-only priority support notice and workspace updates.
- `/dashboard/manage` — inventory controls, operating simulation parameters and purchase-order approval/shipment/receipt workflow.
- `/dashboard/rewards` — Administrator-only efficiency score and program status.
- `/dashboard/reports` — SLA summary and downloadable CSV audit report.
- `/dashboard/account` — Administrator-only backend health and session controls.
- `/dashboard/admin` — administrator-only user and role management.
- `/dashboard/access` — administrator-only invitation key generation, listing and revocation for all supported roles.
- `/dashboard/deliveries` — Admin / Operations view for assigning packed shipments to active Deliverer accounts.

## API overview

Public endpoints include `GET /api/health`, `GET /api/products`, `GET /api/auth/bootstrap-status`, and `POST /api/auth/login`. `POST /api/auth/register` requires an active invitation for every supported role; the persisted invitation determines the new account's role, not the client-submitted role. Authenticated routes provide profile, buyer-owned orders/invoices, checkout, metrics, warehouses, stock-cover threats, inventory updates, purchase orders and simulations. Purchase orders move through draft → approved → shipped → received; the receive transition alone increases stock. Admin user-management and invitation-key endpoints require an admin bearer token. Buyer and Deliverer invitation APIs are under `/api/admin/invitations`; staff invitations use `/api/invitations`. Secrets are returned only at creation, SHA-256 hashed at rest, redeemed atomically with user creation, and record `usedBy`. Deliverers can only list assigned orders and confirm delivery on their own dispatched shipments. The Admin can assign only active Deliverers to packed orders or unassigned dispatched orders. Live telemetry is broadcast over `/ws/telemetry`.


## Design notes

The Dashboard V14 redesign keeps the existing VeloSupply logistics product, operational data and route behavior. Its visual clean-up follows the audit-first spacing, restrained color, typography and motion principles from [unslop](https://github.com/heydamir/unslop) by Damir Sokolovsky, licensed CC BY 4.0. The toolkit itself is not copied into this repository.

## Data provenance and what is real

See [Real vs simulated behavior](docs/REAL_VS_SIMULATED.md) and [External dependencies and owner actions](docs/EXTERNAL_DEPENDENCIES.md) for the canonical integration status and required owner credentials/approvals.

The application exposes `dataMode` from `GET /api/health` and `GET /api/metrics`:

- `demo`: generated sample catalog and operational records. The local JSON development fallback uses this mode.
- `production`: real application storage mode. A new Atlas database starts empty and does not seed fake buyers, products, warehouses, or orders.
- `unclassified`: an older state document created before data provenance tracking; verify its records before treating them as production data.

### Sample data (not real business records)

The current local demo seed contains six Pakistan-labelled demonstration hubs, 12 synthetic hardware SKUs, 26 demo accounts (one admin, four operators and 21 buyers), five fictional suppliers, 60 synthetic PKR orders and order items/invoices, eight purchase orders, stock movements, five incidents, eight alerts, 150 audit entries and six support messages. All generated business records are marked as demo. These are development examples, not verified Pakistani inventory, supplier feeds, customers, or carrier shipments. The known original five-global-hub/24-product demo fixture is upgraded; unknown customized demo state is preserved.

The legacy heartbeat generator randomizes packet-rate and detection-time values only for demo state outside production. Those values are not network packet inspection or threat detection. `GET /api/threats` calculates inventory days of cover, reorder points and suggested replenishment from SHIP movement history, and reports warehouse-status alerts; it does not detect cyberattacks. Scenario simulations remain demo/owner-gated behavior and are blocked in production unless `SIMULATIONS_ENABLED=true` is explicitly configured.

### Real application behavior

Authenticated login/JWT checks, authorization rules, product/order API calls and collection-backed persistence are implemented for the connected workflows. Checkout reserves available stock and creates a PKR order, order items, invoice, idempotency record and audit entry transactionally. Stock adjustment and hub transfers append ledger movements. Restock recommendations create a draft purchase order; stock changes only after the PO is approved, marked shipped and received. Production checkout requires an authenticated buyer. These records become production application data only when deployed against a configured persistent database. No payment is charged and no carrier booking is created.

The Reliability layer measures actual API request timing/status, process memory and event-loop lag, WebSocket ping/pong latency, and the health probes while the backend is running. Its 1-second sample ring is in process memory; five-minute aggregates and SRE state are persisted through the configured storage adapter. The complete 30-day SLO window is not restart-safe yet.

### Atlas storage currently provisioned

The existing Atlas project already contains the free `VeloSupplyCluster` (AWS Singapore, MongoDB 8.0). The `velosupply` database uses `application_state`; its existing `velosupply_app` database user has `readWrite` on that database. The initial `_id: "primary"` document is now bootstrapped with `dataMode: "production"` and empty arrays for users, warehouses, products and orders. No customer or sample business records were loaded into Atlas.

Atlas Network Access currently has no IP/CIDR entries. Before a local or deployed application can connect directly, add only that application's actual public egress IP/CIDR. Do not use `0.0.0.0/0`. Put the existing database-user password and the SRV connection string in `backend/.env` or deployment secrets; never commit them.


### Repository and migration status

- MongoDB stores domain records in named collections and shared metadata in `application_meta`. The adapter creates the SRS indexes and MongoDB schema validators, and copies the old `application_state/_id=primary` document into `migrationBackups` before migration. The legacy source is retained.
- MongoDB snapshot compatibility writes now compare an `application_meta.revision` inside a transaction and apply per-record diffs rather than deleting and reinserting whole collections. Collection CRUD also runs in MongoDB transactions and increments the revision. A stale writer receives `WRITE_CONFLICT` / HTTP 409 instead of silently replacing another instance's updates.
- The file adapter preserves `backend/db.json`, atomic temporary-file replacement and rollback. Its write queue is process-local; do not horizontally scale multiple backend processes against one JSON file. Use MongoDB for multi-instance deployments.
- `movements` is the canonical append-only stock ledger; `stockMovements` is only the legacy state alias. `auditLogs` is also append-only. Update/delete calls fail, and state snapshot diffs cannot edit or truncate either ledger.
- The canonical checkout aliases `POST /api/checkout` and `POST /api/orders/checkout` call the domain checkout transaction. It allocates stock by the buyer city, reserves units, stores PKR prices in integer paisa, writes separate `orderItems`, creates an invoice, writes the audit entry and persists the Idempotency-Key response atomically.
- Inventory adjustment and two-hub transfer routes use transactional domain operations, append ADJUST/TRANSFER_OUT/TRANSFER_IN movements, update stock projections and write audit entries. A restock recommendation creates a draft PO; its approved → shipped → received lifecycle writes a PO-linked RECEIVE movement and updates stock only on receipt. Order status transitions commit RELEASE on cancellation, SHIP on dispatch and RETURN_IN on return receipt. Return requests, decisions and physical return receipts are persisted with audit history; financial refunds are not executed.
- User registration/login, role changes and soft deletion use repository-backed user operations. Authentication resolves the current account from the users collection. The last administrator cannot be demoted or deleted. Buyer order/invoice reads are limited to the authenticated buyer; buyer self-cancel/return aliases are available.
- Product, warehouse, order, log and stock-cover reads use current collection reads. The Threats API calculates 7/14-day shipped-unit averages, days of cover, reorder point and recommended quantity from the SRS.
- The Pakistan demo seed now matches SRS Sections 8.1–8.4: 6 demonstration hubs, 12 specified SKUs, 1 administrator, 4 operators, 21 buyers with `filerStatus: "unverified"`, 5 fictional suppliers, 60 synthetic PKR orders over 45 days with ledger movements, 8 purchase orders, 5 incidents, 8 alerts, 150 audit entries and 6 support messages. Seed records are explicitly marked demo. The production bootstrap remains empty and the seed never overwrites a non-demo database.
- `npm run migrate:state` runs the backup-first migration/verification flow. It never populates production with demo records. A known original five-global-hub/24-product demo fixture is upgraded; unknown customized demo state is preserved.
- **Remaining compatibility-state routes:** newsletter subscription, rewards claims, scenario simulation and some SRE/telemetry state still use the compatibility state object followed by revision-guarded persistence. Supplier master CRUD, full product/warehouse CRUD and Settings workflows are not exposed as complete repository-backed HTTP workflows. The basic purchase-order lifecycle is connected through the inventory-restock and purchase-order status routes, but broader procurement and supplier administration remain incomplete. The seeded support messages are not yet exposed through message CRUD endpoints; the Messages page still contains static demo content.
- The local file adapter is for single-process development; only the MongoDB adapter has the cross-instance revision guard. No full deployment load/concurrency test has been performed.
- Live Atlas application-driver connectivity and migration have not been verified. The actual backend host egress IP/CIDR still needs to be added to Atlas Network Access; do not use `0.0.0.0/0`.

## Reliability and SRE

The operator Reliability workspace is available at `/dashboard/reliability` for administrators and operators. It reads the authenticated `/api/sre` API and presents the six SLOs, calculated error budgets, recent telemetry, five service probes, alerts, incidents, runbooks and scoped chaos controls.

SRE API routes (admin/operator unless stated otherwise):

- `GET /api/sre`, `GET /api/sre/metrics`, `GET /api/sre/health`
- `GET /api/sre/alerts`, `PATCH /api/sre/alerts/:id/ack`, `PATCH /api/sre/alerts/:id/resolve`
- `GET/POST /api/sre/incidents`, `PATCH/DELETE /api/sre/incidents/:id`, `POST /api/sre/incidents/:id/notes`
- `GET /api/sre/runbooks`, `PUT /api/sre/runbooks/:id/progress`
- `GET/POST /api/sre/chaos` (effects expire after 60 seconds and are limited to product browse and checkout)
- `GET /api/admin/backup` (administrator only)

The API also exposes `/livez` and `/readyz`. `GET /api/health` retains its original status, service, storage and timestamp fields and adds per-service health details.

### SRE operations notes

- Set `BACKUP_EXPORT=true` to enable the weekly JSON export when using Atlas. Atlas automated backups remain the primary Atlas backup mechanism. Local mode writes a nightly JSON backup under `backend/backups/` and retains the last seven daily files.
- Structured request logs include a request ID returned in `x-request-id`. The API applies a 300-request/minute IP limit and a 10-login/minute IP limit. Five failed login attempts for an email in 15 minutes trigger a 15-minute lockout.
- Checkout, inventory adjustment, hub transfer, cancellation, dispatch, return receipt and purchase-order receipt are connected to the append-only `movements` ledger. The opening balance is a current snapshot and cannot reconstruct older history. The Messages page remains static despite synthetic message records in the demo seed. No external payment gateway exists yet.
- SRE telemetry keeps a 3,600-sample in-process one-second ring and persistent five-minute aggregate buckets. The one-second ring resets when the process restarts.
- Run backend tests with `cd backend; npm test`. The CI workflow runs the backend syntax checks and SRE tests before the frontend build.
