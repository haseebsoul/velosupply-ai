# VeloSupply AI

VeloSupply AI is a local-first inventory, fulfillment, and commerce demo. It combines an editorial hardware storefront with an authenticated operations console backed by a persistent Express API and live WebSocket telemetry.

## Architecture

- **Backend:** Node.js, Express, Zod, JWT, bcrypt, MongoDB Node.js driver, and `ws`; listens on port `8000`.
- **Persistence:** MongoDB Atlas is the production source of truth (`velosupply.application_state`); local development falls back to `backend/db.json` with atomic file replacement.
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

Copy `backend/.env.example` to `backend/.env` and set `MONGODB_URI`, `MONGODB_DB_NAME=velosupply`, and a long random `JWT_SECRET`. The Atlas database user must have `readWrite` access to the `velosupply` database. Set `ADMIN_REGISTRATION_KEY` to a private invitation key before creating an Administrator account; never commit `.env` or real credentials. Production deployments must also set `CORS_ORIGIN` to the deployed frontend origin and terminate TLS at a trusted proxy. After adding the MongoDB driver, run `npm install` in `backend` to refresh the lockfile before using `npm ci` in your deployment pipeline.

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
- The current application still has no immutable stock movement ledger and no external payment gateway. Health probes intentionally report those dependencies as degraded until those systems are implemented; stock accuracy SLO measurement is therefore not a substitute for a ledger reconciliation.
- SRE telemetry keeps a 3,600-sample in-process one-second ring and persistent five-minute aggregate buckets. The one-second ring resets when the process restarts.
- Run backend tests with `cd backend; npm test`. The CI workflow runs the backend syntax checks and SRE tests before the frontend build.
