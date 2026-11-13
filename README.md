# VeloSupply AI

VeloSupply AI is a local-first inventory, fulfillment, and commerce demo. It combines an editorial hardware storefront with an authenticated operations console backed by a persistent Express API and live WebSocket telemetry.

## Architecture

- **Backend:** Node.js, Express, Zod, JWT, bcrypt, MongoDB Node.js driver, and `ws`; listens on port `8000`.
- **Persistence:** Atlas uses a collection-aware repository (`users`, `products`, `warehouses`, `stock`, `orders`, and the other domain collections); local development keeps `backend/db.json` with atomic replacement. Both adapters expose collection CRUD and transaction methods.
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

All seeded local-development demo accounts use password `Velo@12345`. Production startup intentionally does not seed these demo users. Create Administrator and Operations team accounts using the private `ADMIN_REGISTRATION_KEY` and `OPERATOR_REGISTRATION_KEY` invitation keys. Public self-registration is limited to Buyers.

| Email | Role |
| --- | --- |
| `admin@velosupply.ai` | Admin |
| `operator@velosupply.ai` | Operator |
| `buyer@velosupply.ai` | Buyer |

Copy `backend/.env.example` to `backend/.env` and set `MONGODB_URI`, `MONGODB_DB_NAME=velosupply`, and a long random `JWT_SECRET`. The Atlas database user must have `readWrite` access to the `velosupply` database. On startup, Atlas creates indexes for the named collections. If the legacy `application_state` document exists and the new collections are empty, the repository backs it up into `migrationBackups` before migrating its data. If neither old state nor new collection data exists, the adapter creates an empty production state. Existing populated new collections without `application_meta` cause startup to fail closed rather than being overwritten. Sample catalog, demo users and demo orders are only loaded into Atlas when `SEED_DEMO_DATA=true` is explicitly set in a non-production environment. Local JSON mode continues to seed demo data for development. Set `ADMIN_REGISTRATION_KEY` to a private invitation key before creating an Administrator account; never commit `.env` or real credentials. Production deployments must also set `CORS_ORIGIN` to the deployed frontend origin and terminate TLS at a trusted proxy. The `MONGODB_STATE_COLLECTION` variable identifies the legacy source collection to read during migration; new application writes do not go back into that collection.

## Routes

- `/` — editorial landing page, network telemetry preview, ROI estimator, and pricing.
- `/store` — searchable, filterable hardware catalog and checkout drawer.
- `/login` — authenticated operations entry point; the demo admin button fills the seeded local-development admin credentials.
- `/register` — stakeholder registration for Administrator (invitation key required), Operations team, or Buyer.
- `/dashboard` — live metrics and orders.
- `/dashboard/topology` — warehouse network and scenario simulations.
- `/dashboard/threats` — low-stock alerts and AI restock actions.
- `/dashboard/activity` — telemetry event stream and throughput chart.
- `/dashboard/messages` — priority support notice and workspace updates.
- `/dashboard/manage` — inventory controls and operating simulation parameters.
- `/dashboard/rewards` — efficiency score and program status.
- `/dashboard/reports` — SLA summary and downloadable CSV audit report.
- `/dashboard/account` — backend health check and session controls.
- `/dashboard/admin` — administrator-only user and role management.

## API overview

Public endpoints include `GET /api/health`, `GET /api/products`, `POST /api/auth/login`, and `POST /api/auth/register`. Authenticated routes provide profile, checkout, orders, metrics, warehouses, threats, inventory updates, and simulations. Admin user-management endpoints require an admin bearer token. Live telemetry is broadcast over `/ws/telemetry`.


## Design notes

