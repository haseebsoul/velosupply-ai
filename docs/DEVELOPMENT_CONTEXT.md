# VeloSupply AI — Development Handover

This file is the working handover for future maintenance. Read it before changing authentication, registration, persistence, or the application startup flow.


## Latest validated implementation snapshot — 16 November 2026

- This handover has been refreshed alongside the role-onboarding route tests. Read the current branch head rather than assuming the historical baseline SHA below is current.
- The latest completed GitHub Actions validation at this update is [run #43896807133](https://github.com/haseebsoul/velosupply-ai/actions/runs/43896807133): backend `npm ci`, backend syntax checks, **8 test files / 73 tests passed**, palette validation, root dev-launcher syntax, frontend `npm ci`, and frontend TypeScript/Vite production build all passed.
- Added HTTP coverage verifies Administrator-only invitation issuance, invitation hash secrecy, invitation-derived Deliverer role assignment, Deliverer order scoping, denial of admin APIs to Deliverers, and rejection of registration without a key.
- Current access model: all four roles (`admin`, `operator`, `buyer`, `deliverer`) require a single-use invitation. The invitation's stored role is authoritative.
- The current Atlas account's known schema-v1 to schema-v2 upgrade still requires a temporary `dbAdmin` grant for `collMod`; remove that role after migration and owner recovery, retaining runtime `readWrite`.
- The latest CI success verifies the repository build and isolated tests. It does **not** prove that the owner's local clone is synchronized, that the live Atlas migration has completed, or that a browser acceptance test has passed.

## Repository and working baseline

- Repository: https://github.com/haseebsoul/velosupply-ai
- Active feature branch: `feat/warm-editorial-rbac-command-center`
- Current baseline when this handover was added: `dd35b7e0d5daf9e9487dd681d22b5869dcb5474d`
- Open draft PR: https://github.com/haseebsoul/velosupply-ai/pull/15 (target: `main`; do not merge without owner approval and fresh validation).
- Windows working clone used by the owner: `D:\Projects\velosupply-ai-git`.
- Never commit `.env`, database exports, credentials, invitation keys, JWT secrets, or Atlas connection strings.

## Product and architecture

VeloSupply AI is a local-first inventory, fulfillment, and commerce application.

- Backend: Node.js + Express, Zod validation, JWT/bcrypt authentication, MongoDB native driver, WebSocket telemetry.
- Frontend: React + TypeScript + Vite, React Router, Zustand, TanStack Query, Recharts, Tailwind.
- Persistence: Atlas collection-aware repositories in hosted mode; local JSON adapter for local development.
- Root scripts: `npm run setup`, `npm run dev`, `npm test`, `npm run build`, and `npm run check`.
- `npm run dev` launches backend and frontend together. Typical local URLs: frontend `http://localhost:5173`, backend health `http://localhost:8000/api/health`.

## Changes already on the branch

The current feature branch contains the warm editorial storefront and operations-console redesign, role-aware route/navigation work, Buyer order/account views, route error boundaries, invitation-backed RBAC, invitation management UI/API, collection-backed invitation persistence, and telemetry/reliability UI improvements. Review the branch history and PR #15 for the complete diff; do not recreate these features from scratch.

The latest pushed commit at handover updated dependencies:
- Backend Zod to `^4.6.7`.
- Frontend Zod to `^4.6.7`.
- Frontend React Router DOM to `^7.18.5`.

Validation performed locally before that dependency commit:
- Backend: 8 test files, 65 tests passed.
- Backend npm audit: 0 vulnerabilities.
- Frontend npm audit: 0 vulnerabilities.
- Frontend TypeScript/Vite production build passed.
- Palette guard and `git diff --check` passed.
These results describe the tested local state at that time; rerun checks on any new head. They do not mean the latest GitHub Actions checks have passed.

## Access-control rules

- Every new role (`admin`, `operator`, `buyer`, `deliverer`) requires a matching active invitation. The persisted invitation is the source of truth for the account role; the client role selector is not trusted.
- Owner setup uses `npm run bootstrap:admin` only when no active Administrator exists. If an active Administrator already exists but the owner needs password recovery, `npm run admin:recover` resets only the selected active Admin account after an owner-only recovery key is supplied. Both commands clear their one-time local secret after a successful database transaction.
- Buyer and Deliverer invitation APIs are `/api/admin/invitations`; existing staff invitations use `/api/invitations`. The invitation UI is **Dashboard → Invitation keys**.
- Do not add a public role selector that can grant privileged access.
- Enforce roles and invitation redemption on the backend, not only in React.
- Invitation codes are cryptographically generated, stored as SHA-256 hashes, returned in full only once, and validated for role, expiry, status, and remaining uses. Redemption should be atomic with account creation.
- Admin-issued invitations are managed from the dashboard invitation/access page (the README describes the navigation).
- The optional `ADMIN_BOOTSTRAP_KEY` is a one-time first-admin bootstrap for a clean database when there is no active Administrator. It is not a permanent owner bypass. It is expected to be removed from the deployment secret store after successful redemption.
- Never print, commit, paste into documentation, or echo any real invitation key. A key shown in chat should be treated as exposed and rotated.

## Live Atlas facts and owner recovery

A read-only Atlas check at implementation time found the legacy database metadata at schema version 1, one active Administrator, and the system bootstrap invitation already consumed (`usedCount: 1`, `status: used`). This explains why the previously shared one-time key was rejected. No user email, password hash, raw invitation code or URI is included in this handover.

For the current database, run `npm run prepare:admin-recovery` in PowerShell to generate a fresh `ADMIN_RECOVERY_KEY` in the ignored local `backend/.env` without displaying it, then run `npm run admin:recover`. The CLI resets the password only for an exact email match to an active Admin, writes an audit record, and clears the recovery key. It does not create another administrator or modify invitations. `npm run bootstrap:admin` is reserved for an Atlas database with no active Administrator.

The live Atlas database users inspected at implementation time have `readWrite` on `velosupply`, without `dbAdmin`. The schema v1→v2 upgrade needs `collMod` on the existing `users` and `invitations` validators. Temporarily grant `dbAdmin` to the database user in `MONGODB_URI` for the one-time migration/first startup, then remove it and retain `readWrite`. Do not make this privilege permanent. The application records schema version 2 so it does not rerun `collMod` on subsequent restarts.

The bootstrap key previously disclosed in chat must be treated as compromised and rotated. Never log, retrieve or expose invitation hashes, password hashes, raw keys, or Atlas connection strings.

## Known deployment limitation

A previous Atlas health response reported API, database, WebSocket, and stock ledger up, but the payment gateway down because checkout still uses a simulated adapter. Do not describe the application as production-ready until a real payment provider is configured and tested. Atlas connectivity alone is not pilot/production readiness.

## Safe workflow for future changes

1. Read this file, `README.md`, relevant backend route/repository code, and PR #15 before editing.
2. Inspect current branch/head and working-tree status; preserve the owner's local `.env`.
3. Make the smallest backend-enforced change and add regression tests.
4. Run backend tests, frontend build, palette guard, and security audit as applicable.
5. Inspect `git diff --check` and ensure no secrets or local data are included.
6. Commit and push to the feature branch; verify the remote head SHA and PR status.
7. Report exactly what changed and what remains unverified. Never claim the app is running on the owner's PC unless the owner confirms it.
