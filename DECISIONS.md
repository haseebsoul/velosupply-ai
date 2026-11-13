# Decision Log

D-001 | Use redesign/dashboard-v14 at 93e4d31e618d1260c85426fe9754797542b629ea as the Phase 1 baseline | This is the exact parent branch named by the Pakistan Edition specification and identifies the source snapshot audited | AUDIT.md

D-002 | Create pakistan/v15 from redesign/dashboard-v14 | Preserve the completed Dashboard V14 work and isolate Pakistan Edition changes from the source branch | Branch pakistan/v15

D-003 | Record current implementation separately from target requirements | Phase 1 is an audit-first stage; do not report unimplemented Pakistan Edition requirements as existing behavior | AUDIT.md

D-004 | Preserve existing files and routes during Phase 1 | No file was shown to block a build or require removal before implementation; removals require later evidence and a separate log entry | AUDIT.md

D-005 | Treat legacy role user as a migration concern, not as if it already equals buyer | Existing stored users and JWT claims use user; the target uses buyer; migration must preserve IDs and relationships | AUDIT.md

D-006 | Do not run a live migration or write to Atlas during Phase 1 | The repository audit does not authorize destructive data conversion; migration requires backup, idempotency and explicit verification in its implementation phase | AUDIT.md
