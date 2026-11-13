# VeloSupply AI — Phase 1 Code Audit

**Audit date:** 13 November 2026  
**Repository:** haseebsoul/velosupply-ai  
**Audited branch:** redesign/dashboard-v14  
**Audited commit:** 93e4d31e618d1260c85426fe9754797542b629ea  
**Upgrade branch:** pakistan/v15  
**Audit scope:** source tree, dependency manifests and lockfiles, backend APIs, authentication, persistence, seed data, frontend routes and behavior, WebSocket protocol, styles, configuration, README and CI.

This document records what the audited code currently contains. It does not describe target functionality as if it already exists.

## 1. Executive findings

The actual source was available through the connected GitHub integration, so this audit is based on the branch code rather than the README alone.

The project is a React/Vite frontend and Express backend. It currently implements a global logistics demo, not the Pakistan hardware-commerce system described in this specification. Its data is stored as one in-memory object persisted either to backend/db.json or to one MongoDB application_state document.

The most consequential baseline differences are:

1. Buyer accounts are stored with role key user, not buyer.
2. Demo seed passwords are still 1234. The seed users and inventory are not yet Pakistan-localized.
3. The operator seed address is operator@velosupply.ai. The README incorrectly lists ops@velosupply.ai.
4. The seed has five global hubs, 24 products, and 12 orders, rather than the six Pakistan hubs, 12 products and 60 orders in the target.
5. Atlas persists the entire state in one application_state document. No collection repository, migration, indexes or transactional unit of work exists.
6. Several critical API surfaces are absent, including tracking, invoices, returns, suppliers, purchase orders, messages, settings, audit, SRE and admin bootstrap.
7. The WebSocket endpoint is unauthenticated and broadcasts full order objects, which include buyer details, to all connected clients.
8. GET /api/orders returns all orders to every authenticated role.
9. Simulation scenarios mutate live inventory, warehouse and order state. They are not isolated what-if simulations.
10. The backend package lockfile does not include the MongoDB dependency declared by backend/package.json.
11. No root scripts, repository migration, backend/frontend tests or hex-check script are present.

No runtime code was changed during Phase 1. The source branch redesign/dashboard-v14 remains unchanged. A separate branch named pakistan/v15 has been created from it.

## 2. Repository tree

The audited Git tree has 41 tracked files and 15 directory entries. The source tree to depth four is:

    .
    ├── .github/
    │   └── workflows/ci.yml
    ├── .gitignore
    ├── README.md
    ├── backend/
    │   ├── .env.example
    │   ├── .gitignore
    │   ├── package-lock.json
    │   ├── package.json
    │   ├── seed.js
    │   └── server.js
    └── frontend/
        ├── index.html
        ├── package-lock.json
        ├── package.json
        ├── postcss.config.js
        ├── tailwind.config.js
        ├── tsconfig.json
        ├── tsconfig.node.json
        ├── vite.config.ts
        └── src/
            ├── App.tsx
            ├── main.tsx
            ├── index.css
            ├── components/
            │   ├── ProtectedRoute.tsx
            │   ├── dashboard/
            │   │   ├── DashboardLayout.tsx
            │   │   ├── Navbar.tsx
            │   │   ├── Sidebar.tsx
            │   │   ├── StatCard.tsx
            │   │   ├── TerminalPanel.tsx
            │   │   ├── ThreatRow.tsx
            │   │   └── TopologyCanvas.tsx
            │   └── storefront/
            │       ├── CartDrawer.tsx
            │       ├── EditorialNavbar.tsx
            │       ├── ProductCard.tsx
            │       └── RoiCalculator.tsx
            ├── lib/
            │   ├── apiClient.ts
            │   ├── useCountUp.ts
            │   └── useWebSocket.ts
            ├── pages/
            │   ├── LandingPage.tsx
            │   ├── LoginPage.tsx
            │   ├── RegisterPage.tsx
            │   ├── StorePage.tsx
            │   └── dashboard/CommandPages.tsx
            ├── store/
            │   ├── useAppStore.ts
            │   └── useCartStore.ts
            └── types/index.ts

There is no root package.json, AUDIT.md, DECISIONS.md, scripts directory, backend test directory, frontend test directory, or repository-layer directory on the audited source branch.

## 3. Dependencies and framework versions

Versions below distinguish manifest ranges from the versions recorded by the lockfiles.

### Backend

