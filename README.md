# VeloSupply AI

VeloSupply AI is a local-first inventory, fulfillment, and commerce demo. It combines an editorial hardware storefront with an authenticated operations console backed by a persistent Express API and live WebSocket telemetry.

## Architecture

- **Backend:** Node.js, Express, Zod, JWT, bcrypt, and `ws`; listens on port `8000`.
- **Persistence:** `backend/db.json` is seeded on first startup and updated with atomic file replacement.
- **Frontend:** React, TypeScript, Vite, React Router, Zustand, TanStack Query, Recharts, and Tailwind CSS.
- **API proxy:** Vite forwards `/api` and `/ws` requests to the local backend.

## Start locally

Install dependencies once:

```powershell
cd backend
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

## Demo accounts

All seeded demo accounts use password `1234`.

| Email | Role |
| --- | --- |
| `admin@velosupply.ai` | Admin |
| `ops@velosupply.ai` | Operator |
| `buyer@velosupply.ai` | Buyer |

Change the development JWT secret by setting `JWT_SECRET` before starting the backend. Production deployments must configure a strong secret and terminate TLS at a trusted proxy.

## Routes

- `/` — editorial landing page, network telemetry preview, ROI estimator, and pricing.
- `/store` — searchable, filterable hardware catalog and checkout drawer.
- `/login` — authenticated operations entry point; the demo admin button fills the seeded admin credentials.
- `/dashboard` — live metrics and orders.
- `/dashboard/topology` — warehouse network and scenario simulations.
- `/dashboard/threats` — low-stock alerts and AI restock actions.
- `/dashboard/activity` — telemetry event stream and throughput chart.
- `/dashboard/manage` — inventory controls and operating simulation parameters.
- `/dashboard/rewards` — efficiency score and program status.
- `/dashboard/reports` — SLA summary and downloadable CSV audit report.
- `/dashboard/account` — backend health check and session controls.
- `/dashboard/admin` — administrator-only user and role management.

## API overview

Public endpoints include `GET /api/health`, `GET /api/products`, `POST /api/auth/login`, and `POST /api/auth/register`. Authenticated routes provide profile, checkout, orders, metrics, warehouses, threats, inventory updates, and simulations. Admin user-management endpoints require an admin bearer token. Live telemetry is broadcast over `/ws/telemetry`.
