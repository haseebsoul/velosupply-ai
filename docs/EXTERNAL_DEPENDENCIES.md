# External dependencies and owner actions

Integrations are gated on the named credentials or formal approvals. Do not build a live provider adapter before its credential is present in the deployment environment. Until then, return `simulated: true` in relevant API responses and show a visible simulated/not-configured state in the UI.

## B.1 Transactional email

- Owner action: create an account with Postmark, Amazon SES or Resend; verify a sending domain or sender address.
- Required secrets: `EMAIL_PROVIDER_API_KEY`, `EMAIL_FROM_ADDRESS`.
- After credentials exist: send signed, time-limited verification links; accounts remain unverified until clicked.
- Before credentials exist: report "email verification not yet configured"; do not silently mark users verified.

## B.2 Exchange rates and tariff data

- Owner decision: confirm the public SBP exchange-rate page URL and fetch format, or choose a licensed FX API.
- Environment: `EXCHANGE_RATE_SOURCE_URL` or `FX_API_KEY`.
- After source is selected: scheduled fetch stores rate, timestamp and source; quotes fail closed when the latest rate exceeds the configured freshness window.
- FBR tariff schedules, SRO notifications and Pakistan Single Window require an official data-sharing arrangement or commercial trade-compliance vendor. Until then, `tariffRules` may contain only records marked `source: "demo-estimate"`.

## B.3 Payment and escrow

- Owner action: obtain KYB approval and a merchant account with a licensed bank/PSP supporting Raast merchant acceptance or an equivalent provider.
- Required secrets: `PAYMENT_PROVIDER_MERCHANT_ID`, `PAYMENT_PROVIDER_API_KEY`, `PAYMENT_WEBHOOK_SECRET`.
- After credentials exist: implement payment initiation, signature-verified webhooks, refunds/reversals and settlement reconciliation.
- Until then: ledger records are status-only and `simulated: true`. Do not represent a MongoDB balance as escrow custody or hold consumer funds.

## B.4 Courier tracking

- Owner action: establish a business partnership with a courier (TCS developer portal is one option) and complete UAT.
- Required secrets: `COURIER_API_KEY`, `COURIER_API_ENV` (`uat` or `production`).
- After UAT credentials exist: implement shipment booking and tracking pulls/webhooks. Production keys follow provider sign-off.
- Until then: simulator is visibly marked simulated and disabled by default outside demo mode.

## B.5 Delivery confirmation

- Depends on B.4. Courier delivery webhook or proof-of-delivery data becomes the trigger for escrow-release eligibility.
- Before courier integration: QR flow is an unverified buyer self-report, not proof of delivery.

## B.6 CNIC identity verification

- Self-reported CNIC only. NADRA Verisys-style checks require a formal approved government data-sharing agreement. There is no quick API-key signup path; owner/legal process is required.
