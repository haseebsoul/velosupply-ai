# Real vs simulated behavior

This document is the canonical product truth table. A configured database does not make an external provider integration live.

| Capability | Current state | Evidence / boundary |
| --- | --- | --- |
| Authentication and application authorization | Implemented for current API routes | JWT login and registration now use repository-backed users; each authenticated request re-reads the account so soft deletion/role changes take effect across application instances. Buyer registration defaults to `filerStatus: "unverified"`; no filer status is invented. Email verification is not configured. |
| MongoDB Atlas persistence | Partially implemented; live connection unverified | Named collections, schema validators, indexes, transactions and revision-guarded diff writes are implemented. A stale MongoDB state writer fails with `WRITE_CONFLICT` rather than silently replacing another writer's data. The file adapter is single-process only. The Atlas application driver has not been verified from the deployed backend host. |
| Checkout and orders | Repository-backed application workflow | `POST /api/checkout` and its legacy alias use the PKR domain service: city-based hub allocation, stock reservation, integer-paisa line calculations, GST, sourced delivery tariff, separate order items, invoice, audit and 24-hour idempotency. Cancellation and dispatch write RELEASE/SHIP; returns record request, decision and RETURN_IN. Buyer order/invoice reads and buyer self-cancel/return routes enforce ownership. This is an application order, not a paid transaction. |
| Inventory and stock ledger | Repository-backed application workflow | Manual adjustment and paired hub transfer routes append ADJUST and TRANSFER_OUT/IN movements. A restock recommendation creates a draft PO; PO transitions are draft → approved → shipped → received, and only receipt appends RECEIVE and increases on-hand stock. The Threats API calculates days of cover, reorder point and recommended quantity from shipped movement history. Legacy history before its opening-balance snapshot cannot be reconstructed. |
| Admin/operator role and account actions | Repository-backed | Registration, role changes and soft deletion use user repository operations and audit events. The last administrator cannot be demoted or deleted. Buyer-owned order/invoice reads and account actions are repository-backed; supplier/purchase-order administration and full catalogue/hub CRUD remain incomplete. |
| Purchase orders | Partially implemented repository-backed workflow | Staff can create draft POs from stock-cover recommendations and transition draft → approved → shipped → received. The receive step increases stock and appends a PO-linked RECEIVE movement. Operators cannot approve POs above Rs 2,000,000; an administrator is required. Supplier master CRUD and broader procurement controls are not implemented. |
| Messages | Seeded but not HTTP-connected | Six synthetic message records are present in the Pakistan demo fixture, but the current Messages page remains static demo content and message CRUD/read-state endpoints are not connected. |
| Pakistan catalogue and operational seed | Synthetic demonstration data | The local demo fixture mirrors SRS Sections 8.1–8.4 (six hubs, 12 SKUs, demo user cohorts, suppliers, 60 synthetic orders, purchase orders, incidents, alerts, audit records and messages). Every generated business record is marked `demoRecord: true`. Production starts with empty business collections. The fixture does not represent verified Pakistani suppliers, stock or customers. |
| Tariff rules | Demo estimates only | Local GST and city delivery fee records have `source: "demo-estimate"`. There is no authoritative FBR tariff feed, SRO ingestion or legal validation. A production checkout fails closed without sourced tariff records. |
| Email verification | Not configured | No transactional email provider is connected. Registration is not email-verified. |
| FX rates | Not live | No scheduled source fetch has been configured. Never quote using a hardcoded rate. |
| Payment and escrow | Not connected; no charge executed | The checkout records the selected payment method and pending/simulated state. It does not call JazzCash, Easypaisa, Raast, a card acquirer or bank API, and it does not custody funds. Financial refunds are not initiated; return handling records physical return receipt only. |
| Courier booking and tracking | Not configured | No courier account, UAT key, shipment booking or live tracking webhook is connected. |
| Delivery confirmation | Unverified | A QR or operator update is not independent proof of delivery without trusted courier proof-of-delivery data. |
| CNIC identity verification | Not implemented | No NADRA Verisys or government data-sharing agreement exists. |
| Cyberattack detection | Not implemented | Current threat alerts concern stock cover and warehouse status, not packet inspection or intrusion detection. |

## Remaining compatibility-state behavior

Newsletter subscription, rewards claims, scenario simulation and parts of SRE/telemetry still mutate the compatibility state object before calling revision-guarded persistence. Supplier master administration and full Settings/catalogue/hub CRUD are also not yet exposed as complete repository-backed workflows. The basic PO lifecycle is connected as described above; seeded messages are not exposed through message endpoints. MongoDB rejects stale snapshot writes with HTTP 409; these remaining features still need service-level collection CRUD and route tests. Local JSON persistence is process-local and is not safe for multiple backend processes.

## Rules

- Demo records and generated telemetry must remain visibly marked as demo/simulated.
- Never set `simulated: false` unless a real provider call was made and verified.
- Never call a database balance "escrow custody" or claim the platform holds customer funds.
- Never describe a QR self-report as verified proof of delivery.
- Do not describe FBR, PSW or NADRA integration as available without the required agreement or vendor access.
- Do not treat the synthetic Pakistan demo fixture as live or independently verified Pakistani inventory, supplier, buyer or order data.


## Manual COD collection and refund records (v17 API milestone)

- A delivered COD order remains `pending_cod` until an administrator or operator records the collected amount and an external receipt reference through `POST /api/orders/:id/payment/record-cod`.
- The API validates the exact PKR minor-unit total and prevents duplicate payment records. The record is explicitly `manual`; `providerVerified` remains `false` and no payment provider is called.
- Once an approved return is physically received into a warehouse, the API creates a manual refund record. Unpaid orders are blocked; historical orders with no reliable minor-unit total require manual review.
- An administrator can record an external refund reference through `POST /api/refunds/:id/record`. This records an operator-supplied reference only. It does not execute a refund, move money, or verify a payment provider.



## PR #6 reconciliation note

This v17 API lifecycle implementation is rebased directly on the merged PR #4 `main` commit. The collection-backed product/warehouse routes, manual COD collection, and manual refund-record routes are covered by `backend/test/v17-api-lifecycle.test.mjs`. COD remains unpaid until an operator/admin records the exact PKR minor-unit amount and receipt reference. Refund recording only stores an externally supplied reference; it does not contact or verify a payment provider. Live Atlas verification remains intentionally deferred until the dedicated staging user, restricted network route, and secret-store URI are configured.


## PR #8 authentication route follow-up

The v19 auth follow-up moves user lookup, login lockout, last-login updates, user listing and authentication account-state checks through the user repository. Registration, successful login, role changes and soft deletion write audit records. The frontend continues to receive the `user` role alias while the database stores `buyer`. This does not add email verification, MFA, password reset or external identity proof.
