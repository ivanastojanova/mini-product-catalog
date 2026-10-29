# Spec 0004: Checkout & Orders (state machine, stock reservation)

**Status:** Implemented and click-tested. Scope and all four former open questions were decided (see "Settled decisions"); all 12 build steps are done. See [PLAN.md](../PLAN.md) for the live checklist.

**Phase:** 4 — see [docs/PLAN.md](../PLAN.md) for live status/checklist.

**Related:** [Spec 0003](0003-cart.md) (the cart this consumes), [ADR 0004](../adr/0004-standalone-commerce-api-service.md) (commerce lives in `apps/api`), [ADR 0005](../adr/0005-cookie-presence-route-protection.md) (amended by Decision 6 below), [ADR 0006](../adr/0006-cookie-guest-cart-merged-on-login.md). Decision records: [ADR 0008](../adr/0008-cookie-bound-guest-orders.md) (guest checkout: cookie-bound guest orders, `/checkout` made public; written), [ADR 0007](../adr/0007-inventory-and-lazy-reservation-expiry.md) (inventory + reservation model; written).

## Context

The cart (Phase 3) stores `slug + quantity` and nothing else. There is no price, no stock, no order. Today's stock number comes from `apps/web/app/api/stock/[slug]/route.ts`, a deterministic fake derived from a hash of the slug. Phase 4 turns a cart into an **order**:

- prices are looked up from the CMS and **snapshotted** on the order,
- stock is real, lives in `apps/api`, and is **reserved** when the order is created so two shoppers can't buy the last unit,
- the order moves through an explicit **state machine**,
- the shopper can check out as a **guest** or logged in, and can see their order afterwards.

There is no payment yet. Phase 5 adds the mock gateway whose webhook drives `pending_payment → paid`. Phase 4 builds everything that transition needs (the reservation commit, the state machine) and a dev-only stand-in to trigger it.

## Settled scope (decided with the user)

| Question | Decision |
|---|---|
| Where does stock live? | A new `inventory` table in `apps/api`'s `commerce.db`. The CMS stays content-only (ADR 0001); reservation must be atomic with order creation, which it can't be across two services. |
| Reservation model | Reserve when the order is created, with a TTL. Commit on payment, release on cancel/expiry. |
| States | `pending_payment → paid → fulfilled`, plus `cancelled` and `expired`. |
| Shipping address | In scope: snapshotted on the order. |
| Guest checkout | In scope. |
| Order history page | In scope (`/account/orders`). |
| Expiry sweeper job | **Out.** Expiry is lazy (see Decision 3). |

## Decision 1 — Money

- Amounts are stored as **integer minor units** (`unit_price_cents`, `total_cents`), never floats. The CMS stores `price` as a plain `number` (euros), so the single conversion point is `toMinorUnits(price) = Math.round(price * 100)`, in a tested pure helper.
- One currency per order, taken from the CMS product's `currency`. If a cart mixes currencies, order creation is rejected (`409`). The seed data is all EUR, so this is a guard, not a feature.
- No shipping cost, tax or discounts: `total = Σ unit_price × quantity`.

## Decision 2 — Inventory

`inventory`
| column | type | notes |
|---|---|---|
| `product_slug` | text PK | slug, same key as the cart |
| `on_hand` | integer | physical units, not yet sold |
| `reserved` | integer | held by `pending_payment` orders |
| `updated_at` | integer (unix ts) | |
| | | `CHECK on_hand >= 0`, `CHECK reserved >= 0`, `CHECK reserved <= on_hand` |

- **available = on_hand − reserved.** A slug with no inventory row has 0 available.
- The `CHECK`s make overselling impossible even if application code is wrong: a bad write fails instead of corrupting the count.
- **Reserve** is a conditional update, not read-then-write:
  `UPDATE inventory SET reserved = reserved + :q WHERE product_slug = :s AND on_hand - reserved >= :q`. Zero rows changed means insufficient stock. This stays correct even if the DB ever stops being single-process (the synchronous `better-sqlite3` transaction from ADR 0006 is a second layer, not the only one).