| Package | Manifest range | Lockfile version |
|---|---:|---:|
| bcryptjs | ^2.4.3 | 2.4.3 |
| cors | ^2.8.5 | 2.8.6 |
| express | ^4.21.2 | 4.22.3 |
| jsonwebtoken | ^9.0.2 | 9.0.3 |
| ws | ^8.18.0 | 8.23.0 |
| zod | ^3.24.1 | 3.25.76 |
| mongodb | ^6.12.0 | Not present |

**Finding:** backend/package.json declares mongodb, but backend/package-lock.json does not include it in the root dependency set or package entries. The lockfile is stale. A clean backend npm ci is expected to fail until the lockfile is regenerated and committed. The current CI workflow runs backend npm install, which can mask this lockfile mismatch.

### Frontend

| Package | Manifest range | Locked version |
|---|---:|---:|
| @hookform/resolvers | ^3.10.0 | 3.10.0 |
| @tanstack/react-query | ^5.62.0 | 5.107.1 |
| axios | ^1.7.9 | 1.21.1 |
| framer-motion | ^11.15.0 | 11.18.2 |
| lucide-react | ^0.468.0 | 0.468.0 |
| react / react-dom | ^18.3.1 | 18.3.1 |
| react-hook-form | ^7.54.2 | 7.92.0 |
| react-router-dom | ^6.28.1 | 6.30.6 |
| recharts | ^2.15.0 | 2.15.4 |
| zod | ^3.24.1 | 3.25.76 |
| zustand | ^5.0.2 | 5.1.0 |
| TypeScript | ~5.7.2 | 5.7.3 |
| Vite | ^6.0.5 | 6.4.6 |
| Tailwind CSS | ^3.4.16 | 3.4.19 |
| @vitejs/plugin-react | ^4.3.4 | 4.7.0 |

The frontend uses React 18, TypeScript, Vite, React Router, Zustand, TanStack Query, Recharts, Framer Motion, React Hook Form, Zod, Axios, Tailwind and lucide-react.

## 4. Environment variables

Variables read by backend source or declared by backend/.env.example:

| Variable | Current implementation |
|---|---|
| PORT | HTTP port; defaults to 8000 |
| NODE_ENV | Selects development and production behavior |
| JWT_SECRET | Defaults to a fixed development string; production throws if absent |
| CORS_ORIGIN | Comma-separated allowed origins; production does not refuse startup if absent |
| MONGODB_URI | Selects Atlas; production throws if absent |
| MONGODB_DB_NAME | Atlas database; defaults to velosupply |
| MONGODB_STATE_COLLECTION | Atlas collection; defaults to application_state |
| ADMIN_REGISTRATION_KEY | Invitation key for current admin registration |
| OPERATOR_REGISTRATION_KEY | Invitation key for current operator registration |

The example file also documents the MongoDB URI and the two invitation keys. The current backend does not generate and print safe development defaults when values are missing. Invitation keys are not intentionally logged. MONGODB_STATE_COLLECTION is an additional variable not listed in the required retained-variable list.

## 5. Backend architecture and persistence

### Runtime

- Node.js CommonJS application.
- Express 4 server in backend/server.js.
- Seed and local database path definitions in backend/seed.js.
- Default HTTP port 8000.
- Zod validation is applied to selected request bodies.
- bcryptjs hashes passwords.
- jsonwebtoken issues and verifies bearer sessions.
- ws attaches a WebSocket server to the HTTP server.
- MongoDB Node driver is loaded when MONGODB_URI is present.
- JSON request body limit is 1 MB.

### Local file mode

The local state file is backend/db.json. The seed module declares DB_SCHEMA_VERSION = 2. Writes are serialized in-process through a promise queue, written to a unique temporary file with restrictive file mode, and renamed into place.

This is an atomic replacement pattern for one process; it is not a multi-process file lock or a repository transaction layer.

### Atlas mode

Atlas uses database MONGODB_DB_NAME, default velosupply, and collection MONGODB_STATE_COLLECTION, default application_state. The primary state record has _id = primary and contains the whole application object in its state field.

Each persistence operation updates the state field as one full-object write. The telemetry timer calls persist approximately every two seconds. No MongoDB per-entity collections, collection repositories, indexes, transaction abstraction, migration marker or migration script exists.

loadDatabaseState calls seedDatabase before selecting the persistence adapter. With no MONGODB_URI, non-production returns the local file state; production throws. With an Atlas URI, the code connects and loads the primary application_state record. If that document does not exist, it creates the document from seed data. In production, only the users array is emptied; the rest of the demo seed data remains.

