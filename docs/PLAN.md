# Implementation Plan

Living document. Update status as work lands — this is the first thing to read at the start of a new session, before touching code.

How the docs fit together:
- **This file** — which phase we're on, what's done, what's next. Thin, operational.
- **`docs/specs/000N-<phase>.md`** — the design for one phase: data model, API shapes, flows, edge cases. Written before/while building that phase.
- **`docs/adr/000N-<title>.md`** — one frozen architectural decision + alternatives considered + consequences. Immutable once written.

## Phases

| # | Scope | Status | Spec | ADRs |
|---|---|---|---|---|
| 0 | AI workflow scaffolding (AGENTS.md, ADR template) | ✅ Done | — | — |
| 1 | Monorepo split (apps/web + apps/cms), webhook revalidation, Vitest | ✅ Done | — | [0001](adr/0001-monorepo-content-commerce-split.md), [0002](adr/0002-webhook-based-revalidation.md) |
| 2 | Customers & auth (session cookies) | ✅ Done | [0002-auth.md](specs/0002-auth.md) | [0003](adr/0003-session-cookie-auth.md), [0004](adr/0004-standalone-commerce-api-service.md), [0005](adr/0005-cookie-presence-route-protection.md) |
| 3 | Persistent cart (guest + logged-in, server-side) | Planned | — | — |
| 4 | Checkout & orders (state machine, stock reservation) | Planned | — | — |
| 5 | Mock payment gateway (async, Stripe-style webhook + idempotency) | Planned | — | — |
| 6 | Frontend e-commerce polish (filtering, mini-cart, order confirmation) | Planned | — | — |
| 7 | CI (lint/typecheck/test on PR) | Planned | — | — |

## Current session handoff

**Phase 2 — Customers & auth.** See [specs/0002-auth.md](specs/0002-auth.md) for the full design. Progress:

