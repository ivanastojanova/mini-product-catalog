# ADR 0007: Inventory in apps/api, reserve-at-order with lazy expiry, and a single writer for order status

**Status:** Accepted

**Date:** 2026-10-28

## Context

Phase 4 turns a cart into an order, and two shoppers must not be able to buy the last unit. Until now stock was a deterministic fake in `apps/web/app/api/stock/[slug]/route.ts`. Making it real raises four questions with real tradeoffs: where stock lives, when it is claimed, how a claim that is never paid for gets released, and how order status changes stay consistent with stock. Full design in [spec 0004](../specs/0004-checkout.md) (Decisions 2–4).

Constraints: the CMS is content-only ([ADR 0001](0001-monorepo-content-commerce-split.md)); commerce data lives in apps/api's SQLite file ([ADR 0004](0004-standalone-commerce-api-service.md)); `better-sqlite3` transactions are synchronous and must not span an `await` ([ADR 0006](0006-cookie-guest-cart-merged-on-login.md)); there is no job runner or queue in the project; Phase 5 will add a payment webhook that can be retried or arrive late.

## Decision

1. **Stock lives in an `inventory` table in apps/api** (`product_slug`, `on_hand`, `reserved`), not in the CMS. `available = on_hand − reserved`. A slug with no row has 0 available. `CHECK`s (`on_hand >= 0`, `reserved >= 0`, `reserved <= on_hand`) make overselling a failed write rather than a corrupted count.
2. **Reserve when the order is created**, not when an item is added to the cart and not at payment. The reservation has a TTL (default 15 minutes, `RESERVATION_TTL_SECONDS` overrides it in dev). Payment *commits* it (`reserved −= q`, `on_hand −= q`); cancel or expiry *releases* it (`reserved −= q`).
3. **Reserving is a conditional update**, not read-then-write: `UPDATE inventory SET reserved = reserved + :q WHERE product_slug = :s AND on_hand - reserved >= :q`. Zero rows changed means insufficient stock. All lines of an order are reserved in one transaction, so a short line rolls back the others.
4. **Reservations have no table of their own.** The reserved quantities are the order's `order_items`. A release subtracts those quantities, and only ever happens in the same transaction that moves the order out of `pending_payment`.
5. **Expiry is lazy.** There is no sweeper job. `expireStaleOrders` runs inside the request, before availability is read, in `GET /stock/:slug`, `GET /checkout/preview`, `POST /orders`, and every order read, cancel and pay.
6. **`applyTransition` is the only code that writes `orders.status`.** In one transaction it does a conditional status update (`WHERE status = <expected from-state>`), applies that edge's inventory effect, and appends an `order_events` row. The pure `orderStateMachine` decides which edges are legal; `applyTransition` only runs legal ones. Replaying an edge that already happened returns "already" instead of acting twice or throwing.
7. **One open order per owner** (customer, or guest `order_token`). A second `POST /orders` while one is `pending_payment` is `409 open_order`.
8. **Money is integer cents**, converted once with `toMinorUnits` when a CMS price is read.

## Alternatives considered

- **Stock in the CMS** — one place for editors, but a reservation then has to be atomic across two services over HTTP, which it cannot be. It also puts a high-write counter into a content system. Cost of not doing this: there is no stock editor; changing stock means editing the DB (Drizzle Studio) until a later phase.
- **Reserve on add-to-cart** — shoppers could hold stock indefinitely by leaving items in a cart, and the cart would need its own TTL and release path. The cart was deliberately kept free of stock rules in Phase 3.
- **Reserve only at payment (no hold)** — simplest, but a shopper can fill in an address and then be told the item is gone at the last step, and Phase 5's webhook would be the place that discovers overselling, after money has moved.
- **Decrement stock at order creation, no `reserved` column** — one number instead of two, but an abandoned order then needs a separate "put it back" path with no record of how much, and `paid` cannot be told apart from "held".
- **Read availability, then write** — the classic race: two requests both see 1 unit and both reserve it. The conditional `WHERE` is correct on its own, even if the database ever stops being single-process; the synchronous transaction is a second layer, not the only one.
- **A background sweeper (cron or interval) for expiry** — the realistic production answer, but it adds a scheduler, its own failure mode (a dead job means held stock never returns) and a dev setup step. Lazy expiry is correct without it because the sweep always precedes the availability read.
- **A `reservations` table** — duplicates `order_items`, and two sources of truth can drift apart.
- **Letting routes update `orders.status` directly** — each route would need to remember the stock effect and the audit row. A single writer makes "release at most once" a property of one function rather than a convention.
- **Floats for money** — rejected; `0.1 + 0.2` style errors are unacceptable on totals.

## Consequences

**Easier:**
- Oversell is prevented at three levels: the conditional update, the transaction, and the `CHECK`s. Tests try to break each one (the last-unit race, all-or-nothing rollback, every `CHECK`), and mutation checks confirmed that removing the conditional `WHERE` or the savepoint makes tests fail.
- A reservation can be released at most once, however often cancel, expire and pay are replayed or raced. That is exactly what Phase 5's retried webhooks need.
- `order_events` gives a full audit trail of every transition for debugging.
- No new infrastructure: no queue, no scheduler.

**Harder / accepted debt:**
- **Read paths write.** A `GET` can change rows (the sweep). An order nobody looks at stays `pending_payment` in the database past its deadline until the next request sweeps. Nothing user-visible depends on stored status being fresh, because every read sweeps first, but a report that queries `orders` directly would see stale statuses.
- **Every sweeping request pays for the sweep.** The lookup is index-backed (`orders_status_expiry_idx` on `status, reservation_expires_at`), and each expired order is its own transaction, so one broken order can't block the rest. But a large backlog of stale orders would land on whichever request comes first. A real deploy wants a scheduled job (deferred).
- **Hold-squatting is only partly limited.** One open order per owner stops a single shopper reserving everything with repeated orders, but not a script that discards cookies or mints many guest carts. That needs rate limiting, which is still deferred.
- **A held unit is invisible to others for up to 15 minutes** even if its owner has left. That is the price of a reservation model.
- **No stock admin UI.** Seeding is `npm run db:seed-inventory --workspace=apps/api` (default 10 units, never overwrites existing rows); later adjustments are manual.
- **Titles are snapshotted in English only** on `order_items`, so order history under `/de` shows English product names.
- **Single-process assumption for the transaction layer.** The conditional update still holds if that changes, but the cart-changed re-check and the one-open-order guard inside `createOrder` lean on synchronous transactions. Moving to Postgres would need `SELECT … FOR UPDATE` or serializable isolation there.

## Related

- [Spec 0004](../specs/0004-checkout.md) (Decisions 1–5), [ADR 0001](0001-monorepo-content-commerce-split.md), [ADR 0004](0004-standalone-commerce-api-service.md), [ADR 0006](0006-cookie-guest-cart-merged-on-login.md), [ADR 0008](0008-cookie-bound-guest-orders.md)
- `apps/api/src/inventory/lib/inventoryRepo.ts` (`reserveStock`, `releaseStock`, `commitStock`, `seedInventory`)
- `apps/api/src/orders/lib/orderStateMachine.ts`, `applyTransition.ts`, `expireStaleOrders.ts`, `createOrder.ts`, `money.ts`
- `apps/api/src/db/migrations/0002_orders_and_inventory.sql`