No live Atlas migration or write test was run during this source audit.

## 6. Frontend routes and access control

### Public routes

| Path | Component / behavior |
|---|---|
| / | LandingPage |
| /store | StorePage, catalog and CartDrawer |
| /login | LoginPage |
| /register | RegisterPage |

There is no /store/:sku product detail route, /track route, or /track/:code tracking route. Unknown routes redirect to / rather than rendering a dedicated not-found page.

### Authenticated dashboard routes

All are nested under ProtectedRoute and DashboardLayout:

- /dashboard
- /dashboard/topology
- /dashboard/threats
- /dashboard/activity
- /dashboard/messages
- /dashboard/manage
- /dashboard/rewards
- /dashboard/reports
- /dashboard/account
- /dashboard/admin

ProtectedRoute checks for a token and, when necessary, calls /api/auth/me. It does not accept an allowed-role list. All dashboard paths use the same conditional CommandPages component. The sidebar hides the admin link for non-admin roles, and the admin page conditionally renders its content, but there is no generic role-aware route guard.

The current role keys are admin, operator and user. The UI displays user as Buyer.

### Frontend session and data state

- The JWT is stored in localStorage under velosupply-token.
- Zustand holds token and user but is not configured with persist middleware.
- TanStack QueryClientProvider is installed, but persisted query caching is not configured.
- The Axios client attaches the bearer token from localStorage.
- No general 401 interceptor clears the session and redirects.
- The WebSocket client reconnects on a fixed 2-second timer; it does not send ping, request resync or use exponential backoff.

## 7. Exact backend route inventory

These routes are registered in backend/server.js. Unless stated otherwise, paths are relative to the backend host.

### Public routes (before the /api authentication middleware)

| Method | Path | Behavior |
|---|---|---|
| GET | /api/health | Health, service, storage mode and timestamp |
| GET | /health | Legacy health alias |
| GET | /api/metrics | Recomputed metrics |
| GET | /api/products | Product list with search and category filters |
| POST | /api/newsletter | Email subscription |
| POST | /api/auth/login | Login and JWT response |
| POST | /api/auth/register | Registration |
| POST | /api/register | Legacy registration alias |
| POST | /api/orders/checkout | Guest checkout |

The frontend CartDrawer calls /api/orders/checkout. The target /api/checkout route does not currently exist.

### Authenticated routes (after app.use('/api', authenticate))

| Method | Path | Role restriction | Behavior |
|---|---|---|---|
| GET | /api/auth/me | Any authenticated role | Current safe user |
| POST | /api/auth/logout | Any authenticated role | Success response; client removes local token |
| GET | /api/warehouses | Any authenticated role | All warehouses |
| GET | /api/rewards | Any authenticated role | Offers and claims for current account |
| POST | /api/rewards/:offerId/claim | Any authenticated role | Score check and claim creation |
| GET | /api/orders | Any authenticated role | Returns the full order array |
| GET | /api/logs | Any authenticated role | All logs |
| GET | /api/threats | Any authenticated role | Low-stock products and unhealthy warehouses |
| GET | /api/admin/users | admin | List users without password hashes |
| PATCH | /api/admin/users/:id | admin | Change a user's role |
| DELETE | /api/admin/users/:id | admin | Delete user, with self-delete and last-admin checks |
| PATCH | /api/inventory/:id | admin, operator | Direct stock and/or price update |
| POST | /api/inventory/restock/:id | admin, operator | Directly add product stock |
| POST | /api/orders/:id/route | admin, operator | Route order to lowest-latency online hub |
| POST | /api/simulation/trigger | admin, operator | Current simulation implementation |

No routes are registered for product CRUD, warehouse CRUD, suppliers, purchase orders, order status workflow, returns, invoices, messages, settings, audit log, full backup export, SLOs, service health history, alerts, incidents, runbooks, idempotency, public stats, ROI calculation, public tracking or auth bootstrap.

## 8. Authentication and security findings

### Accounts and registration

The seed contains three users:

| Name | Email | Stored role | Seed password |
|---|---|---|---|
| Haseeb Khan | admin@velosupply.ai | admin | 1234 |
| Sarah Chen | operator@velosupply.ai | operator | 1234 |
| Marcus Vance | buyer@velosupply.ai | user | 1234 |

Seed password hashes use bcrypt cost 10. Registration uses bcrypt cost 12. The README incorrectly lists ops@velosupply.ai for the operator; the actual seed email is operator@velosupply.ai.

