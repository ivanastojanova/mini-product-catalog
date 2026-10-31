# Spec 0005: Mock Payment Gateway (async, Stripe-style webhook + idempotency)

**Status:** Done (built, tested and clicked through in the browser)

**Phase:** 5

**Related:** [Spec 0004](0004-checkout.md) (the orders and state machine this drives), [ADR 0004](../adr/0004-standalone-commerce-api-service.md) (separate services talk over real HTTP), [ADR 0007](../adr/0007-inventory-and-lazy-reservation-expiry.md) (reservation and expiry), [ADR 0008](../adr/0008-cookie-bound-guest-orders.md) (who may see an order). ADRs for this phase are written during the build (see the build order).

## Context

Phase 4 ends with an order in `pending_payment` and a dev-only `simulate-payment` route that calls `applyTransition(..., "pay")`. Phase 5 replaces it with the thing a real shop has: a **payment provider that is a separate system**, tells us the outcome **asynchronously** through a signed **webhook**, and may deliver that webhook twice, late, or after we have already given up on the order.

The provider is a mock we write, but it is built to behave like Stripe from apps/api's side. The point of the phase is apps/api's half: verify the signature, apply each event exactly once, and decide what to do when the news arrives at an awkward moment.

## Settled decisions (agreed with the user)

| Question | Decision |
|---|---|
| Where does the mock provider run? | A new standalone app, **`apps/gateway`** (Fastify, port 4100) with its own SQLite file and its own secrets. apps/api calls it over HTTP; it calls apps/api's webhook over HTTP. |
| How does the shopper pay? | **Hosted pay page** served by the gateway (Stripe Checkout style). apps/web redirects there; the gateway redirects back to the order page. |
| Scenarios the mock supports | Success, decline, duplicate delivery, late success after the order expired or was cancelled. All covered by tests. |
| Signature scheme | Hand-rolled HMAC-SHA256, Stripe's header format, `node:crypto` only. |
| Late success (order already expired or cancelled) | The order **stays** expired or cancelled. apps/api asks the gateway to **refund** the payment. |
| The stock hold while the shopper is on the pay page | **Unchanged.** It keeps ticking. If it runs out, the late-success rule above applies. |

**Not in scope, deliberately:** webhook retries with exponential backoff, a delayed-delivery scenario, a bad-signature/old-timestamp *scenario* in the gateway (apps/api still verifies and rejects both, with tests), partial refunds, a `refunded` order state, real card handling, 3-D Secure, multiple currencies per payment. Retries are the most natural follow-up, since they are what makes idempotency matter in production. They are left out to keep the phase small, not because they are unimportant.

## Decision 1 — The flow

```
apps/web            apps/api                       apps/gateway
   │  POST /orders/:id/pay   │                           │
   │ ───────────────────────▶│ create payments row       │
   │                         │ POST /v1/payment_intents  │
   │                         │ ─────────────────────────▶│ create intent
   │   { payUrl }            │◀───────────────────────── │
   │◀────────────────────────│                           │
   │  redirect browser to payUrl  ───────────────────────▶ GET /pay/:intentId  (hosted page)
   │  shopper clicks "Pay" / "Decline"  ────────────────▶ POST /pay/:intentId
   │                         │                           │ mark intent, create event
   │◀──── redirect to the order page ───────────────────│
   │                         │  POST /webhooks/payments  │ (signed, after the redirect)
   │                         │◀──────────────────────────│
   │                         │ verify → dedupe → apply   │
   │  GET /orders/:id (poll) │                           │
   │ ───────────────────────▶│  status: paid             │
```

- **The webhook is the only thing that can mark an order paid.** The redirect back to the order page proves nothing (anyone can open that URL), and neither does anything in the query string. The order page shows "payment processing" until the poll sees `paid`.
- The gateway sends the webhook **after** responding to the browser, so the shopper usually lands on the order page *before* the news arrives. This is the realistic ordering and is why the page polls.
- **Amounts come from the order in apps/api's DB**, never from the browser. The gateway never sees a cart.

## Decision 2 — apps/gateway

