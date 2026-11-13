# Real vs simulated behavior

This document is the canonical product truth table. A configured database does not make an external provider integration live.

| Capability | Current state | Evidence / boundary |
| --- | --- | --- |
| Authentication and application authorization | Implemented | Express routes issue and verify JWTs; local/demo users remain synthetic. Email verification is not configured. |
| MongoDB Atlas persistence | Partially implemented | PR #4 adds collection-aware adapters and backup-first migration. The HTTP handlers still use the compatibility state object; direct collection repositories are being introduced. |
| Buyer, operator and admin records | Partially implemented | Domain repository validation supports buyer/operator/admin and buyer filer status. Existing HTTP registration still uses the legacy `user` role until its route migration is completed. |
| Product catalog and inventory | Partially implemented | Checkout sales, restocks, manual stock adjustments and demo demand simulations now append to the `stockMovements` collection; the API exposes a reconciliation status. A first movement establishes a timestamped opening-balance snapshot from the then-current product stock. Earlier stock history cannot be reconstructed from legacy counters. |
| Orders and order items | Partially implemented | Domain repository supports separate order-item records and integer-paisa PKR totals. Existing checkout still writes the legacy order shape until route migration is completed. |
| Audit history | Partially implemented | Append-only repository policy exists for audit logs. Account soft-delete, role changes and inventory mutations emit audit entries; other privileged routes still need coverage. |
| Tariff rules | Schema foundation only | Demo-estimate rules can be stored with provenance. No authoritative FBR tariff feed or SRO ingestion exists. |
| Email verification | Simulated / not configured | No transactional email provider is connected. Registration must not be described as email-verified. |
| FX rates | Not live | No scheduled source fetch has been configured. Never quote using a hardcoded rate. |
| Payment and escrow | Simulated status only | Checkout creates an application order; it does not charge a payment method or custody funds. No Raast/PSP merchant account is connected. |
| Courier booking and tracking | Simulated / not configured | No courier account, UAT key, shipment booking or live tracking webhook is connected. |
| Delivery confirmation | Unverified self-report | QR confirmation is not independent proof of delivery without courier proof-of-delivery data. |
| CNIC identity verification | Self-reported only | No NADRA Verisys or government data-sharing agreement exists. |
| Cyberattack detection | Not implemented | Current threat alerts concern stock thresholds and warehouse status, not packet inspection or intrusion detection. |

## Rules

- Demo records and generated telemetry must remain visibly marked as demo/simulated.
- Never set `simulated: false` unless a real provider call was made and verified.
- Never call a database balance "escrow custody" or claim the platform holds customer funds.
- Never describe a QR self-report as verified proof of delivery.
- Do not describe FBR, PSW or NADRA integration as available without the required agreement or vendor access.
