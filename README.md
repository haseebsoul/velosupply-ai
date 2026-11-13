# VeloSupply AI

VeloSupply AI is a local-first inventory, fulfillment, and commerce demo. It combines an editorial hardware storefront with an authenticated operations console backed by a persistent Express API and live WebSocket telemetry.

## Architecture

- **Backend:** Node.js, Express, Zod, JWT, bcrypt, MongoDB Node.js driver, and `ws`; listens on port `8000`.
- **Persistence:** MongoDB Atlas is the production source of truth (`velosupply.application_state`); local development falls back to `backend/db.json` with atomic file replacement.
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

All seeded local-development demo accounts use password `1234`. Production startup intentionally does not seed these demo users. Create the first production administrator using the private `ADMIN_REGISTRATION_KEY` invitation key.

| Email | Role |
| --- | --- |
| `admin@velosupply.ai` | Admin |
| `ops@velosupply.ai` | Operator |
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
