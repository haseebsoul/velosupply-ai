# VeloSupply AI

VeloSupply AI is an inventory, fulfillment, and commerce application. It combines an editorial hardware storefront with an authenticated operations console backed by a persistent Express API and live WebSocket telemetry.

## Architecture

- **Backend:** Node.js, Express, Zod, JWT, bcrypt, MongoDB Node driver, and `ws`; listens on port `8000`.
- **Persistence:** MongoDB Atlas stores the application state in the `application_state` collection. On first startup, the API migrates a valid legacy `backend/db.json` file or seeds the initial demo data.
- **Frontend:** React, TypeScript, Vite, React Router, Zustand, TanStack Query, Recharts, and Tailwind CSS.
- **API proxy:** Vite forwards `/api` and `/ws` requests to the local backend.

## Start locally

Before starting the app, add your development machine's public IP address to the VeloSupply Atlas project's Network Access list. Do not use an unrestricted `0.0.0.0/0` rule for a production deployment.

Configure MongoDB and the stakeholder invitation codes:

```powershell
cd backend
Copy-Item .env.example .env
# Edit .env with your Atlas database password and unique secrets
npm install
cd ..\frontend
npm install
```

Then run these two commands in separate terminals from the repository root:

```powershell
cd backend; npm start
```

```powershell
cd frontend; npm run dev
```

Open the Vite URL printed in the frontend terminal (normally `http://localhost:5173`). The backend health probe is available at `http://localhost:8000/api/health`.

## Development and production accounts

Development seed accounts use password `1234`. They are created only when `NODE_ENV` is not `production` and Atlas has no application state yet. A new production database instead requires a bootstrap administrator name, email and password (at least 16 characters), and starts without sample orders or demo users. If a legacy JSON seed file is migrated in production, its seeded user accounts are replaced by that bootstrap administrator.

| Email | Role |
| --- | --- |
| `admin@velosupply.ai` | Admin |
| `operator@velosupply.ai` | Operations |
| `buyer@velosupply.ai` | Buyer |

The backend reads `backend/.env` on startup. Set `MONGODB_URI` and `MONGODB_DB_NAME` there. Set strong, unique `JWT_SECRET`, `ADMIN_INVITE_CODE` and `OPERATOR_INVITE_CODE` values before sharing the app. Set `CORS_ORIGINS` to the exact frontend origin(s) for your deployment. For first production startup, also set `BOOTSTRAP_ADMIN_NAME`, `BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_PASSWORD`. Buyers can self-register; administrator and operations registrations require their matching invitation code. Keep `.env` out of Git and restrict the Atlas network access list to trusted application IPs. Production deployments must terminate TLS at a trusted proxy.

## Routes

- `/` — editorial landing page, network telemetry preview, ROI estimator, and pricing.
- `/store` — searchable, filterable hardware catalog and checkout drawer.
- `/login` — authenticated operations entry point.
- `/register` — React Hook Form and Zod registration with Buyer, Operations and Administrator stakeholder choices; elevated roles require invitation codes.
- `/dashboard` — live operations metrics and orders.
- `/dashboard/messages` — system notices and priority-support guidance.
- `/dashboard/topology` — warehouse network and scenario simulations.
- `/dashboard/threats` — low-stock alerts and AI restock actions.
- `/dashboard/activity` — telemetry event stream and throughput chart.
- `/dashboard/manage` — inventory controls and operating simulation parameters.
- `/dashboard/rewards` — efficiency score and program status.
- `/dashboard/reports` — SLA summary and downloadable CSV audit report.
- `/dashboard/account` — backend health check and session controls.
- `/dashboard/admin` — administrator-only user and role management.

## API overview

Public endpoints include `GET /api/health`, `GET /api/products`, `POST /api/auth/login`, and `POST /api/auth/register`. Authenticated routes provide profile, checkout, orders, metrics, warehouses, threats, inventory updates, and simulations. Admin user-management endpoints support create, read, role update and delete operations, and require an admin bearer token. Live telemetry is broadcast over `/ws/telemetry`.

## Design credit

Dashboard craft principles were adapted from [unslop](https://github.com/heydamir/unslop) by Damir Sokolovsky, licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
