# Decision Log

D-001 | Use redesign/dashboard-v14 at 93e4d31e618d1260c85426fe9754797542b629ea as the Phase 1 baseline | This is the exact parent branch named by the Pakistan Edition specification and identifies the source snapshot audited | AUDIT.md

D-002 | Create pakistan/v15 from redesign/dashboard-v14 | Preserve the completed Dashboard V14 work and isolate Pakistan Edition changes from the source branch | Branch pakistan/v15

D-003 | Record current implementation separately from target requirements | Phase 1 is an audit-first stage; do not report unimplemented Pakistan Edition requirements as existing behavior | AUDIT.md

D-004 | Preserve existing files and routes during Phase 1 | No file was shown to block a build or require removal before implementation; removals require later evidence and a separate log entry | AUDIT.md

D-005 | Treat legacy role user as a migration concern, not as if it already equals buyer | Existing stored users and JWT claims use user; the target uses buyer; migration must preserve IDs and relationships | AUDIT.md

D-006 | Do not run a live migration or write to Atlas during Phase 1 | The repository audit does not authorize destructive data conversion; migration requires backup, idempotency and explicit verification in its implementation phase | AUDIT.md
D-007 | Keep the 3,600 one-second SRE sample ring in process memory and persist five-minute aggregate buckets | This preserves detailed near-real-time charts without writing every second into the existing single-document state store | backend/sre.js

D-008 | Report Stock ledger and Payment gateway as degraded until real implementations exist | The audited baseline has neither an immutable movement ledger nor an external payment provider; showing UP would be misleading | backend/sre.js

D-009 | Scope chaos injection only to product browse and checkout and expire effects after 60 seconds | This follows Section 14.8 and prevents experiments from affecting authentication, SRE management, or telemetry sockets | backend/sre.js

D-010 | Retain POST /api/orders/checkout and add POST /api/checkout as an alias | Existing clients keep working while the target SRE/SLO route name is supported | backend/server.js

D-011 | Remove buyer order details from public WebSocket telemetry | The existing socket is unauthenticated; only non-sensitive order metadata is broadcast until audience authentication is implemented | backend/server.js

D-012 | Generate a fresh development JWT secret and localhost CORS default when environment values are absent | Local startup stays simple while production refuses missing JWT_SECRET or CORS_ORIGIN | backend/server.js

D-013 | Enforce the single-administrator invariant in registration and role changes, and scope buyer order reads | A registration-only check can be bypassed through role promotion; buyer accounts must not see other customers' orders | backend/server.js

D-014 | Require at least eight password characters, one uppercase letter and one number; change new local seeds to Velo@12345 | This matches the Pakistan Edition password policy while preserving production's no-demo-user startup behavior | backend/server.js, backend/seed.js

D-015 | Use exponential reconnect backoff and REST resync for telemetry clients | Short-lived WebSocket interruptions should recover without a fixed retry storm or stale dashboard snapshot | frontend/src/lib/useWebSocket.ts
D-016 | Centralize all frontend brand hex values in frontend/src/styles/tokens.css and reference CSS variables elsewhere | A CI check can now reject local one-off colors and keep the three-family Pakistan Edition palette consistent | frontend/src/styles/tokens.css, scripts/check-hex.mjs

D-017 | Keep four separate SRE AreaCharts and a 500-line terminal buffer fed by the existing telemetry WebSocket | The Reliability and Activity screens must show separate request, p95, error-rate and throughput series while preserving realtime events | frontend/src/pages/dashboard/ReliabilityPage.tsx, frontend/src/components/dashboard/TerminalPanel.tsx

D-018 | Calculate one-hour burn rates from each SLO's own event stream | Browse, checkout, WebSocket, health, stock accuracy and dispatch have different bad-event definitions and must not share only the HTTP request sample set | backend/sre.js

D-019 | Exercise the 25-failure breaker threshold and browse SLO calculations in backend tests | Critical SRE behavior should be verified by automated assertions, not only manual dashboard actions | backend/test/sre.test.mjs
D-020 | Commit the npm-generated backend lockfile and require npm ci in CI | The dependency manifest, lockfile and a clean install must agree; transitive package versions must come from npm's resolver rather than hand-authored guesses | backend/package-lock.json, .github/workflows/ci.yml

D-021 | Treat API, database and WebSocket as readiness-critical, while reporting the stock ledger and payment gateway separately in health | Missing future integrations must be visible as degraded without marking an otherwise functioning HTTP application unready | backend/sre.js, backend/server.js

D-022 | Give the Activity terminal a level filter and let new events repopulate after clear | Operators need the specified terminal controls without disabling the stream after one clear action | frontend/src/components/dashboard/TerminalPanel.tsx
D-023 | Reuse the existing VeloSupplyCluster instead of creating a duplicate | The Atlas project already contains an active free AWS Singapore cluster with a scoped velosupply_app database user; a second cluster would duplicate infrastructure without benefit | MongoDB Atlas VeloSupply AI project

D-024 | Bootstrap Atlas with an empty production application state and require explicit SEED_DEMO_DATA=true to load samples | Customer/order/inventory data must never be silently fabricated in a real data store | backend/production-state.js, backend/server.js

D-025 | Tag seeded state as demo and empty Atlas state as production; return the mode from health/metrics | Operators need to distinguish sample records, new production data and legacy records without provenance | backend/seed.js, backend/server.js

D-026 | Disable randomized heartbeat metrics and state-mutating scenario simulation in production by default | Simulated packet rates/detection times are not measurements and simulation must not alter real stock/order state | backend/server.js

D-027 | Do not add a universal Atlas IP allowlist entry | A broad 0.0.0.0/0 rule would expose database authentication endpoints to every IPv4 address; only the actual application egress IP/CIDR should be allowlisted | MongoDB Atlas Network Access

D-028 | Keep the local JSON file format while exposing the same collection CRUD/transaction contract as Atlas | Local development must not require MongoDB and must retain atomic replacement | backend/repository/file-adapter.js
D-029 | Store Atlas domain entities in named collections and keep only shared app state in application_meta | Section 12.1 requires real collections; the metadata collection must not contain the former full-state document | backend/repository/mongo-adapter.js
D-030 | Back up legacy application_state/primary into migrationBackups before writing named collections | Migration must preserve its source and remain safe to retry; the legacy source is never deleted by the migration | backend/repository/mongo-adapter.js
D-031 | Fail closed when new collections are populated but application_meta is missing | A partial/ambiguous migration must never be overwritten automatically | backend/repository/mongo-adapter.js
D-032 | Treat stock collection rows as a compatibility projection from product stock until a ledger exists | The current application does not yet record immutable stock movements; projected stock must not be described as reconciled ledger truth | backend/repository/collection-map.js, AUDIT.md
D-033 | Keep API handlers on the existing state shape for this migration slice | Preserve all existing endpoints while the storage adapter changes; collection-specific service migration and multi-instance write safety are explicit next work, not implied complete | backend/server.js, AUDIT.md