The registration schema allows role admin, operator or user, defaults to user, and validates password length 8–128. It does not require uppercase or numeric characters. Admin and operator registration compare invitation keys with timingSafeEqual. There is no admin bootstrap endpoint or ADMIN_EXISTS response. Multiple admin accounts can be registered.

Admin user management can promote another user to admin or demote an admin. It prevents deleting one's own account and deleting the last admin, but it does not enforce exactly one admin atomically.

### Login

Login checks the user and bcrypt hash and returns the same 401 message for unknown email and wrong password. There is no failed-attempt counter, lockout, login-attempt store or rate limiter. Seed password 1234 remains valid. JWT expiry is 12 hours, not the target 8 hours.

### RBAC and privacy

GET /api/orders is available to any authenticated user and returns every order, without scoping by buyer. Logs, threats and warehouse reads are also accessible to any authenticated role. The frontend does not provide role-specific route guards for the complete route tree.

**Critical WebSocket privacy finding:** /ws/telemetry accepts unauthenticated connections. The broadcast function sends all events to every open socket. ORDER_CREATED events include the entire order object, including customer name, email, shipping region and item details. A public WebSocket client can therefore receive buyer data.

Other absent controls include Helmet/security headers, IP rate limits, lockout, strict validation for every query and parameter, suspended-user checks, idempotency keys and a structured request ID.

## 9. WebSocket inventory

- Server path: /ws/telemetry.
- Connection does not require a JWT.
- On connect, server sends CONNECTED.
- The timer broadcasts HEARTBEAT approximately every two seconds.
- Event shape: type, level, message, timestamp, metrics, warehouses and optional order.
- All events are broadcast to every open WebSocket.
- Some events contain an order object.
- Client retains up to 100 received events and reconnects after a fixed 2-second delay.

There is no PING/PONG contract, token processing, role or audience filtering, RESYNC request, snapshot response or exponential reconnect backoff.

## 10. Existing seed data and state shape

backend/seed.js declares schema version 2.

### Users

Three demo users are seeded, as listed in Section 8. All use password 1234. Names, phone, city, address and CNIC are not Pakistan-localized user profile records.

### Warehouses

Five global demo hubs:

- HUB-EWR — Newark Edge Hub
- HUB-AUS — Austin Edge Hub
- HUB-RTM — Rotterdam Edge Hub
- HUB-DXB — Dubai Edge Hub
- HUB-SIN — Singapore Edge Hub

Each record carries normalized canvas coordinates, capacity percentage, latency, status and updatedAt.

### Products

Twenty-four products across four categories: Edge Gateways, Smart Sensors, Server Racks and Power Modules. Fields include id, sku, name, category, description, price, stock, reorder_threshold, warehouse_hub, velocity_per_hr, status, createdAt and updatedAt. Prices are plain numbers without PKR or GST semantics.

### Orders

Twelve demo orders. Fields include id, customerName, customerEmail, shippingRegion, items containing productId and quantity, total, warehouse_hub, status, createdAt and updatedAt. Seed statuses include delivered, in_transit, processing and pending. There are no separate invoice, return, payment, reservation or movement-ledger records.

### Other data

The state also contains:

- schemaVersion
- users
- warehouses
- products
- orders
- logs
- newsletter
- metrics: gmv24h, activeOrders, fulfillmentHealth, packetsPerSec, avgLatencyMs, threatsBlocked, detectionTimeMs, efficiencyScore and hubCapacities
- telemetry: tick and updatedAt
- rewardClaims, initialized by the server when missing

Atlas stores the entire state object inside the application_state document. No collection-per-entity data model currently exists.

## 11. Simulation behavior

The current simulation API does not operate on a copy of the data:

- port_congestion changes the status and latency of a real warehouse.
- demand_spike changes live product velocity and stock.
- auto_rebalance changes real product warehouse assignments and order routing/status.
- Each simulation also increases the persisted efficiency score.

This conflicts directly with Section 11.8 of the Pakistan Edition, which requires simulations to be what-if runs against a copy and never change live stock or orders.

## 12. UI, styles and localization

The current UI is built around an editorial public storefront and a dark operations console. The styling is concentrated in frontend/src/index.css, approximately 488 lines, with duplicated semantic token groups.