- **Seeding:** `npm run db:seed-inventory --workspace=apps/api` reads every slug from the CMS and inserts a row (default `on_hand = 10`) for any slug that has none. It never overwrites an existing row. There is no stock editor in the CMS admin; changing stock means editing the DB (Drizzle Studio) until a later phase. *(Accepted cost of keeping stock out of the CMS.)*
- **`GET /stock/:slug`** (public) → `{ slug, inStock, quantity, updatedAt }` where `quantity` is *available*. Same shape as the current stub's `ProductStock`, so `ProductStock.tsx` doesn't change. The apps/web stub route is deleted and `features/products/api/stock.ts` calls apps/api through `apiFetch`. Runs the stale-order sweep first (Decision 3).

## Decision 3 — Orders, reservation and expiry

`orders`
| column | type | notes |
|---|---|---|
| `id` | integer PK autoincrement | internal only |
| `public_id` | text, unique | 16 random bytes, base64url. The only id that appears in URLs or API responses. Never a guessable integer. Not a credential on its own for guest orders (see Decision 6). |
| `customer_id` | integer, nullable, FK → customers | null for guest orders |
| `guest_token_hash` | text, nullable, **not unique** | SHA-256 of the browser's `order_token` cookie (Decision 6). Set for guest orders, null for customer orders. Not unique because one browser can place several orders over time. `CHECK` exactly one of `customer_id` / `guest_token_hash` is non-null (same pattern as `carts`). Indexed. |
| `contact_email` | text | customer's email, or the guest's. Snapshot. |
| `status` | text | `CHECK` in the five states |
| `currency` | text | |
| `total_cents` | integer | `CHECK >= 0` |
| `ship_name`, `ship_line1`, `ship_line2` (nullable), `ship_city`, `ship_postal_code`, `ship_country` | text | **Snapshot** of the address. Flat columns, not an `addresses` table, so editing an address later can never change a past order. |
| `idempotency_key` | text, unique | Client-generated UUID, globally unique. (A composite `UNIQUE (customer_id, key)` would not work: guests have a NULL `customer_id`, and SQLite treats NULLs as distinct.) A replay whose key matches an order belonging to a *different* owner (different customer, or different `order_token`) is rejected with `409`, never returned, so a key can't be used to read someone else's order. |
| `reservation_expires_at` | integer (unix ts) | set at creation; `created_at + RESERVATION_TTL` (15 min) |
| `created_at`, `updated_at`, `paid_at` (nullable) | integer | |

`order_items` — `(order_id, product_slug)` PK, `title`, `unit_price_cents`, `quantity` (`CHECK 1..MAX_LINE_QUANTITY`). The **price snapshot** lives here. `title` is snapshotted in the CMS default locale (English); order history therefore shows English names under `/de`. Accepted: a per-locale snapshot is not worth it yet.

`order_events` — `(id, order_id, from_status, to_status, reason, created_at)`. Append-only audit trail, one row per transition (and one for creation with `from_status` null). Cheap, and the first place to look when debugging a Phase 5 webhook.

**Reservations have no table of their own.** The reserved quantities *are* the order's `order_items`. Releasing means "subtract each item's quantity from `inventory.reserved`" and is only ever done as part of the same transaction that moves the order out of `pending_payment`. Because the status change is conditional (`UPDATE orders SET status = :to WHERE id = :id AND status = 'pending_payment'`, and we release only if one row changed), **a reservation can be released at most once**, no matter how many times cancel/expire/pay is replayed or raced.

### Expiry is lazy (no background job)

`expireStaleOrders()` finds `pending_payment` orders with `reservation_expires_at <= now`, and for each runs the `→ expired` transition (release included). It runs, inside the request, at the start of: `GET /stock/:slug`, `GET /checkout/preview`, `POST /orders`, and any order read/cancel/pay. Stale reservations therefore never count against availability, because the sweep always happens *before* availability is read.

Tradeoff: a read path performs writes, and an order nobody looks at stays `pending_payment` in the DB past its deadline until the next request triggers the sweep. Nothing user-visible depends on the stored status being fresh, because every read sweeps first. A real deploy would add a scheduled job; that is explicitly deferred.

## Decision 4 — State machine

```
pending_payment ──pay──────▶ paid ──fulfil──▶ fulfilled
      │
      ├──cancel──▶ cancelled
      └──expire──▶ expired
```

`cancelled`, `expired` and `fulfilled` are terminal. `paid → refunded` is deferred (no refund flow exists).

