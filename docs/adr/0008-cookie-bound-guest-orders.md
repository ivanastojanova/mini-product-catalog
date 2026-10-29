# ADR 0008: Guest orders bound to the placing browser by cookie; `/checkout` made public

**Status:** Accepted (email-link access is a planned follow-up, not yet decided; see "Planned follow-up")

**Date:** 2026-10-28

## Context

Phase 4 lets a shopper check out without an account. That raises two questions with real tradeoffs: who is allowed to read or cancel a guest's order, and whether `/checkout` can stay behind the login redirect that [ADR 0005](0005-cookie-presence-route-protection.md) planned for it. Full design in [spec 0004](../specs/0004-checkout.md), Decision 6.

An order holds a name, an address and an email, so the order URL must not hand those to whoever sees it. The project also has no email infrastructure, so there is no way to send a guest a recovery link. Builds on [ADR 0006](0006-cookie-guest-cart-merged-on-login.md) (cookie-identified guests, hashed at rest) and [ADR 0004](0004-standalone-commerce-api-service.md) (apps/api enforces authorization).

## Decision

1. **Guest orders are bound to the browser that placed them.** apps/api sets an httpOnly `order_token` cookie (32 random bytes, 30 days, refreshed when an order is read or created). The database stores only its SHA-256 hash in `orders.guest_token_hash`. A request is authorized when the hash of the cookie equals the order's hash. The `public_id` in the URL is a lookup key, not a credential.
2. **One `order_token` per browser**, reused across that browser's guest orders.
3. **A valid session beats the cookie.** A logged-in customer is authorized only for orders with their `customer_id`; their `order_token` is ignored (same rule as `cart_token`).
4. **Not found and not yours are both `404`**, so an order's existence isn't revealed.
5. **`GET /orders` (history) is customer-only.** Guests have no list.
6. **Guest orders are never attached to an account later**, with the same email or otherwise.
7. **`checkout` is removed from `PROTECTED_SEGMENTS`** in apps/web's `routeProtection.ts`. `/account` (and so `/account/orders`) stays protected. This reverses the part of ADR 0005 that listed `/{locale}/checkout/*` as protected. Real enforcement was always in apps/api, so the redirect was only a UX layer.

## Alternatives considered

- **Link-only access (the URL, or a per-order token in it, is the credential)** — works from any device and allows sharing. But the URL then grants a name and address to anyone who sees it (history, logs, `Referer`, a forwarded message), which needs masking and `Referrer-Policy` handling, and there is no email to deliver the link safely anyway.
- **Link plus cookie, and nothing else** — what this ADR chose.
- **Look up by email plus order id** — the email is guessable and unverified, so it proves nothing without a mailbox round trip.
- **Attach guest orders to an account on register or login by matching email** — would let anyone claim another person's orders by typing their email. The cookie-bound model has no safe basis for it.
- **Keep `/checkout` login-protected** — simplest, but contradicts guest checkout being in scope.
- **Raw token in the DB** — a database leak would hand out working order cookies. Hashing costs nothing because the helpers already existed.

## Consequences

**Easier:**
- A leaked or shared order URL exposes nothing. No masking or referrer special-casing is needed.
- Authorization lives in one place (`resolveRequester` + `findOwnedOrderId`) and is covered by tests for every non-owner case.

**Harder / accepted debt:**
- **No cross-device access for guests.** Opening the order URL on another device, in a private window, or after clearing cookies gives a `404`. A guest who loses the cookie cannot get back to their order or its status.
- **A guest who registers afterwards loses sight of earlier guest orders**, because the session takes precedence over the cookie.
- **No sharing a guest order for someone else to pay.**
- **Cancel and pay depend on the same cookie**, so they cannot be done from another device either.
- **ADR 0005 is partly out of date.** Its text still lists `/checkout/*` as protected. It is left unchanged (ADRs are frozen); this ADR is the correction.
- **Lost first response:** a lost first response can leave a guest with `409 key_conflict` on retry until their hold expires (see PLAN, step 6).

## Planned follow-up: emailed order link

Email sending is intended for a later phase. When it exists, a guest should be able to reach a read-only order summary from any device through a link in the confirmation email. That is a separate decision and will get its own ADR; what is recorded here is the direction and the constraints that keep it compatible with this ADR.

Direction (not yet decided):
- A **separate per-order token**, not the `order_token` cookie. The cookie remains "this browser placed it"; the emailed token means "this mailbox received it".
- **Stored hashed** in its own table (for example `order_access_links(order_id, token_hash, created_at)`), so tokens can be rotated or revoked without touching `orders`. Because a hash can't be read back, the code that sends the email must be the code that mints the token. A "resend my link" action mints a new token and emails it to `contact_email`.
- **View-only.** Cancel and pay keep requiring the cookie or a session.
- **Masked name and address** on the link view, since an email can be forwarded or misdirected. The cookie holder and the logged-in owner keep the full view.
- **Sent after payment**, not at order creation, to limit the damage of a mistyped address.
- **Leak hygiene:** `Referrer-Policy: no-referrer` on the page, and optionally exchanging the token for a cookie on first visit and redirecting to a clean URL.
- **Long-lived or non-expiring** for viewing a receipt; the 15-minute limit applies to the stock hold only.
- **Rate limiting** on the token lookup route, as defense in depth.

Open questions for that ADR: link lifetime, whether a link visit should offer to attach the order to an account, and whether the exchange-for-cookie step is worth its complexity.

Nothing built in Phase 4 blocks this. `contact_email` is already snapshotted on every order, and `resolveRequester` is the one place a third authorization path would be added.

## Related

- [Spec 0004](../specs/0004-checkout.md) (Decision 6, settled decision 3), [ADR 0004](0004-standalone-commerce-api-service.md), [ADR 0005](0005-cookie-presence-route-protection.md), [ADR 0006](0006-cookie-guest-cart-merged-on-login.md)
- `apps/api/src/orders/lib/resolveRequester.ts`, `ownedOrder.ts`, `orderOwner.ts`, `orderConfig.ts`
- `apps/web/features/auth/lib/routeProtection.ts`
