# ADR 0005: Route protection in `proxy.ts` checks cookie presence only

**Status:** Accepted

**Date:** 2026-10-21

## Context

Phase 2 needs `/account` (and later `/checkout`) to be unreachable for logged-out visitors. The natural place is `apps/web/proxy.ts`, which runs before every page render. The open question (flagged in [spec 0002](../specs/0002-auth.md)) was how the proxy decides someone is logged in. Session validity lives in `apps/api` ([ADR 0004](0004-standalone-commerce-api-service.md)): the `sessions` table is the only authority on whether a cookie is real and unexpired.

Browsers scope cookies by host, not port, so the `session` cookie set by `apps/api` on `localhost:4000` is also sent to `localhost:3000`, and the proxy can read it. That only holds while both apps share a registrable domain (see the production `SameSite` TBD in ADR 0004).

A second conflict: `/account` originally hosted the register/login forms, so protecting it would have redirected logged-out users away from the only place to log in.

## Decision

1. **The proxy checks only that a `session` cookie is present.** If it's missing on a protected path (`/{locale}/account`, `/{locale}/checkout/*`), redirect to `/{locale}/login`. No network call to `apps/api`. The logic is a pure function, `getLoginRedirect` in `apps/web/features/auth/lib/routeProtection.ts`, with unit tests.
2. **This is a UX redirect, not enforcement.** A stale, expired, or forged cookie passes the proxy. It is caught by (a) `apps/api` returning 401 / `{ customer: null }` for anything that matters (cart, orders, payments in later phases), and (b) the client-side `useSession` check in `AccountView`, which redirects to `/login` when no customer comes back.
3. **Split the pages:** `/{locale}/login` hosts the login/register forms (and redirects to `/account` if already logged in); `/{locale}/account` is logged-in only.

The cookie name is duplicated in `apps/web` (like the locale list) rather than imported from `apps/api`, since the apps are separate deploys.

## Alternatives considered

- **Call `apps/api` `GET /auth/session` from the proxy on protected paths** — authoritative, but adds a network hop to every protected navigation, and `apps/api` being down would break those routes entirely. Not worth it when real enforcement has to live in `apps/api` anyway: a proxy can be bypassed by calling the API directly.
- **Keep `/account` public as the combined login/account page, protect only `/checkout`** — less work, but route protection couldn't be click-tested until Phase 4.
- **Shared signed/verifiable cookie the proxy can validate locally (e.g. JWT)** — would allow stateless verification in the proxy, but reverses ADR 0003's reasoning for DB-backed sessions (instant revocation, no signing/rotation complexity).

## Consequences

- Protected pages cost no extra latency and still redirect when `apps/api` is down.
- A user with a junk or expired cookie briefly gets the protected page shell (loading skeletons) before the client check redirects them. No customer data is exposed, because it all comes from `apps/api`.
- Every future protected API in `apps/api` must verify the session itself. Never rely on the proxy.
- If `apps/web` and `apps/api` move to different registrable domains, the proxy will no longer see the cookie and this needs redesigning alongside the `SameSite` TBD.
- Adding a protected area means adding its segment to `PROTECTED_SEGMENTS` and a test.

## Related

- [ADR 0003](0003-session-cookie-auth.md), [ADR 0004](0004-standalone-commerce-api-service.md)
- [Spec 0002](../specs/0002-auth.md)
- `apps/web/proxy.ts`, `apps/web/features/auth/lib/routeProtection.ts`
