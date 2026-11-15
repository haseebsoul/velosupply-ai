# Controlled pilot order flow

## Proposed scope and fail-closed default

The code contains one **proposed** Karachi candidate, `HUB-KHI`. The repository seed is synthetic; it does not prove that a facility exists, is authorized for use, staffed, or holds physical stock. Pilot policy does not create a warehouse, inventory, staff or customer records.

Production ordering stays disabled unless all four runtime settings are configured:
- `VELOSUPPLY_PILOT_ENABLED=true`
- `VELOSUPPLY_PILOT_SITE_VERIFIED=true`
- `VELOSUPPLY_PILOT_SITE_EVIDENCE_REF` is non-empty
- `VELOSUPPLY_PILOT_OWNER_APPROVAL_REF` is non-empty
- `VELOSUPPLY_PILOT_ALLOWED_SKUS` contains owner-approved SKU codes
- `VELOSUPPLY_PILOT_ALLOWED_AREAS` contains owner-approved Karachi customer areas
- `VELOSUPPLY_PILOT_OPENING_STOCK_VERIFIED=true`
- `VELOSUPPLY_PILOT_OPENING_STOCK_EVIDENCE_REF` points to the owner-signed opening stock count/reconciliation

These reference values only signal that an owner has supplied evidence/approval references. Software cannot authenticate their truth or sufficiency. They must not be enabled until a human verifies the site, authority to use it, stock count, operators, support coverage, business limits and stop authority.

## Conservative code defaults (not business approval)

| Limit | Default |
| --- | ---: |
| Orders per Pakistan-local day | 5 |
| Orders per buyer per Pakistan-local day | 1 |
| Total units per order | 5 |
| Maximum order value | PKR 25,000 |
| Outstanding manual COD exposure | PKR 50,000 |
| City / site candidate | Karachi / HUB-KHI only |
| SKU and customer-area scope | Exact owner-configured allowlists; empty by default |
| Payment | Manual COD only |

Caps are checked inside the order transaction. Cancelled orders still count toward the daily cap to prevent repeated place/cancel cycles. Pending COD exposure falls only when a manual collection record is entered, which is still not independently verified.

## Verification boundaries

Stock reservation is an application-ledger write only: every order carries `physicalCountVerified=false` and `independentlyVerified=false`. The production gate additionally requires owner-supplied signed opening-stock evidence and an existing active warehouse record; the software does not independently verify a physical count. COD references are operator-entered manual records (`providerVerified=false`, `independentlyVerified=false`). The `DELIVERED` transition is an operator report, not courier proof of delivery. No payment or courier provider is called. The UI labels synthetic catalogue availability, proposed HUB-KHI, manual COD and operator-reported delivery.

## Buyer / operator workflow

A buyer signs in, submits a Karachi COD order, and sees only their own order history. An admin/operator can see the operations order list, advance picking/packing/dispatch states, and enter a manual COD reference after an operator reports delivery. Buyer cancellation and return requests continue to use the existing ownership and transition checks.

## External blockers

Physical site inspection and authorization, signed opening stock count, named operations/support staffing, approved customer-area and SKU allowlists, owner-approved limits/stop rules, provider and courier accounts (if required), Atlas staging access and fixture authorization, recovery rehearsal and reviewer approvals remain outside this code change.