- [x] Decided: session cookie + DB table, not JWT (reasoning: JWT's main value — stateless cross-service verification — doesn't apply here, since only one service checks customer identity). See [ADR 0003](adr/0003-session-cookie-auth.md).
- [x] Decided: Drizzle + better-sqlite3 for the commerce DB (separate SQLite file from apps/cms's `payload.db`).
- [x] **Mid-phase restructure:** customer/session auth was originally built as Next.js API routes inside `apps/web` (a BFF shape), then deliberately split out into a third standalone app, **`apps/api`** (Fastify, port 4000), once it became clear the project goal was a frontend calling a genuinely separate backend service — the same way `apps/web` already calls `apps/cms` over real HTTP. See [ADR 0004](adr/0004-standalone-commerce-api-service.md) for the full reasoning, the CORS/cross-origin-cookie mechanics this requires, and the TBDs it leaves for a real deploy. All auth code below now lives in `apps/api`, not `apps/web`.
- [x] `customers` + `sessions` schema designed and migrated (`apps/api/src/db/schema.ts`, `apps/api/src/db/migrations/`). Sessions store a *hash* of the cookie token, not the raw value (same leak-resistance pattern as passwords). Sessions also carry `userAgent`/`ipAddress` for a future "active sessions" UI.
- [x] `apps/api/commerce.db` created and migrated via `npm run db:migrate --workspace=apps/api`; schema verified directly against the SQLite file (two tables, correct columns/FK).
- [x] Password hashing built and tested: `apps/api/src/auth/lib/password.ts` (bcrypt, cost factor 12) + `password.test.ts` (4 tests — no-plaintext-leak, salted/non-deterministic, correct/incorrect verification).
- [x] Session token generation built and tested: `apps/api/src/auth/lib/session.ts` (random 32-byte base64url token for the cookie + SHA-256 hash of it for the DB row) + `session.test.ts` (4 tests — collision resistance, deterministic hashing, no-raw-value-leak, different tokens hash differently).
- [x] Drizzle client (`apps/api/src/db/client.ts`): `better-sqlite3` + `drizzle-orm/better-sqlite3`. No `globalThis` caching needed here (unlike the old apps/web version) — apps/api is a single long-running Node process, not a dev server that reloads modules per-request.
- [x] Session-check lookup: `getCustomerForSessionToken` (`apps/api/src/auth/lib/getSession.ts`) — hashes the token, joins `sessions` → `customers`, returns `null` if missing/unknown/expired. 4 tests (`getSession.test.ts`), including the "expired session treated as logged out" case the spec called out.
- [x] **Register**: `POST /auth/register` (`apps/api/src/auth/routes/register.ts`, Fastify handler). Validates, rejects duplicate emails case-insensitively (409), hashes the password, inserts the customer, auto-logs-in (session row + httpOnly/SameSite=Lax cookie via `sessionConfig.ts`), returns the safe customer shape. 8-char password minimum (length only), fixed 30-day session, auto-login on register. `ipAddress` still left `null` (no reverse proxy in local dev — TBD before a real deploy). 5 tests via Fastify's `.inject()`, plus a manual curl walkthrough (with an `Origin` header simulating the browser) confirming CORS headers, cookie attributes, and DB row shape end-to-end.
- [x] **Login**: `POST /auth/login` (`apps/api/src/auth/routes/login.ts`). Looks up by (lowercased) email, verifies password via bcrypt, returns the same generic 401 `"Invalid email or password"` for both an unknown email and a wrong password. On success: same session-creation steps as register. 7 tests + manual verification (both failure paths confirmed byte-identical; each login creates its own distinct session row).
- [x] **Logout**: `POST /auth/logout` (`apps/api/src/auth/routes/logout.ts`). Deletes the matching `sessions` row (by hash) and clears the cookie; succeeds even with no cookie or an already-gone row. 4 tests + manual verification (register → logout → row gone, cookie expired, customer account itself untouched).
- [x] **Session check endpoint**: `GET /auth/session` (`apps/api/src/auth/routes/session.ts`) — wraps `getCustomerForSessionToken`, returns `{ customer }`. 3 tests. This is what apps/web's `useSession` hook calls.
- [x] CORS + cookies wired for the cross-origin boundary: `@fastify/cors` registered with the specific `apps/web` origin (`WEB_ORIGIN` env var) + `credentials: true` (never `*` — hard CORS spec rule once credentials are involved); `@fastify/cookie` for reading/setting/clearing the session cookie. Verified with real `curl -H "Origin: http://localhost:3000"` requests against the running server — every response carries the correct `Access-Control-Allow-Origin`/`-Credentials` headers.
- [x] apps/web's client-side pieces built *before* the restructure and kept as-is, now pointed at apps/api: `features/auth/queries/authKeys.ts` (query-key factory), `features/auth/api/auth.ts` (fetch wrappers — now call `NEXT_PUBLIC_API_URL` with `credentials: "include"`, required for the cookie to cross origins), `features/auth/hooks/useSession.ts` (`useQuery`), `features/auth/hooks/useAuthMutations.ts` (`useRegister`/`useLogin`/`useLogout`, each writing straight into the session query cache on success).
- [x] Full three-app end-to-end verification: `npm run dev` (root) boots cms + api + web together; ran the complete register → session → logout → login → session cycle via curl against the live `apps/api`, confirmed correct cookie/CORS behavior at every step, confirmed the storefront itself still renders unaffected.
- [x] **Form primitives decided:** `@base-ui/react/field` + `/form`, consistent with `Button`/`Badge` already wrapping Base UI, and so future forms (checkout, payment) don't re-implement touched/validation/ARIA wiring by hand. Added `components/ui/input.tsx` (via shadcn CLI, import fixed to `@/lib/utils`) and `components/ui/field.tsx` (hand-written wrapper over `Field.Root/Label/Description/Error`).
- [x] `RegisterForm` / `LoginForm` (`features/auth/components/`): `Form` + `Field` with client-side `validate` for obviously-bad input only; apps/api stays the source of truth (duplicate email, wrong credentials). EN/DE copy dictionaries co-located.
- [x] Pages: `/[lang]/login` (`LoginView`: login/register tabs, redirects to `/account` once a session exists) and `/[lang]/account` (`AccountView`: name, email, log out; redirects to `/login` when `useSession` returns no customer). Header has an Account link. The combined login+account page was split because protecting `/account` would otherwise lock logged-out users out of the forms.
- [x] Route protection: `proxy.ts` redirects logged-out requests for `/{locale}/account` and `/{locale}/checkout/*` to `/{locale}/login`, checking **cookie presence only** (no call to apps/api). Pure logic in `features/auth/lib/routeProtection.ts` with 6 tests. UX redirect, not enforcement — apps/api and client `useSession` catch stale cookies. See [ADR 0005](adr/0005-cookie-presence-route-protection.md).
- [x] Manual browser click-through passed: sign up → account page → log out → hit `/account` logged out → redirected to `/login` → log in; also in `/de`.
- [x] Phase 2 marked ✅ Done here and in the README roadmap table.

**Next phase: 3 — persistent cart (guest + logged-in, server-side) in apps/api.** No spec written yet; start with one (`docs/specs/0003-cart.md`). Note the existing `apps/web/app/api/cart` + `features/products/api/cart.ts` is a placeholder cart that Phase 3 replaces. Carry-over reminders: every protected apps/api endpoint must verify the session itself (ADR 0005); `sessions.ip_address` and login rate limiting remain open TBDs.

See [AGENTS.md](../AGENTS.md#working-style) for the standing collaboration rules (small pieces, ask before deps/tradeoffs, tests ship with security-critical code, prioritize clickable UI).

## Dev environment notes

- All three apps run via `npm run dev` (root) or `dev:cms`/`dev:api`/`dev:web` individually. apps/cms on :3001, apps/api on :4000, apps/web on :3000.
- apps/api's commerce DB: `apps/api/commerce.db` (SQLite, gitignored, created via `npm run db:migrate --workspace=apps/api`).
- Browse the commerce DB visually: `npx drizzle-kit studio --workspace=apps/api` (or `cd apps/api && npx drizzle-kit studio`) → opens `https://local.drizzle.studio`.
- apps/api env vars: `PORT` (default 4000), `WEB_ORIGIN` (default `http://localhost:3000`, used for CORS), `DATABASE_URL` (default `file:./commerce.db`). apps/web needs `NEXT_PUBLIC_API_URL` (default `http://localhost:4000`) to reach it from the browser.
- apps/cms admin login (seeded): `ivana@email.com` / password was reset to `password123` during manual testing — change this if it matters to you.