- One pure function in `apps/api/src/orders/lib/orderStateMachine.ts`: `transition(from, event) → to`, throwing `IllegalTransitionError` for anything not in the table above. No DB access, so it is exhaustively testable (every state × every event).
- A second layer, `applyTransition` (DB), is the **only** code allowed to write `orders.status`. In one transaction it: runs the conditional status update, appends an `order_events` row, and applies the inventory side effect for that edge:

| edge | inventory effect |
|---|---|
| `pending_payment → paid` | `reserved −= q` **and** `on_hand −= q` (the reservation becomes a sale) |
| `pending_payment → cancelled / expired` | `reserved −= q` |
| `paid → fulfilled` | none (stock already left on payment) |

- Replaying an edge that has already happened is a no-op that reports "already in that state" rather than an error, so Phase 5's webhook retries are safe. Moving to a *different* state from a terminal one is an `IllegalTransitionError`.
- `fulfilled` has no endpoint in Phase 4 (there is no admin UI for it). It exists in the machine and is covered by tests.

## Decision 5 — Creating an order

**`GET /checkout/preview`** (guest or customer, cart resolved with `resolveCart`) → the cart priced *as an order would be*: `{ currency, items: [{ slug, title, unitPriceCents, quantity, lineTotalCents, available, problem? }], subtotalCents }`, where `problem` is `"unknown_product"` or `"insufficient_stock"`. The checkout page renders this, so the number the shopper reviews and the number we charge come from the same code. Titles follow a `?locale=` param for display (not snapshotted; see above).

**`POST /orders`**, header `Idempotency-Key: <uuid>`, body `{ shippingAddress, email? }` (`email` required for guests, ignored for customers, whose account email is used).

1. Resolve the cart. Empty or no cart → `409 { code: "empty_cart" }`.
2. Look up all cart slugs in the CMS in **one** request (`where[slug][in]`), outside the DB transaction because `better-sqlite3` transactions must not span an `await`. CMS unreachable → `502`; the cart is untouched.
3. Any slug the CMS doesn't return → `409 { code: "unavailable_items", items: [...] }`. **Reject, don't silently drop**: the shopper must see that something they expected is not being bought (this is the Phase 3 "orphaned slug" follow-up). The checkout page offers to remove those lines.
4. One synchronous transaction:
   1. `expireStaleOrders()`.
   2. Idempotency check: an existing order with this key and the same owner → return it (`200`), reserving nothing. Same key, different owner → `409`.
   3. Reserve each line with the conditional update above. Any line failing → roll back everything, `409 { code: "insufficient_stock", items: [...] }`. All-or-nothing, so a half-reserved order never exists.
   4. Insert `orders` (`pending_payment`, expiry = now + 15 min) with the price/address snapshot, `order_items`, and the creation `order_events` row. For a guest, the order's `guest_token_hash` is the hash of the browser's existing `order_token` cookie, or of a freshly generated one (set on the response, see Decision 6).
   5. **Delete the cart's lines** (the cart row stays, so a guest's cart cookie remains valid).
5. `201 { order }`.

Prices are re-read from the CMS here, never taken from the client or from the preview. A price changing between preview and submit is possible; the order uses the new price and the confirmation page shows it (settled: no `price_changed` rejection).

**One open order per owner:** creating an order while the same customer (or the same guest `order_token`) already has a `pending_payment` order is `409 { code: "open_order", orderPublicId }`. Without this, one shopper (or script) could reserve all stock by creating orders repeatedly. They must pay for or cancel the open one first. It does not stop a script that discards its cookies or mints many guest carts; that is rate limiting, deferred (Out of scope).

### Cancel

`POST /orders/:publicId/cancel` (no body, so no JSON content-type; same bodiless-request rule as the cart) → `pending_payment → cancelled`, releasing the reservation. Anything else → `409`. The cart is **not** restored (settled: lines were deleted at order creation, the shopper re-adds).

## Decision 6 — Who can see an order (and the ADR 0005 amendment)

Guest checkout means `/checkout` can no longer require a session.

