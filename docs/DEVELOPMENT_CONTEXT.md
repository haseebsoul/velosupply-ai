# VeloSupply AI — Development Handover

This file is the working handover for future maintenance. Read it before changing authentication, registration, persistence, or the application startup flow.

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

- Buyer self-registration is public.
- Administrator and Operations team registration are invitation-only.
- Internal role names are `admin` and `operator`; UI labels are Administrator and Operations team.
- Do not add a public role selector that can grant privileged access.
- Enforce roles and invitation redemption on the backend, not only in React.
- Invitation codes are cryptographically generated, stored as SHA-256 hashes, returned in full only once, and validated for role, expiry, status, and remaining uses. Redemption should be atomic with account creation.
- Admin-issued invitations are managed from the dashboard invitation/access page (the README describes the navigation).
- The optional `ADMIN_BOOTSTRAP_KEY` is a one-time first-admin bootstrap for a clean database when there is no active Administrator. It is not a permanent owner bypass. It is expected to be removed from the deployment secret store after successful redemption.
- Never print, commit, paste into documentation, or echo any real invitation key. A key shown in chat should be treated as exposed and rotated.

## Current owner-registration issue to investigate

The owner reported that the configured bootstrap key was rejected by the registration form. Do not assume the key itself is malformed. Inspect the live code and database state safely:

1. Confirm the frontend sends the exact expected request field name and selected role.
2. Trace the registration route and invitation repository validation path, including the no-active-admin bootstrap condition.
3. Check whether an Administrator already exists, whether the bootstrap invitation record exists, and whether it is active, expired, or already used. Query only non-secret metadata; never retrieve or log the stored hash or raw key.
4. Verify the local backend is loading the intended `backend/.env` and connecting to the intended database without displaying environment values.
5. Add isolated tests for first-admin bootstrap success, invalid key, expired/used key, existing-admin rejection, and normal invited admin/operator redemption. Tests must not connect to the owner's live Atlas database.
6. Fix the root cause without making privileged registration public. Prefer a secure owner-controlled recovery/bootstrap flow if the original one-time bootstrap has already been consumed.
7. Rotate any exposed bootstrap or database credentials before production use.

Do not create another bootstrap invitation directly in production data or reset an Administrator account without explicit owner approval and a reviewed, auditable recovery path.

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
