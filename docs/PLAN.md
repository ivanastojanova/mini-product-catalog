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
| 2 | Customers & auth (session cookies) | 🚧 In progress | [0002-auth.md](specs/0002-auth.md) | [0003](adr/0003-session-cookie-auth.md) |
| 3 | Persistent cart (guest + logged-in, server-side) | Planned | — | — |
| 4 | Checkout & orders (state machine, stock reservation) | Planned | — | — |
| 5 | Mock payment gateway (async, Stripe-style webhook + idempotency) | Planned | — | — |
| 6 | Frontend e-commerce polish (filtering, mini-cart, order confirmation) | Planned | — | — |
| 7 | CI (lint/typecheck/test on PR) | Planned | — | — |

## Current session handoff

**Phase 2 — Customers & auth.** See [specs/0002-auth.md](specs/0002-auth.md) for the full design. Progress:

- [x] Decided: session cookie + DB table, not JWT (reasoning: JWT's main value — stateless cross-service verification — doesn't apply here, since only apps/web ever checks customer identity; apps/cms never sees customer auth). See [ADR 0003](adr/0003-session-cookie-auth.md).
- [x] Decided: Drizzle + better-sqlite3 for apps/web's own commerce DB (separate SQLite file from apps/cms's `payload.db`).
- [x] `customers` + `sessions` schema designed and migrated (`apps/web/shared/db/schema.ts`, `apps/web/shared/db/migrations/`). Sessions store a *hash* of the cookie token, not the raw value (same leak-resistance pattern as passwords). Sessions also carry `userAgent`/`ipAddress` for a future "active sessions" UI.
- [x] `apps/web/web.db` created and verified via `npx drizzle-kit studio` (confirmed visually: two empty tables).
- [x] Password hashing built and tested: `apps/web/features/auth/lib/password.ts` (bcrypt, cost factor 12) + `password.test.ts` (4 tests, all passing — no-plaintext-leak, salted/non-deterministic, correct/incorrect verification).
- [x] Session token generation built and tested: `apps/web/features/auth/lib/session.ts` (random 32-byte base64url token for the cookie + SHA-256 hash of it for the DB row — fast hash is fine here since the input already has 256 bits of entropy, unlike a user-chosen password) + `session.test.ts` (4 tests, all passing — collision resistance, deterministic hashing, no-raw-value-leak, different tokens hash differently).
- [x] Drizzle client singleton (`apps/web/shared/db/client.ts`): wraps `better-sqlite3` + `drizzle-orm/better-sqlite3`, cached on `globalThis` to survive dev's module reloads, guarded by `server-only`. Verified with a manual insert/select/delete round-trip against the real `web.db`.
- [x] Register endpoint: `POST /api/auth/register` (`apps/web/app/api/auth/register/route.ts`). Validates (`features/auth/lib/validation.ts`), rejects duplicate emails case-insensitively (409), hashes the password, inserts the customer, auto-logs-in (creates a session row + sets the httpOnly/SameSite=Lax cookie — `features/auth/lib/sessionConfig.ts` holds the shared cookie name/duration/options), returns the safe customer shape (`features/auth/types/auth.ts`). Decided while building: 8-char password minimum (length only, no complexity rules), fixed 30-day session (not sliding), auto-login on register. `ipAddress` is left `null` for now — no reverse proxy in local dev sets `x-forwarded-for`, flagged as a TBD rather than storing something misleading. Tested two ways: `route.test.ts` (5 tests: happy path, case-insensitive duplicate rejected, short password rejected, invalid email rejected, malformed JSON rejected) against an in-memory migrated SQLite DB, plus a manual curl walkthrough against the real dev server confirming cookie attributes and DB row shape end-to-end.
- [ ] **Next up:** Login endpoint: verify password → create session → set cookie.
- [ ] Logout endpoint: delete session row, clear cookie.
- [ ] `features/auth/hooks/useSession.ts` + `RegisterForm`/`LoginForm` components.
- [ ] Route protection in `apps/web/proxy.ts` for `/account` and `/checkout` (checks session cookie).
- [ ] Manual click-through test: sign up, log in, log out, hit a protected route logged-out, confirm redirect.
- [ ] Update this file + README roadmap table to Phase 2 ✅ Done.

See [AGENTS.md](../AGENTS.md#working-style) for the standing collaboration rules (small pieces, ask before deps/tradeoffs, tests ship with security-critical code, prioritize clickable UI).

## Dev environment notes

- Both apps run via `npm run dev` (root) or `dev:cms`/`dev:web` individually. apps/cms on :3001, apps/web on :3000.
- apps/web's commerce DB: `apps/web/web.db` (SQLite, gitignored, created via `npm run db:migrate --workspace=apps/web`).
- Browse the commerce DB visually: `npx drizzle-kit studio --workspace=apps/web` (or `cd apps/web && npx drizzle-kit studio`) → opens `https://local.drizzle.studio`.
- apps/cms admin login (seeded): `ivana@email.com` / password was reset to `password123` during manual testing — change this if it matters to you.
