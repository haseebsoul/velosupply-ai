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
