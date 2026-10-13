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
- [ ] **Next up:** session token generation — random value for the cookie + SHA-256 hash of it for the DB row. Same pattern as password.ts: small module + test.
- [ ] Drizzle client singleton (`apps/web/shared/db/client.ts`) so app code can query `customers`/`sessions`.
- [ ] Register endpoint (`POST /api/auth/register` or similar — exact route TBD): hash password → insert customer → create session → set cookie.
- [ ] Login endpoint: verify password → create session → set cookie.
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
