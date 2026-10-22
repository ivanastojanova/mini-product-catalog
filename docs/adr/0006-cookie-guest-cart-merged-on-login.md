# ADR 0006: Guest carts identified by a cookie token, merged server-side on login

**Status:** Accepted

**Date:** 2026-10-22

## Context

Phase 3 needs a persistent cart for shoppers who haven't signed in, and for those who have. Three questions had real tradeoffs: how an anonymous browser is identified, what happens to its cart when it logs in, and where the cart lives now that the placeholder in `apps/web/app/api/cart` (one in-memory map shared by every visitor) is going away. Builds on [ADR 0003](0003-session-cookie-auth.md) (session cookies), [ADR 0004](0004-standalone-commerce-api-service.md) (commerce lives in `apps/api`) and [ADR 0005](0005-cookie-presence-route-protection.md) (every apps/api endpoint verifies identity itself). Full design in [spec 0003](../specs/0003-cart.md).

## Decision

1. **Guest identity:** `apps/api` sets an httpOnly `cart_token` cookie (32 random bytes, same options as the session cookie, 30 days, refreshed on every write). The database stores only its SHA-256 hash, reusing the session token helpers. The cart row is created lazily on the first add, never on a read.
2. **One cart per owner:** a `carts` row belongs to exactly one of a customer or a guest token hash, enforced by a `CHECK` constraint. Lines are `(cart, product slug, quantity)` with a `1..10` `CHECK`. No prices are stored; they are looked up from the CMS and snapshotted by Phase 4 when an order is created.
3. **Who a request belongs to:** a valid session always wins over a `cart_token` cookie. The cookie is only consumed by the login merge.
4. **Merge on login/register, inside the handler:** after credentials are verified, one transaction either adopts the guest cart (the customer has none, which is always true at register) or sums quantities per slug capped at 10 and deletes the guest cart. The `cart_token` cookie is then cleared. A failed login or rejected registration never touches the guest cart.
5. **A merge failure never blocks sign-in.** It is logged, the transaction rolls back, and the cookie stays so the next login retries.
6. **Slugs are validated against apps/cms on add** (404 unknown, 502 if the CMS can't be reached). `PUT` and the merge do not re-validate.
7. **The cart lives in `apps/api`** and apps/web calls it cross-origin through a shared `shared/api/client.ts`. Stock is not enforced in the cart (Phase 4).

## Alternatives considered

- **Client-triggered `POST /cart/merge` after login** — two round trips, with a window where the client is logged in but unmerged, and it can be skipped or fail halfway. The in-handler merge makes it impossible to log in without the merge being attempted.
- **Cart in `localStorage`, synced on login** — no server state for guests, but it is invisible to the server, can be edited by the client, and can't survive a cleared browser. It also doesn't fit a cart that Phase 4 must price and check out server-side.
- **Cart keyed by a guessable integer id in the cookie** — an enumerable bearer credential. A random token hashed at rest costs almost nothing extra because the helpers already existed and were tested.
- **Raw token stored in the DB** — simpler, but a database leak would hand out working cart cookies. Hashing was chosen even though cart contents are low-sensitivity.
- **Customer's cart wins / guest cart wins on conflict** — the first makes items appear to vanish, the second clobbers a saved cart. Sum-and-cap loses nothing the shopper added.
- **Fail the login if the merge fails** — loud, but punishes the shopper for a problem they can't fix. A retry on the next login is cheap because the cookie is preserved.
- **Trust slugs now, validate at checkout** — no runtime dependency on the CMS, but the cart could hold junk lines from direct API calls.

## Consequences

**Easier:**
- A shopper's cart survives restarts, reloads and devices once logged in, and a guest's survives reloads.
- The merge is all-or-nothing and replay-safe, so two tabs logging in at once merge exactly once.
- Phase 4 gets a server-side cart keyed by customer with no rework.

**Harder / accepted debt:**
- **Merge atomicity depends on `better-sqlite3`'s synchronous transactions.** Within one process two logins can't interleave. A multi-process deploy or a move to Postgres would need row locking or a unique-constraint retry instead.
- **Cart adds depend on apps/cms being reachable** (502 otherwise). Browsing and reading the cart do not.
- **Slugs, not ids:** a slug renamed in the CMS orphans cart lines. Nothing cleans them up yet; Phase 4 should reject or drop unknown lines at checkout.
- **A failed merge leaves the shopper signed in with a cart missing their guest items** until the next login.
- **Expired guest carts are only treated as absent on lookup.** Nothing deletes the rows (same lazy approach as expired sessions).
- **Production cookie scope:** `SameSite=Lax` and the shared-`localhost` assumption carry over from ADR 0004. If apps/web and apps/api end up on different registrable domains, `cart_token` breaks the same way the session cookie would.
- **Per-line cap duplicated** in `apps/web/features/cart/lib/cartMath.ts` (it only keeps the optimistic UI from showing a number the server would clamp). apps/api is the authority.
- **Cart UI is only the product-page button.** The cart page and mini-cart are Phase 6, so the merged cart can only be seen as "N in cart" on product pages.

## Related

- [Spec 0003](../specs/0003-cart.md), [ADR 0003](0003-session-cookie-auth.md), [ADR 0004](0004-standalone-commerce-api-service.md), [ADR 0005](0005-cookie-presence-route-protection.md)
- `apps/api/src/cart/lib/resolveCart.ts`, `mergeGuestCart.ts`, `mergeOnAuth.ts`, `apps/api/src/cart/routes/cart.ts`, `apps/api/src/db/schema.ts`
- `apps/web/features/cart/`, `apps/web/shared/api/client.ts`