The Dashboard V14 redesign keeps the existing VeloSupply logistics product, operational data and route behavior. Its visual clean-up follows the audit-first spacing, restrained color, typography and motion principles from [unslop](https://github.com/heydamir/unslop) by Damir Sokolovsky, licensed CC BY 4.0. The toolkit itself is not copied into this repository.

## Data provenance and what is real

See [Real vs simulated behavior](docs/REAL_VS_SIMULATED.md) and [External dependencies and owner actions](docs/EXTERNAL_DEPENDENCIES.md) for the canonical integration status and required owner credentials/approvals.

The application exposes `dataMode` from `GET /api/health` and `GET /api/metrics`:

- `demo`: generated sample catalog and operational records. The local JSON development fallback uses this mode.
- `production`: real application storage mode. A new Atlas database starts empty and does not seed fake buyers, products, warehouses, or orders.
- `unclassified`: an older state document created before data provenance tracking; verify its records before treating them as production data.

### Sample data (not real business records)

The local demo seed contains 5 non-Pakistan hubs (Newark, Austin, Rotterdam, Dubai and Singapore), 24 synthetic products, 12 synthetic orders, three demo accounts and generated event logs. It also has illustrative starting metrics. These are development examples, not live inventory, supplier feeds, customers, or carrier shipments.

The legacy heartbeat generator randomizes packet-rate and detection-time values only for demo state outside production. Those values are not network packet inspection or threat detection. `GET /api/threats` currently reports inventory threshold and warehouse-status alerts; it does not detect cyberattacks. Scenario simulations change the local demo model and are blocked in production unless `SIMULATIONS_ENABLED=true` is explicitly configured.

### Real application behavior

Authenticated login/JWT checks, authorization rules, product/order API calls, stock updates and persistence are implemented. A checkout request creates an application order and reduces the chosen product's stored stock. That record becomes real application data only after a real buyer places the order against a configured, persistent database. The present checkout does not charge a payment method or create a carrier booking. Payment methods and carriers remain simulated adapters / planned integrations.

The Reliability layer measures actual API request timing/status, process memory and event-loop lag, WebSocket ping/pong latency, and the health probes while the backend is running. Its 1-second sample ring is in process memory; five-minute aggregates and SRE state are persisted through the configured storage adapter. The complete 30-day SLO window is not restart-safe yet.

### Atlas storage currently provisioned

The existing Atlas project already contains the free `VeloSupplyCluster` (AWS Singapore, MongoDB 8.0). The `velosupply` database uses `application_state`; its existing `velosupply_app` database user has `readWrite` on that database. The initial `_id: "primary"` document is now bootstrapped with `dataMode: "production"` and empty arrays for users, warehouses, products and orders. No customer or sample business records were loaded into Atlas.

Atlas Network Access currently has no IP/CIDR entries. Before a local or deployed application can connect directly, add only that application's actual public egress IP/CIDR. Do not use `0.0.0.0/0`. Put the existing database-user password and the SRV connection string in `backend/.env` or deployment secrets; never commit them.


### Repository and migration status

- The Atlas adapter writes domain records into named collections and stores only shared application metadata in `application_meta`. It creates the indexes from SRS Section 12.1 and exposes `findById`, `find`, `insert`, `update`, `remove`, `count`, and `withTransaction` operations.
- The file adapter retains the existing `backend/db.json` format, with serialized writes, temporary-file replacement and snapshot rollback for `withTransaction`.
- Domain services validate buyer filer status, integer-paisa PKR order totals with whole-rupee input validation and GST/delivery calculations, stock movement references and audit actions. User and product deletion are modeled as soft-delete/archive operations.
- `stockMovements` (legacy state alias: `movements`) and `auditLogs` are append-only in both adapters: update/delete calls fail, and full-state persistence rejects edits or truncation of existing ledger entries.
- Automatic migration runs only when `application_meta` and the new collections have no records and the legacy `_id: "primary"` document exists. The source document is copied to `migrationBackups` before the new collections are populated. The backup is not deleted.
- `npm run migrate:state` runs the migration/verification flow manually. It never loads sample records into a production database.
- Domain services now define soft-delete behavior for buyers/products, atomic order + item writes with SRS PKR line rounding, GST and city delivery fees, append-only inventory movements using the SRS movement types, on-hand/reserved reconciliation and paired hub transfers, append-only audit events and versioned tariff rules. These services are tested separately but are not all connected to the existing API routes yet.
- **Compatibility limitation:** the existing HTTP handlers still work against the in-memory state shape and call the repository's state-save operation. The next refactor must move their reads/writes to collection-specific repository calls before multiple backend instances can safely write concurrently. The stock collection is currently a compatibility projection of each product's on-hand quantity. An append-only `movements` collection and domain reconciliation service now exist, including reservations and paired transfers, but the existing HTTP inventory/checkout handlers are not yet routed through them; API-driven stock is therefore not yet ledger-backed.
- The live Atlas migration has not yet been executed from the application runtime. The previously inspected Atlas Network Access list was empty, so the actual backend host's public egress IP/CIDR must be allowlisted before the application driver can connect.

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
- An append-only `movements` repository and stock reconciliation service are implemented on the v16 branch, but the existing checkout/restock/inventory handlers have not yet been moved to use that ledger. The stock accuracy health probe therefore remains degraded until the API writes and reconciliations use the ledger. No external payment gateway exists yet.
- SRE telemetry keeps a 3,600-sample in-process one-second ring and persistent five-minute aggregate buckets. The one-second ring resets when the process restarts.
- Run backend tests with `cd backend; npm test`. The CI workflow runs the backend syntax checks and SRE tests before the frontend build.