A small Fastify app, structured like apps/api (`src/<area>/{lib,routes}`), with `better-sqlite3` and **plain SQL** (no ORM, decided with the user: the gateway is deliberately a different system from apps/api, and its four tables don't need Drizzle). Its own `gateway.db`. Schema changes are numbered files in `apps/gateway/migrations/` applied by a ~30-line `migrate()` (`src/db/migrate.ts`) that records them in a `schema_migrations` table, each file in one transaction. Everything else is shared with apps/api through the npm workspace: same versions of Fastify, better-sqlite3, TypeScript, ESLint, Vitest and tsx, hoisted to the root `node_modules` (one copy each), same `tsconfig` and ESLint setup. No Drizzle, no drizzle-kit, no new package anywhere in the repo.

**Tables**

`payment_intents` — `id` (`pi_` + random), `amount_cents` (`CHECK > 0`), `currency`, `status` (`requires_payment | succeeded | failed | refunded`), `metadata_order_id` (apps/api's order `publicId`, opaque to the gateway), `return_url`, `created_at`, `updated_at`.

`events` — `id` (`evt_` + random, the **idempotency handle apps/api dedupes on**), `type`, `intent_id`, `payload` (JSON), `created_at`, `delivered_at` (nullable), `delivery_attempts`.

`refunds` — `id` (`re_` + random), `intent_id` (unique), `amount_cents`, `created_at`.

`idempotency_keys` — `(key, endpoint)` PK, `request_hash`, `response_json`. Same key and same body replays the stored response; same key with a different body is `409`. This is what stops a retry from apps/api creating two intents.

**API (called by apps/api, `Authorization: Bearer ${GATEWAY_API_KEY}`)**

| route | behavior |
|---|---|
| `POST /v1/payment_intents` | `{ amountCents, currency, orderId, returnUrl }` + `Idempotency-Key` → `{ id, status, payUrl }` |
| `GET /v1/payment_intents/:id` | current state (for a manual reconcile or debugging; apps/api does not rely on it) |
| `POST /v1/refunds` | `{ paymentIntentId }` + `Idempotency-Key` → refund of the full amount; only an intent that `succeeded`; a second refund of the same intent returns the first one |

**Hosted page (browser-facing, no API key: the unguessable intent id is the credential, as with Stripe's checkout URLs)**

- `GET /pay/:intentId` — server-rendered HTML (no framework, no client JS): amount, order reference, and three buttons: **Pay**, **Pay (webhook delivered twice)**, **Decline card**. An intent that is no longer `requires_payment` shows its final state instead of the buttons.
- `POST /pay/:intentId` with `{ outcome: "succeed" | "succeed_twice" | "decline" }` — records the outcome, creates the event(s), delivers the webhook(s) (one attempt each, 3 s timeout), and only then responds `303` to `returnUrl`, so the order is normally already paid when the shopper lands on it. A failed delivery never blocks the redirect.
- `returnUrl` must start with the origin in `ALLOWED_RETURN_ORIGIN` (the apps/web origin), checked at intent creation, so the gateway can't be used as an open redirect.

**Events** (shape follows Stripe's)

```json
{ "id": "evt_...", "type": "payment_intent.succeeded", "created": 1767000000,
  "data": { "object": { "id": "pi_...", "amount": 132000, "currency": "EUR",
                        "metadata": { "orderId": "<order publicId>" } } } }
```

Types: `payment_intent.succeeded`, `payment_intent.payment_failed`. Delivery: `POST ${WEBHOOK_URL}` with `Gateway-Signature: t=<unix seconds>,v1=<hex hmac>` and the raw JSON body. One attempt; the result is recorded in `delivery_attempts` / `delivered_at`. "Delivered twice" re-sends the **same event, same id**, with a fresh timestamp and signature (what a retry would do).

The gateway can be down or erroring and apps/api must still be correct, because apps/api never depends on it for an order's status. The cost: an order whose webhook never arrives stays `pending_payment` until its hold expires.

## Decision 3 — Signature verification (apps/api, security-critical)

Stripe's scheme. The gateway signs `` `${t}.${rawBody}` `` with HMAC-SHA256 using `GATEWAY_WEBHOOK_SECRET`; the header is `t=<unix seconds>,v1=<hex>`.

apps/api's verifier is a **pure function** `verifyWebhookSignature({ rawBody, header, secret, now, toleranceSeconds = 300 })`:

1. Parse the header. Missing, malformed, or non-numeric `t`, or no `v1` → reject.
2. Reject if `|now − t| > tolerance` (replay protection: a captured request stops working after five minutes).
3. Recompute the HMAC over `t.rawBody` and compare with `crypto.timingSafeEqual` (lengths checked first, since `timingSafeEqual` throws on unequal lengths). Never `===`.
4. Return a result with a reason code (`missing_header | malformed_header | stale_timestamp | bad_signature`) for tests and logs; the HTTP response never says which one failed (`400 { message: "Invalid signature" }`).

**It signs the raw bytes, so apps/api must keep them.** Re-serializing parsed JSON can reorder or reformat and break the signature. The webhook route lives in an encapsulated Fastify plugin with its own `application/json` content-type parser that stores the raw string on the request and then parses it. The rest of the app keeps Fastify's normal parser.

The webhook route is **not** behind CORS or cookies (server-to-server) and must not read the session. Its only credential is the signature.

Duplication: the gateway's `sign` and apps/api's `verify` are separate files in separate apps (same stance as the duplicated locale list, ADR 0001). A **fixed test vector** (known secret + timestamp + body → known header) is asserted in both apps so they cannot drift apart.

## Decision 4 — apps/api data model and idempotency

New migration `0003_payments.sql`:

`payments` — one row per payment *attempt* on an order.
| column | notes |
|---|---|
| `id` | integer PK, internal |
| `order_id` | FK → orders |
| `gateway_intent_id` | text, unique, from the gateway |
| `amount_cents`, `currency` | copied from the order at creation (`CHECK amount > 0`) |
| `status` | `CHECK` in `pending`, `succeeded`, `failed`, `refund_pending`, `refunded` |
| `refund_id` | nullable |
| `created_at`, `updated_at` | |

`payment_events` — one row per **gateway event id** ever received.
| column | notes |
|---|---|
| `gateway_event_id` | text **PK** — this is the idempotency guarantee |
| `type` | |
| `payload` | raw JSON, kept for debugging |
| `outcome` | `applied | duplicate | ignored | refund_requested` |
| `received_at` | |

**Applying an event is one synchronous transaction** (the same `better-sqlite3` rule as order creation: no `await` inside):

1. `INSERT` into `payment_events` with the event id. If the primary key already exists, this is a replay: return `200 { received: true, duplicate: true }` and **change nothing else**. Insert-first (not select-then-insert) is what makes two simultaneous deliveries safe.
2. Look up the `payments` row by `gateway_intent_id`. None → record outcome `ignored`, `200` (answering 4xx would make a real gateway retry forever on something we can never act on). Log it.
3. Apply the rule for the event type (Decision 5).

Responding `2xx` means "received and recorded", not "the order is paid". A signature failure is `400`; a body that is not a valid event is `400`; an unexpected exception is `500` (so a retrying gateway would try again, and the insert rolls back with the transaction).

## Decision 5 — What each event does

`payment_intent.succeeded`:

| order status when the event arrives | result |
|---|---|
| `pending_payment`, amount and currency equal the order's total | `applyTransition(db, orderId, "pay", "payment <intent id>")`; payment → `succeeded` |
| `paid` already (e.g. a second attempt also succeeded) | payment → `refund_pending`; this is a double charge and must go back |
| `cancelled` or `expired` | **do not move the order.** Payment → `refund_pending`. Its stock may belong to someone else by now. |
| `pending_payment` but amount or currency differs from the order | do not pay the order; payment → `refund_pending`, loud log. Never trust an amount we did not expect. |
| `fulfilled` | same as `paid` |

After the transaction commits, for each payment left in `refund_pending`, apps/api calls `POST /v1/refunds` (idempotency key `refund-<payment id>`), outside the DB transaction because it is an `await`. Success → `refunded` and `refund_id` stored. Failure (gateway down) → stays `refund_pending`, logged, and the webhook is still answered `200` (the event *was* handled correctly; the refund is a separate follow-up). A re-delivered event does not retry it. **Known gap, accepted:** a stuck `refund_pending` needs a reconcile job (or a manual call) that does not exist in this phase.

`payment_intent.payment_failed`: payment → `failed`. **The order stays `pending_payment`** so the shopper can try again until the hold lapses; no stock change.

An event for a payment already in a final state (`failed` followed by `succeeded` for the same intent, or events out of order) is evaluated against the table above using the *order's* current status. The order state machine is what protects the order; the payments table is bookkeeping.

## Decision 6 — Starting a payment: `POST /orders/:publicId/pay`

Auth: the same rule as every order route (`resolveRequester` + `findOwnedOrderId`, `404` for missing or not yours). Bodiless request (same no-JSON-content-type rule as cancel).

1. Resolve the requester; sweep expired orders (lazy expiry).
2. Order must be `pending_payment`, otherwise `409 { code: "not_payable", order }`.
3. If the order already has a `pending` payment, **reuse it** and return its `payUrl` (so a double click or a refresh does not create two intents). `payUrl` is rebuilt from the stored intent id and `GATEWAY_PUBLIC_URL`.
4. Otherwise insert a `payments` row (`pending`), then call the gateway to create the intent with idempotency key `payment-<payments.id>`, amount/currency from the order, `returnUrl` = apps/web's order page. This call is an `await`, so it is **outside** any DB transaction. Store `gateway_intent_id` on the row.
   - Gateway unreachable or erroring → `502`, the `pending` row is deleted (nothing was created gateway-side that we know of; if it was, the idempotency key means the retry finds it).
5. `200 { payUrl }`.

After a `failed` payment the same call creates a fresh attempt (step 3 only reuses `pending`).

**The order DTO gains a `payment` field**: `null`, or `{ status }` for the most recent attempt (`pending | failed | succeeded | refunded | refund_pending` mapped to display-safe values). No intent ids, no gateway data leave the server. `OrderView` uses it to show "payment processing", "payment declined, try again" and, for a lapsed hold, "your payment was refunded".

## Decision 7 — apps/web

- `features/orders/api/orders.ts`: `startPayment(publicId)` → `{ payUrl }`; the `simulatePayment` function and the dev "Pay now (test)" button are **deleted**.
- `OrderView`: a **Pay** button (replaces the test button, shown in every environment) that calls `startPayment` and does `window.location.assign(payUrl)`. States: unpaid; "payment processing" (returned from the gateway, webhook not yet applied; polling continues); declined with a "Try again" button; paid; expired/cancelled with "refunded" when applicable.
- Polling: already every 5s while unpaid. Add a faster interval (2s) while `payment.status === "pending"` after a return. Stop at any terminal order status.
- No new dependency. EN/DE copy in the component's dictionary, as elsewhere.
- Env: `NEXT_PUBLIC_*` is not needed, because the gateway URL arrives in the API response.

## Decision 8 — Config and operations

| var | app | purpose |
|---|---|---|
| `GATEWAY_URL` (`http://localhost:4100`) | api | server-to-server calls |
| `GATEWAY_PUBLIC_URL` (same locally) | api | base of the `payUrl` handed to the browser (differs from `GATEWAY_URL` behind a proxy) |
| `GATEWAY_API_KEY` | api, gateway | bearer secret for `/v1/*` |
| `GATEWAY_WEBHOOK_SECRET` | api, gateway | HMAC key |
| `WEBHOOK_URL` (`http://localhost:4000/webhooks/payments`) | gateway | where events go |
| `ALLOWED_RETURN_ORIGIN` (`http://localhost:3000`) | gateway | return-URL allow-list |
| `PORT` (4100), `DATABASE_URL` | gateway | |

Root `npm run dev` gains `dev:gateway`; `build`, `lint`, `test` include the new workspace. `.env.example` files for both apps. Secrets in `.env` examples are obvious placeholders that the apps refuse to start with in `NODE_ENV=production`.

## Testing requirements (security- and money-critical: tests ship with the code)

**apps/api**
- **Signature verification:** valid; wrong secret; body changed by one byte; header missing/malformed/non-numeric `t`/no `v1`; timestamp too old and too far in the future; exactly at the tolerance edge; unequal-length signature (must reject, not throw); fixed cross-app test vector.
- **Webhook route (via `.inject()`):** raw body is what gets verified (a differently-spaced but equivalent JSON body fails); invalid signature → 400 and **no rows written**; the route needs no cookie/session; unrelated routes still use the normal JSON parser.
- **Event application:** success pays the order and commits stock exactly once; **same event id delivered twice → one transition, one `order_events` row, second reply says duplicate**; two simultaneous deliveries (two calls in a row inside the sync transaction, plus the PK-conflict path tested directly); failure leaves the order `pending_payment` and the hold intact; **late success on an expired order and on a cancelled order → order unchanged, stock unchanged, payment `refund_pending`, refund requested once**; second successful payment on a paid order → refunded; amount mismatch and currency mismatch → not paid, refund requested; unknown intent → 200 `ignored`; unknown event type → 200 `ignored`; refund call failing leaves `refund_pending` and still answers 200; a failure mid-transaction rolls the event row back.
- **`POST /orders/:id/pay`:** not yours / missing → 404; not `pending_payment` → 409; reuses a pending payment; new attempt after `failed`; gateway down → 502 and no leftover row; amount taken from the order, not the request; lapsed hold refused.
- **Order DTO:** `payment` field mapping; no intent ids or gateway fields leak.
- The `simulate-payment` route and its tests are deleted; a test asserts nothing under `/dev/` marks an order paid.

**apps/gateway**
- Intent creation validates amount/currency/return URL (open-redirect check); idempotent replay returns the same intent, same key with a different body → 409.
- `/v1/*` requires the API key.
- Outcomes: succeed → one event; succeed twice → two deliveries with the **same event id**; decline → failed event; paying an already-finished intent does not create another event.
- Refund: only for a succeeded intent; repeat returns the same refund.
- Delivery sends a signature that the fixed vector verifies; a failed delivery is recorded and does not crash the request.

**apps/web:** `startPayment` api wrapper tests (error mapping) as with the other api modules; DTO type updated.

**Mutation checks** on the riskiest ones, as in earlier phases: compare signatures with `===`; skip the tolerance check; verify the parsed-then-reserialized body instead of the raw one; select-then-insert instead of insert-first; pay the order without checking its status; skip the amount check; resurrect an expired order on success; mark the order failed on `payment_failed`.

**Manual click-through:** guest and customer: order → Pay → hosted page → succeed → back on the order page ("processing" → paid); decline → try again → succeed; "webhook twice" → stock committed once, one `paid` event in the audit trail; set `RESERVATION_TTL_SECONDS=30`, open the pay page, wait, then Pay → order stays expired, the gateway shows the refund; stop the gateway and click Pay → friendly error; stop apps/api and pay → the event is lost (documented gap: no retries).

## Build order (one small piece at a time, each runnable before the next)

1. **Signature pure functions** with tests: `sign` in the gateway scaffold's lib and `verifyWebhookSignature` in apps/api, plus the shared test vector. *(Gateway lib can be a standalone file until step 5.)*
2. **apps/api schema + migration** (`payments`, `payment_events`) + schema tests for every `CHECK`/PK; look at the tables in Drizzle Studio.
3. **Webhook route skeleton**: raw-body parser plugin, signature check, 400 on failure, records nothing yet. Tests via `.inject()`.
4. **`applyPaymentEvent`** (the transaction in Decision 4/5) + the full event-application test list + the refund-after-commit step with a mocked gateway client. Wire it into the route.
5. **apps/gateway scaffold**: workspace, config, DB, intents, API key, idempotency keys, tests. *(Dependencies approved: see Decision 2.)* Split in two: **5a** workspace + plain-SQL DB + migrator + `signWebhook` (done); **5b** config, `POST`/`GET /v1/payment_intents`, API-key check, idempotency keys, server (done).
6. **Gateway events + delivery + refunds**, tests. At this point apps/api and the gateway can be exercised end to end with curl.
7. **Hosted pay page** (`GET`/`POST /pay/:intentId`); first clickable result for the gateway half.
8. **`POST /orders/:publicId/pay`** in apps/api (+ gateway client, order DTO `payment` field), tests.
9. **apps/web**: `startPayment`, Pay button, states, polling; delete `simulatePayment` (web) and the dev route (api).
10. **Wiring**: root scripts, `.env.example`, README, `dev:gateway`.
11. **Docs**: ADR 0009 (separate gateway app and what it models), ADR 0010 (webhook as the only source of truth: signature, insert-first idempotency, the late-payment refund policy); update README and PLAN; mark the phase done after the manual click-through.

## Known gaps (accepted for this phase)

- No webhook retries/backoff, so a lost delivery is lost.
- No reconcile job for a `refund_pending` that could not be sent, or for an order whose webhook never came (the gateway's `GET /v1/payment_intents/:id` exists to build one on).
- No `refunded` order state; the refund lives on the payment row.
- The `ipAddress`/rate-limit TBDs from earlier phases still apply; the webhook endpoint is public and unauthenticated apart from its signature, so rate limiting it is a real-deploy item.
- The shared secrets are plain env vars, with no rotation story (Stripe supports two valid secrets during rotation).
