# ADR 0004: Split commerce auth/backend into a standalone `apps/api` service

**Status:** Accepted

**Date:** 2026-10-20

## Context

ADR 0001 split the monorepo by *domain* (content vs. commerce) but not by *layer*: `apps/web` ended up hosting both the storefront (React pages/components) and the commerce backend (Next.js API routes for register/login/logout/session, a Drizzle+SQLite client, password/session hashing — all built in this session under `apps/web/app/api/auth/*` and `apps/web/features/auth/lib/*`). That's a legitimate "BFF" (backend-for-frontend) shape, but it wasn't a deliberate choice — it's just where Next.js route handlers naturally landed. On review, this isn't the architecture the project wants to practice: the goal is a storefront that calls a genuinely separate backend service over HTTP, the way it would call any third-party API, mirroring the apps/cms boundary (ADR 0001) but for the commerce domain instead of content.

## Decision

Introduce a third app, **`apps/api`**, a standalone Node.js HTTP service (Fastify) that owns the entire commerce domain: customers, sessions, auth, and (later) carts/orders/payments. It gets its own process, own port (`:4000`), and keeps the existing SQLite DB + Drizzle schema (`web.db` → moves and is renamed to live under `apps/api`).

`apps/web` becomes purely a frontend: no more `app/api/auth/*` route handlers, no DB client, no `bcrypt`/`better-sqlite3`/`drizzle-orm` dependencies. Its `features/auth/api/auth.ts` fetch wrappers point at `apps/api`'s origin (`API_URL` env var, mirroring `CMS_API_URL`) instead of same-origin `/api/auth/*` paths.

**Auth mechanism is unchanged** (ADR 0003 stands): httpOnly session cookie, SHA-256-hashed token in the `sessions` table, bcrypt-hashed passwords. What changes is *where* that logic runs and *how* the cookie crosses the network:

- **CORS**: `apps/api` registers `@fastify/cors` with the specific `apps/web` origin (`http://localhost:3000` in dev) and `credentials: true`. `Access-Control-Allow-Origin` cannot be `*` once credentials are involved — this is a hard CORS spec rule, not a library quirk.
- **Cookie scope**: the `Set-Cookie` response now comes from `apps/api`'s origin (`localhost:4000`), not `apps/web`'s. The cookie is still read on every subsequent request *to apps/api*, which is correct — apps/api is the thing that owns sessions. `apps/web`'s pages never need to read the cookie directly; they always ask apps/api (`GET /session`) for the logged-in customer.
- **`fetch()` credentials**: every cross-origin auth call from `apps/web` needs `credentials: "include"`, or the browser won't send/store the cookie at all, regardless of CORS headers being correct.
- **SameSite**: unaffected for local dev — `SameSite=Lax` cares about registrable domain, not port, so `localhost:3000` ↔ `localhost:4000` is still same-site. A real deploy to genuinely different registrable domains would need to revisit this (flagged as a TBD below, not solved now since the eventual domain setup is unknown).

Framework choice: **Fastify** over Express/raw `http` — schema-validation-first conventions, actively maintained, and `@fastify/cors` + `@fastify/cookie` are both official plugins (not a pile of community middleware of varying quality), which matters for a learning project where legibility of the stack matters.

## Alternatives considered

- **Keep the BFF shape (Next.js API routes in apps/web)** — simpler (no CORS/cross-origin cookie handling to reason about, no second process to run), and arguably a more common real-world pattern for a storefront. Rejected because it doesn't match what the user actually wants to practice: a frontend that treats its backend as a separate service, the same way apps/web already treats apps/cms.
- **Bearer token in `localStorage` instead of a cookie** — would sidestep CORS-credentials complexity (bearer tokens go in a header, not an automatically-sent cookie, so no `SameSite`/`credentials` dance). Rejected: this would overturn ADR 0003's specific reasoning for choosing an httpOnly cookie (inaccessible to XSS-injected JS, unlike anything stored in `localStorage`). The cross-origin cost is paid once, correctly, rather than trading away that security property.
- **Express instead of Fastify** — more ubiquitous, slightly more battle-tested community middleware. Rejected in favor of Fastify's smaller official-plugin surface and schema-first request validation, which fits a learning project's "see the whole mechanism" goal better; both are reasonable choices and this is a low-stakes pick either way.

## Consequences

**Easier:**
- `apps/web` is now unambiguously frontend-only — matches the mental model the user actually wants (two independent backends, cms and api, both called over real HTTP).
- apps/api's commerce domain can evolve its own deploy/scale story independent of the Next.js frontend, same benefit ADR 0001 already called out for apps/cms.
- Forces confronting a second real distributed-systems problem (cross-origin cookies) deliberately, which is itself a learning goal.

**Harder / new tech debt accepted:**
- **CORS + credentials wiring**: every auth-related `fetch()` in `apps/web` must now set `credentials: "include"`; `apps/api` must echo back the specific origin (never `*`) with `Access-Control-Allow-Credentials: true`. Getting either side wrong silently breaks login (cookie just won't be sent/stored — no obvious error).
- **Production `SameSite` TBD**: this ADR's CORS approach is verified for local dev (same registrable domain, different ports). If `apps/web` and `apps/api` ever deploy to genuinely different registrable domains, cookie `SameSite` behavior needs revisiting (likely `SameSite=None; Secure`, with the CSRF implications that come with it). Not solved now — flagged so it isn't forgotten.
- **Third process to run locally**: `npm run dev` now starts three servers (cms, web, api) instead of two. `package.json`'s orchestration scripts need updating.
- **No Next.js route-handler conveniences in apps/api**: `NextResponse.json()`, automatic body parsing, etc. don't exist outside Next.js — Fastify's own equivalents (`reply.send()`, built-in JSON body parsing) are used instead. The existing route-handler tests (which call `POST`/`GET` functions directly with a `Request` object) don't translate 1:1 to Fastify's `(request, reply)` handler shape — tests need rewriting against Fastify's `.inject()` test helper, not just moved.
- **One more `.env` surface**: apps/api needs its own `DATABASE_URL`, and apps/web needs a new `API_URL` (mirroring `CMS_API_URL`) pointing at it.

## Related

- [ADR 0001](0001-monorepo-content-commerce-split.md) — the original content/commerce split this extends to a third app.
- [ADR 0003](0003-session-cookie-auth.md) — the session-cookie mechanism this ADR keeps unchanged, just relocates.
- [Spec 0002: Customers & Auth](../specs/0002-auth.md) — update pending to reflect the new app boundary and CORS/credentials notes.
- `apps/api/` (to be created) — Fastify app, commerce DB, auth routes.
- `apps/web/shared/cms/client.ts` — the existing precedent for "treat a sibling app as a third-party HTTP API," now mirrored by a new `apps/web/shared/api/client.ts` (or similar) for apps/api.
