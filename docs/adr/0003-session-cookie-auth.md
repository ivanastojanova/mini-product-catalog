# ADR 0003: Session-cookie auth instead of JWT

**Status:** Accepted

**Date:** 2026-10-13

## Context

Phase 2 needs real customer accounts in apps/web (register/login/logout), decoupled from Payload's admin-only `Users` collection in apps/cms (see [ADR 0001](0001-monorepo-content-commerce-split.md) for the content/commerce split rationale). The original rough plan assumed "hand-rolled JWT, httpOnly cookies, refresh rotation" without re-examining whether JWT was actually the right primitive for this architecture.

JWT's core value proposition is **stateless verification**: a service can confirm who someone is by checking a cryptographic signature, without calling back to whichever service issued the token. That property matters when multiple independent services each need to verify identity on their own.

## Decision

Use a traditional **session cookie + database table**, not JWT. The cookie holds a random opaque token; the server looks up a `sessions` row (keyed by a SHA-256 hash of that token, not the raw value) to resolve identity. See [spec 0002-auth.md](../specs/0002-auth.md) for the full schema and flows.

The deciding question: **who, in this architecture, actually needs to verify a customer's identity?** Only apps/web. apps/cms never sees a customer token — its `Users` collection exists purely to gate the Payload admin dashboard and is unrelated to commerce auth. With only one verifier, JWT's headline advantage (skip the callback to the issuer) is moot — there's no second service to skip a callback *to*.

## Alternatives considered

- **JWT (access + refresh token rotation)** — the originally planned approach. Rejected because: (1) its main benefit doesn't apply with a single verifying service, (2) revocation is structurally awkward (a JWT stays valid until expiry unless you maintain a blocklist, which reintroduces the statefulness JWT was meant to avoid), (3) more moving parts to build correctly (signing, verifying, refresh rotation, clock skew, deciding where the refresh token itself lives) for no concrete gain in this app's shape. Still worth learning the mechanics elsewhere — just not structurally justified here.
- **NextAuth** — rejected for this learning project because it brings a provider abstraction aimed at generic/multi-provider auth (OAuth, magic links, etc.) that this app doesn't need, and would hide the mechanics we're trying to understand hands-on.
- **Payload's built-in auth** — rejected because Payload's auth lives in apps/cms, and customers are a commerce-domain concept that must stay in apps/web per the content/commerce split. Reaching into Payload for customer auth would re-couple the two domains that ADR 0001 deliberately separated.

## Consequences

**Easier:**
- Revocation is trivial — delete the `sessions` row. No blocklist, no waiting for expiry.
- Verification cost is a single indexed DB lookup, not meaningfully worse than a signature check for this app's scale.
- One fewer secret-management concern (no signing key to rotate/protect) — the only secret is whatever hashes the session token, and that's a standard library hash, not a shared-secret signing key.
- The threat model is simpler to reason about: a leaked `sessions` table alone doesn't grant access (it stores hashes), and a leaked cookie alone is useless without the matching DB row still existing and being unexpired.

**Harder / tradeoffs:**
- Every authenticated request costs one DB read (acceptable here — this is a single small SQLite file on the same host as apps/web, not a network hop to a separate auth service).
- Doesn't generalize to a future multi-service architecture without rework — if apps/cms (or some future service) ever needed to independently verify a customer's identity without calling apps/web, this design would need to change. Not a concern today; flagged here so it isn't forgotten if that changes.
- No built-in "stateless scale-out" story — fine at this project's scale, would need revisiting (e.g. a shared session store) if apps/web ever ran as multiple horizontally-scaled instances behind a load balancer without a shared DB. (In practice the DB is already shared, so this is a non-issue even then — noted for completeness.)

## Related

- [Spec 0002: Customers & Auth](../specs/0002-auth.md) — full schema, request flows, open questions.
- [ADR 0001](0001-monorepo-content-commerce-split.md) — why customers live in apps/web, not apps/cms.
- `apps/web/shared/db/schema.ts` — `customers` and `sessions` table definitions.
- `apps/web/features/auth/lib/password.ts` — bcrypt hashing (cost factor 12), the companion decision to this one.
