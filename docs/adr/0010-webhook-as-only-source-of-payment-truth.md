# ADR 0010: The signed webhook is the only thing that can mark an order paid; events are applied exactly once; late payments are refunded, not honoured

**Status:** Accepted

**Date:** 2026-10-31

## Context

When the shopper comes back from the gateway's page, their browser carries a redirect, not proof of payment: anyone can open the return URL. The only trustworthy message is the gateway telling apps/api directly. That message can be forged by anyone who can reach the endpoint, can arrive twice, can arrive after the order's 15-minute hold has expired (and its stock has been given to someone else), and can disagree with what the order costs. Design in [spec 0005](../specs/0005-payments.md), Decisions 3–5. Builds on [ADR 0007](0007-inventory-and-lazy-reservation-expiry.md) (holds and lazy expiry) and the order state machine from Phase 4.

## Decision

1. **Only a verified webhook marks an order paid.** `POST /orders/:id/pay` only creates an attempt and returns a URL; the return redirect changes nothing. The Phase 4 `simulate-payment` route is deleted.
2. **Verification** (`verifyWebhookSignature`, a pure function): header `Gateway-Signature: t=<unix>,v1=<hex>`; HMAC-SHA256 over `` `${t}.${rawBody}` ``; the **raw bytes** are verified before any JSON parsing (the route has its own string body parser, and a 64 KB cap); `timingSafeEqual` after checking lengths; a 5-minute tolerance both ways so a captured request goes stale. Every failure is the same `400 Invalid signature`, so the response never says which check failed. With no secret configured the route answers 500 (fails closed), and production boot refuses missing or placeholder secrets.
3. **Exactly-once application by insert-first.** `payment_events.gateway_event_id` is the primary key. In one synchronous transaction apps/api inserts the event id first; if that insert changes no row, the event is a duplicate and nothing else happens (reply `200 {duplicate:true}` so the sender stops retrying). If anything later in the transaction throws, the insert rolls back too, so the sender's retry is processed rather than mistaken for a duplicate. Select-then-insert was rejected because two simultaneous deliveries could both pass the select.
4. **The order state machine still guards the order.** A success is applied only through `applyTransition(..., "pay")`, and only when the order is `pending_payment` and the amount and currency equal the order's. The payments table is bookkeeping; it never decides an order's state.
5. **A payment that cannot be honoured is refunded, never resurrected.** A success for an order that is `expired`, `cancelled`, already `paid` or `fulfilled`, or with the wrong amount or currency, leaves the order and its stock exactly as they are and marks the payment `refund_pending`. After the transaction commits, apps/api asks the gateway to refund it (idempotency key `refund-<payment id>`), then marks it `refunded`. The reason for not reviving an expired order: its stock may already belong to another shopper.
6. **A decline leaves the order open** (`pending_payment`), so the shopper can retry until the hold lapses. At most one attempt is pending per order (a partial unique index), and a pending attempt is reused, so a double click opens one payment.
7. **Unknown things are acknowledged, not errors.** An unknown intent, unknown event type or malformed `data.object` is stored as `ignored` and answered `200`: a 4xx would make a real sender retry forever on something we can never act on.
8. **Network calls are never inside a database transaction** (better-sqlite3 transactions are synchronous). That is why the refund runs after the commit, and why starting a payment inserts its `pending` row first and calls the gateway afterwards.

## Alternatives considered

- **Trust the return redirect** — the order would be payable by typing a URL. Rejected outright.
- **Poll the gateway for the result** — simple and needs no signature, but slower, wastes calls, and cannot catch a payment that completes after the shopper closed the tab. The gateway's `GET /v1/payment_intents/:id` exists so a reconcile job could use it as a backstop.
- **Honour a late payment if stock is still free** — friendlier, but it races with other shoppers and makes the rules depend on timing. Refunding is simple and always safe.
- **Reject a late payment by answering 4xx** — the money has already moved; the correct response is to give it back, and a 4xx would trigger retries.
- **Deduplicate by intent id instead of event id** — a payment legitimately produces several events over time (and a decline followed by a retry reuses nothing), so the event id is the right key.
- **Verify the parsed JSON re-serialised** — key order and whitespace can change, so a valid signature would fail (or worse, a modified body could pass). Raw bytes only.

## Consequences

**Easier:**
- Each risky case has a test, and the main ones were mutation-checked: skipping the signature, the conflict guard, the order-status check, the amount or currency check, the rollback, or making a late payment revive the order each fail tests.
- The rules are in two places only: `applyPaymentEvent` (what an event does) and `applyTransition` (what an order may do).

**Harder / accepted debt:**
- **No retry of a failed refund.** If the gateway is down when a late payment is refunded, the payment stays `refund_pending` and is only logged; a redelivered event is a duplicate and will not retry it. A reconcile job (or a manual call) is needed.
- **No `refunded` order state.** The order stays `expired` or `cancelled`; the shopper sees the refund through the order's `payment` field ("refunding" / "refunded").
- **A lost webhook** leaves an order `pending_payment` until it expires, even though the money moved (it would then be a late success that is refunded, but only if the event ever arrives).
- **The endpoint is public** and has no rate limiting; its only protections are the body cap and the cheap signature check that runs first.
- **Rotating the webhook secret** needs both apps changed together; the signature has only one `v1` and no overlap window.

## Related

- [ADR 0009](0009-separate-mock-payment-gateway.md) — why the gateway is a separate app.
- [ADR 0008](0008-cookie-bound-guest-orders.md) — who may start a payment (same ownership rule as every order route).
- `apps/api/src/payments/lib/verifyWebhookSignature.ts`, `applyPaymentEvent.ts`, `requestRefunds.ts`, `startPayment.ts`
- `apps/api/src/payments/routes/webhook.ts`