Current CSS contains near-black backgrounds (#09090B, #0C0C0E, #121216), cream/white surfaces, lime (#B6FF00), burnt orange (#D9541E), multi-stop orange/red/pink gradients, and green/amber/red status colors. Later overrides introduce warm charcoal surfaces and muted orange accents. This is not the specified navy, white and signal-orange palette, and black/near-black surfaces are present.

Tailwind maps editorial and ops semantic color variables rather than the requested navy/orange/sand/ink token set. Google Fonts loaded by frontend/index.html are Inter, Instrument Serif and Geist Mono. There is no Urdu dictionary, Noto Nastaliq Urdu font or RTL layout support.

Framer Motion is used. Some components respect prefers-reduced-motion, but there is no site-wide low-data mode.

Current public storefront and dashboard copy, hub labels, shipping region, product categories, prices and demo data are global/US-oriented. The cart uses dollars and defaults shipping region to United States. No GST, Pakistani city, COD, wallet or Raast logic is present.

## 13. README, scripts, tests and CI

### Existing package scripts

Backend: start, dev and seed.  
Frontend: dev, build and preview.

There is no root package.json and no root setup, dev, build, seed, migrate:state, test or check command. There are no test files or configured backend/frontend test suites.

### Existing CI

.github/workflows/ci.yml runs:
1. Backend npm install.
2. node --check on backend/server.js and backend/seed.js.
3. Frontend npm ci.
4. Frontend npm run build.

CI does not run automated unit/integration tests, check-hex, accessibility tests, or full role acceptance workflows.

The README describes the current two-terminal local start, the V14 dashboard behavior and the single-document Atlas persistence. Its demo password and operator email details need correction as listed above.

## 14. Findings register

Severity reflects upgrade priority.

| ID | Severity | Finding |
|---|---|---|
| A-01 | Critical | Unauthenticated WebSocket broadcasts order objects containing buyer PII. Implement public-safe events and authenticated audience filtering. |
| A-02 | Critical | Any authenticated role can read all orders through GET /api/orders. Buyer order reads must be scoped to buyerId. |
| A-03 | High | Simulations mutate real warehouse, stock and order data. Implement isolated read-only simulations. |
| A-04 | High | Exactly one administrator is not enforced during registration or role changes. Enforce it atomically in persistence. |
| A-05 | High | Stored Buyer role is user, while the target role key is buyer. Define a data migration and token/session compatibility strategy. |
| A-06 | High | Checkout has no idempotency, transaction, movement ledger, reservation workflow, payment adapter or rollback. |
| A-07 | High | Atlas persists a whole state object in one document; no collection repositories, indexes, transaction abstraction or migration exists. |
| A-08 | High | No login lockout, failed-attempt counters, rate limits or suspended-account enforcement. |
| A-09 | High | MongoDB dependency is missing from backend/package-lock.json despite being declared in backend/package.json. |
| A-10 | Medium | Seed password remains 1234; README operator email is wrong; demo users and hubs are not Pakistan-localized. |
| A-11 | Medium | Password policy does not require uppercase and number; JWT lifetime is 12 hours instead of 8 hours. |
| A-12 | Medium | Registration lacks buyer phone, city, address, CNIC, terms and admin bootstrap visibility behavior. |
| A-13 | Medium | Product detail, tracking and many target API endpoints/pages are absent. |
| A-14 | Medium | Admin CRUD is partial: no product, warehouse, supplier or purchase-order CRUD; user create/status/suspend is absent. |
| A-15 | Medium | Inventory edits have no reason codes or movement ledger; restock directly changes stock rather than creating a purchase order. |
| A-16 | Medium | WebSocket has no ping/pong, resync, audience filtering or backoff. |
| A-17 | Medium | Landing page is not exactly five full-height Pakistan-localized scroll sections. |
| A-18 | Medium | Current styling has a mixed near-black/lime/cream/orange palette and violates the no-black navy/white/orange target. |
| A-19 | Medium | No Urdu dictionary, Urdu font, RTL behavior or localized validation copy exists. |
| A-20 | Medium | No offline banner, persisted 24-hour cache, idempotent write queue or low-data mode exists. |
| A-21 | Medium | SLO/error-budget engine, persistent health checks, alerts, incidents, runbooks, chaos controls and backup jobs are absent. |
| A-22 | Medium | No automated test suites, check-hex script or root orchestration scripts exist. |
| A-23 | Low | Component-specific styles and three-file component folders are not established; most CSS is global. |
| A-24 | Low | Unknown routes redirect to the landing page; there is no explicit not-found page. |

## 15. Required corrections to Section 2

Replace README-derived current-state claims in Sections 2.1 and 2.2 with the following verified baseline:

- Backend: Node.js CommonJS, Express 4, Zod 3, JWT, bcryptjs, ws and a declared MongoDB driver dependency. Port 8000. The backend lockfile currently omits mongodb.
- Persistence: Atlas database velosupply, application_state collection, document _id=primary containing the entire state object; local backend/db.json fallback using serialized writes and temporary-file rename. No migration, collection repository, transaction abstraction or indexes exist.
- Frontend: React 18, TypeScript 5.7, Vite 6, React Router 6, Zustand 5, TanStack Query 5, Recharts 2, Framer Motion 11, React Hook Form 7, Zod 3, Axios and Tailwind 3.
- Accounts: admin@velosupply.ai / Haseeb Khan / admin; operator@velosupply.ai / Sarah Chen / operator; buyer@velosupply.ai / Marcus Vance / user. All seeded with password 1234.
- Buyer role: stored as user and displayed as Buyer. The target buyer role key requires an explicit migration; do not silently assume the existing records already use buyer.
- Registration: public role defaults to user; admin/operator require invitation keys. Multiple admins are currently possible. No bootstrap endpoint or ADMIN_EXISTS behavior exists.
- Routes: public /, /store, /login, /register; authenticated dashboard paths /dashboard, /dashboard/topology, /dashboard/threats, /dashboard/activity, /dashboard/messages, /dashboard/manage, /dashboard/rewards, /dashboard/reports, /dashboard/account and /dashboard/admin. Product detail and tracking paths are absent.
- API paths: use the exact inventory in Section 7 above. Checkout is currently POST /api/orders/checkout. Add the target /api/checkout as an alias if it is required, while retaining the existing route.
- WebSocket: /ws/telemetry sends CONNECTED and HEARTBEAT messages with type, level, message, timestamp, metrics and warehouses; some events include order. All sockets receive the same broadcasts.
- Existing UI behavior: product search/category filters, cart drawer and guest checkout, dashboard metrics, orders list and auto-route, warehouse topology, inventory edits/restock, threats, activity terminal, rewards/claims, reports CSV export, newsletter, account health check and admin user role/delete controls. These are demo behaviors and do not imply the full Pakistan business rules exist.
- Security: JWT lifetime 12 hours; bcrypt seed cost 10 and registration cost 12; no lockout or rate limiting; selected request-body validation; CORS_ORIGIN is not required at production startup; WebSocket has no authentication or role filtering.

## 16. Specification issues to resolve before implementation

These are specification-level ambiguities, not claims about current source code.

1. **GST wording:** Section 3.1 says prices include GST, while Section 8.3 says seed prices exclude GST and Section 11.1 calculates GST on the ex-GST price. Recommended interpretation: catalog/base prices are stored excluding GST; checkout displays the ex-GST subtotal, a separate 18% GST line and the final GST-inclusive total.
2. **Exactly one administrator:** a public bootstrap check alone is race-prone. The data model needs a persistence-level singleton invariant that also handles concurrent registration and legacy data containing more than one admin.
3. **Role migration:** map legacy role user to buyer during migration, preserve user IDs and ownership relationships, and define whether pre-existing JWTs are invalidated or accepted during a short transition.
4. **Color exceptions:** Section 5 says three brand colors but also defines danger red and navy-tinted neutrals. State explicitly that danger/status colors are semantic-only and not brand accents; prohibit black and all unapproved decorative colors.
5. **Atlas transaction availability:** the migration and checkout design rely on transactions. Confirm that the deployed Atlas topology supports multi-document transactions and define a clear failure response if transaction support is unavailable.
6. **WebSocket token transport:** Section 10.6 specifies a JWT query parameter. Query strings can be captured in access logs and observability systems. Redact the parameter everywhere and never log the complete socket URL; a non-URL token transport would be safer if the protocol can be revised.
7. **Buyer privacy:** public tracking must verify both order code and phone, rate-limit attempts, return minimal shipment data and avoid disclosing another customer's address or personal details.

## 17. Verification boundaries

This is a read-only source audit of the branch snapshot. It did not execute the application, connect to Atlas, modify live data, run migration, perform browser click-through, or test checkout, authentication, role CRUD, WebSocket privacy or performance. The missing lockfile dependency is confirmed by comparing the committed manifest and lockfile contents; npm ci failure is an expected consequence, not a command executed during this audit.

No files were identified for removal during Phase 1. Existing routes, behavior and files should be retained or refactored unless a later phase proves they block the build or contradict an explicit requirement. Any removal must be logged in DECISIONS.md.
## 18. Implementation update — Pakistan Edition SRE (branch `pakistan/v15`)

The following implementation has been committed after the Phase 1 read-only audit:

- Added `backend/sre.js` with six SLO definitions, 30-day rolling request observations, error-budget remaining/burn calculations, a 3,600-sample one-second process ring, persistent five-minute aggregates, structured request logs, request IDs, alert evaluation, service health checks, incident lifecycle endpoints, runbook checklist persistence, bounded chaos controls, and backup export/scheduling.
- Integrated the SRE service into `backend/server.js`. Existing `GET /api/health`, `GET /health`, `GET /api/metrics`, `/ws/telemetry`, and `POST /api/orders/checkout` remain. Added `/livez`, `/readyz`, `GET /api/checkout`-compatible POST alias, authenticated `/api/sre/*`, and administrator-only `GET /api/admin/backup`.
- Added operator/admin Reliability UI at `/dashboard/reliability`, live terminal stream, SLO/error budget tiles, service probes, alerts, incident CRUD/timeline, seven runbooks, chaos controls, and admin backup export.
- Added helmet headers, 300/minute API and 10/minute login rate limits, 5-failures/15-minute email lockout, registration password complexity, generated local JWT/CORS defaults, production startup checks for JWT_SECRET and CORS_ORIGIN, single-admin checks in registration and role changes, buyer order scoping, and reduced WebSocket order data.
- Added backend SRE tests and CI test execution. Added root setup/dev/seed/test/build/check scripts. Seeded new local databases use `Velo@12345`; the seeded operator email in code is `operator@velosupply.ai`.

### SRE implementation boundaries still open

- The primary store remains the existing `application_state` document / `backend/db.json`; the Section 13.4 multi-collection repository layer and migration have not been implemented.
- No immutable `movements` stock ledger exists. The Stock ledger health probe deliberately reports degraded and SLO-3 currently detects negative stock only; it cannot prove ledger reconciliation.
- No external payment provider is configured. Payment gateway health deliberately reports degraded because checkout remains the current simulated adapter.
- The API's 30-day SLO observations are in-process and reset on process restart. Five-minute aggregates and health-check history are persisted; a restart-safe historical SLO query engine is still required for durable 30-day budgets.
- The one-second telemetry ring is process-local; five-minute aggregates are persisted in the application state. It has not been load-tested for the complete 30-day SLO horizon.
- Atlas connectivity, production backup configuration, restoration drills, TLS/proxy behavior, chaos behavior against a deployed environment, and end-to-end role acceptance have not been exercised in this implementation session.
- CI has verified backend syntax, the automated backend SRE tests, and frontend production build on the commits noted in GitHub Actions. Passing CI does not establish production readiness or completion of the entire Pakistan Edition.

The branch does not claim the SRE section or the full SRS is complete while these boundaries remain.
## 19. Latest SRE verification

The implementation was verified by GitHub Actions run [43523910861](https://github.com/haseebsoul/velosupply-ai/actions/runs/43523910861), on commit `dba575a57902c86678fccf827feffb122fc96c2e`.

- Backend dependency resolution completed and the committed backend lockfile now includes MongoDB, Helmet, Vitest and Supertest.
- A clean `npm ci` backend install passed.
- Backend JavaScript syntax checks passed.
- All 14 backend SRE tests passed, including SLO measurement, 25-failure circuit opening, alert lifecycle, incident timeline, runbook checklist, chaos scoping, health probes, readiness separation and rate limiting.
- The frontend palette guard passed and found no scattered frontend hex literals outside `frontend/src/styles/tokens.css`.
- The root development launcher syntax check passed.
- Frontend dependency installation with `npm ci` and TypeScript/Vite production build passed.

The Activity terminal now has pause/resume, reusable clear behavior, a level filter and a 500-event buffer. The Reliability page displays four distinct telemetry charts. The readiness endpoint checks API, Database and WebSocket independently of stock-ledger and payment-gateway degradation.

This green run verifies CI/build and isolated SRE tests. It does not establish live Atlas availability, deployed payment-provider integration, ledger integrity, production backup restore, load-test SLO achievement, or completion of the full Pakistan Edition requirements.
## 20. Atlas inspection and data-provenance review

Inspected the connected MongoDB Atlas project directly on 13 November 2026:

- Project: `VeloSupply AI` (`6af76e96f139053a1df1c4e9`).
- Existing cluster: `VeloSupplyCluster`, FREE tier, AWS `AP_SOUTHEAST_1` (Singapore), MongoDB 8.0.37, state IDLE.
- Existing database user: `velosupply_app`, scoped to cluster `VeloSupplyCluster`, role `readWrite` on database `velosupply`.
- `velosupply` initially contained only collection `application_state`, with zero documents. Atlas Network Access had zero IP/CIDR entries.
- Bootstrapped one `application_state` document with `_id: "primary"`, `dataMode: "production"`, schema version 2, empty users/warehouses/products/orders/logs/newsletter/rewardClaims arrays, and zero-valued metrics. This is an empty application-state envelope, not customer or demo data.

No new cluster was created because the existing free cluster already satisfies the project's development storage need. No second database user was created because the existing scoped `velosupply_app` user already has the needed database role. No public `0.0.0.0/0` network rule was added. The app runtime's outbound IP/CIDR still needs to be allowlisted by its owner/deployment operator before its own MongoDB driver can connect.

### Data provenance findings

- Local JSON fallback: seeded demo dataset when `MONGODB_URI` is absent in development.
- Seed records: 5 demo hubs (Newark, Austin, Rotterdam, Dubai, Singapore), 24 synthetic products, 12 synthetic orders, three development users and generated logs.
- Seeded demo login: `admin@velosupply.ai`, `operator@velosupply.ai`, `buyer@velosupply.ai`; seeded password is `Velo@12345`. Production's empty Atlas bootstrap contains no demo users.
- The sample packet-rate and detection-time metrics are generated/random demo values; they do not come from packet capture or an intrusion detection engine.
- `GET /api/threats` currently derives inventory/warehouse operational warnings from stock thresholds and hub status. It is not a cyber-threat detection feed.
- Scenario `/api/simulation/trigger` changes the stored state (hub status/latency, product stock/velocity, order routing). It is blocked in production by default unless `SIMULATIONS_ENABLED=true`.
- Checkout creates an application order and decrements stored stock, but it does not process money or book a real carrier. Payments and carrier services are not integrated.
- Actual SRE observations include HTTP request duration/status, process resource metrics, WebSocket ping/pong and API/DB/WebSocket health checks while running. The one-second ring is process-local; five-minute aggregate records are persisted through the active adapter. The full 30-day SLO history is not restart-safe.

### Safe Atlas bootstrap changes committed

- Added `backend/production-state.js` for a zero-record state envelope.
- Atlas no longer silently imports the demo catalog/order dataset when `application_state` is empty. Demo seeding in Atlas requires explicit `SEED_DEMO_DATA=true` in a non-production environment.
- Local JSON demo mode remains available for development.
- Added `dataMode` to health/metrics responses; seeded data is tagged `demo`, new Atlas state is tagged `production`, and pre-existing older state without provenance is tagged `unclassified`.
- Synthetic packet-rate/detection-time generation now runs only for demo data outside production.
- Production scenario simulation is blocked unless explicitly enabled.

This direct Atlas inspection confirms the cluster and empty bootstrap record exist; it does not verify the user's local `.env`, GitHub deployment secrets, application IP allowlisting, or a live Express-to-Atlas runtime connection.


## Repository Layer Follow-up (v16)

- Added a collection map for the Section 12.1 domain collections and the extra application collections already present in runtime state.
- Added a MongoDB adapter with per-collection CRUD, index creation, Atlas sessions/transactions, collection hydration, and differential collection persistence. The old application_state record remains read-only during migration.
- Added a file adapter with the same collection CRUD contract, serialized writes, temp-file/rename replacement, and snapshot rollback for failed transactions.
- Added safe migration behavior: a legacy application_state/_id=primary document is copied into migrationBackups before migration; migration is attempted only when the new collections are empty. Ambiguous partially populated databases fail closed.
- The product-level quantity is projected into the stock collection for compatibility. This is not an immutable stock movement ledger and is not yet a source-of-truth stock allocation model.
- Express route handlers still mutate an in-memory compatibility state object and call repository.writeState; collection-specific controller/service reads and writes and safe multi-instance concurrency remain a follow-up. Do not represent this phase as the entire Section 13.4 requirement completed.
- The Atlas migration has not been run through the application connection. The verified Atlas Network Access list had no entries; the deployment host's actual egress IP/CIDR is still required.
- Added npm run migrate:state and repository tests for file CRUD/rollback, collection metadata separation, stock projection, legacy backup/migration, and fail-closed initialization.