- **apps/web:** remove `"checkout"` from `PROTECTED_SEGMENTS` in `routeProtection.ts` and update its test. `/account` stays protected. ADR 0005's text said `/checkout/*` would be protected; ADR 0008 records that this is reversed and why.
- **apps/api authorization (the part that actually enforces anything):**
  - **Customer orders:** readable/cancellable only with a valid session whose customer owns the order. Anyone else gets `404` (not `403`, so existence isn't leaked).
  - **Guest orders:** readable/cancellable only by the browser that placed them. `apps/api` sets an httpOnly `order_token` cookie (32 random bytes, same options as the session/cart cookies, 30 days, refreshed whenever an order is read or created). The DB stores only its SHA-256 hash in `orders.guest_token_hash`, reusing `generateSessionToken`/`hashSessionToken`. An order request is authorized when `hash(order_token cookie) = order.guest_token_hash`. The `public_id` in the URL is only a lookup key: knowing it without the cookie gets `404`.
  - One browser keeps one `order_token` for all its guest orders (a second guest order reuses the cookie rather than minting a new one), so they all stay reachable from that browser.
  - A valid session takes precedence: a logged-in customer is authorized only for orders with their `customer_id`, and their `order_token` cookie, if present, is ignored (same rule as `cart_token`, ADR 0006). A logged-out browser is authorized only through the cookie.
  - `GET /orders` (history) is customer-only (`401` without a session). Guests have no list; they reach an order via its page in the same browser.
- **Consequences of binding guest orders to the browser (settled, 3b):** the confirmation link can't be shared, reopened on another device, or recovered after the cookie is cleared or expires (30 days of inactivity). There is no email sending in this project to resend it. Accepted: the trade for not having the URL alone grant access to a name and address. Because the URL is no longer a credential, no `Referrer-Policy` special-casing is needed.
- Guest orders are **not** attached to an account when the guest later registers or logs in, with the same email or otherwise (that would let anyone claim another person's orders by typing their email, and the cookie-bound model has no safe basis to do it). The order remains viewable from that browser only while logged out; once logged in, the session takes precedence and the guest order is invisible. Out of scope; flagged as a known gap.

## Endpoints summary

| route | auth | behavior |
|---|---|---|
| `GET /stock/:slug` | public | available quantity (sweeps expired orders first) |
| `GET /checkout/preview` | cart owner | priced cart + per-line problems |
| `POST /orders` | cart owner | create order + reserve stock (idempotent via header) |
| `GET /orders` | customer | their orders, newest first |
| `GET /orders/:publicId` | owning customer, or the guest browser holding the matching `order_token` | order detail with items, address, status |
| `POST /orders/:publicId/cancel` | same | release reservation |
| `POST /dev/orders/:publicId/simulate-payment` | same; **only when `NODE_ENV !== "production"`** | `pending_payment → paid`. Stand-in for Phase 5; deleted then. |

## apps/web changes

- **New modules**, per AGENTS.md: `features/checkout/` (preview + create-order api/hooks, `CheckoutForm`, `CheckoutView`) and `features/orders/` (api, hooks, `OrderView`, `OrdersList`, status badge, order query keys, types). Copy is hand-rolled EN/DE dictionaries co-located in the components, as elsewhere.
- **Pages:** `/[lang]/checkout`, `/[lang]/orders/[publicId]`, `/[lang]/account/orders`. `params` is awaited as everywhere in Next 16.
- **No cart page exists until Phase 6**, so the checkout page *is* the cart review: it renders `GET /checkout/preview`. A "Checkout" link goes in the header so the flow is reachable by clicking.
- The `Idempotency-Key` is a `crypto.randomUUID()` created when the form mounts and reused for retries of that attempt, so a double click or a retry after a network error can't create two orders.
- On order success: invalidate the cart, stock and orders queries; navigate to the order page.
- Delete `app/api/stock/[slug]/route.ts`.
- Forms use the existing `Form`/`Field`/`Input` primitives (spec 0002).
- Price formatting: a pure `formatMoney(cents, currency, locale)` helper with a test.

## Testing requirements (money- and stock-critical, tests ship with the code)

All in `apps/api` against an in-memory migrated DB with a mocked CMS client, matching Phase 3.

- **State machine:** every (state × event) pair, legal and illegal. Terminal states have no outgoing edge.
- **applyTransition:** each edge's inventory effect; replaying an edge is a no-op and does *not* release or commit twice; an illegal edge changes nothing (status, inventory, events).
- **Inventory invariants:** `reserved` never negative and never above `on_hand`; the `CHECK`s reject a bad write.
- **Reservation:** reserving the last unit succeeds once; **two orders racing for the last unit → exactly one succeeds**; a multi-line order where line 2 is short rolls back line 1's reservation.
- **Expiry:** an order past its deadline is expired and its stock released by the next stock read / order create; an order before its deadline is untouched; sweeping twice releases once.
- **Pricing:** the CMS price at creation is stored; a later CMS price change doesn't alter the order; mixed currencies rejected; `toMinorUnits` rounding cases (e.g. `19.99`, `0.1 + 0.2` style float values).
- **Create-order flow:** empty cart, unknown slug, CMS down (502, cart untouched, no reservation), idempotent replay returns the same order and reserves once, open-order guard, cart lines cleared on success but cart row/cookie kept.
- **Authorization:** customer A can't read or cancel customer B's order (404); a guest order is 404 without the cookie, with a different guest's cookie, and when requested by a logged-in customer; the right cookie works; a second guest order reuses the same `order_token`; only the hash of the token is stored; a customer's order can't be opened with a guest cookie; `GET /orders` without a session is 401; the dev pay route is absent in production.
- **apps/web:** `routeProtection` test updated (`/checkout` now public, `/account` still protected); `formatMoney`; create-order hook/option factory tests as with `addToCartMutation`.
- Mutation-check the riskiest ones as in Phase 3 (drop the conditional `WHERE` on reserve, release without the status guard, skip the sweep before the availability read, price from the client).
- **Manual browser click-through:** as a guest: add items → checkout → order created → stock on the product page drops → copy the order URL into a private window and confirm it 404s → cancel → stock returns. As a customer: same, then `/account/orders` lists it. Two browsers racing for the last unit. Let a reservation expire (dev TTL override) and see stock return.

## Out of scope

- Real payment, webhooks, idempotency of payment events (Phase 5). Only the dev stand-in exists.
- Refunds, `refunded` state, fulfilment UI/admin (the `fulfilled` edge exists but nothing calls it).
- Shipping cost, tax, discounts, multiple currencies in one order.
- Saved addresses / address book, address validation beyond "required, bounded length, 2-letter country".
- Email confirmations (no mail infrastructure).
- A scheduled expiry job; rate limiting on order creation; cleanup of old orders.
- Restoring the cart after cancel/expiry.
- Cart page / mini-cart (Phase 6).
- Attaching guest orders to a later account; recovering a guest order after the cookie is lost.

## Settled decisions

1. **Cart after cancel/expiry: not restored.** Lines are deleted at order creation and the order is the record. Rejected: keeping lines until paid, which needs a rule for a cart edited while an order is open.
2. **Price drift: use the current CMS price and show it** on the confirmation page. Rejected: sending the expected total and returning `409 price_changed`. Safer for the shopper, but one more state to build and test.
3. **Guest order access: link + `order_token` cookie.** Only the browser that placed a guest order can view or cancel it; the order URL alone is not enough. Rejected: link-only access, which would let the long random URL work on any device and be shared. Cost accepted: no recovery from another device or after the cookie is lost, and no later attachment to an account.
4. **Defaults: seed stock of 10 per product, 15-minute reservation TTL.** Both are constants; the TTL is overridable via an env var in dev so expiry is easy to click-test.

## Build order (one small piece at a time, each runnable before the next)

1. `toMinorUnits` + `orderStateMachine` (pure) + tests.
2. Schema + migration (`inventory`, `orders`, `order_items`, `order_events`) with the `CHECK`s; inspect in Drizzle Studio.
3. Inventory: `reserve`/`release`/`commit` repo functions + invariant and race tests; seed script; `GET /stock/:slug`; point apps/web's stock at it and delete the stub. *(First clickable result: the product page shows real stock.)*
4. `applyTransition` + `expireStaleOrders` + tests.
5. CMS batch lookup + `GET /checkout/preview` + tests.
6. `POST /orders` (+ idempotency, open-order guard, cart clearing) + tests.
7. `GET /orders`, `GET /orders/:publicId`, cancel, authorization tests.
8. Dev `simulate-payment` route.
9. apps/web: drop `checkout` from protected segments, `formatMoney`, checkout page + header link.
10. Order confirmation page, then order history page.
11. Browser click-through (both flows, the race, expiry).
12. ADR 0007, ADR 0008; update PLAN.md and the README roadmap.
