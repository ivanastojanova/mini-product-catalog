# ADR 0009: The payment provider is a separate mock app (`apps/gateway`), not code inside apps/api

**Status:** Accepted

**Date:** 2026-10-31

## Context

Phase 5 needs a payment flow that behaves like a real provider (Stripe, Adyen): the shopper pays on a page we don't render, the provider tells our server about the result later through a signed webhook, and that message can be duplicated, late or lost. Full design in [spec 0005](../specs/0005-payments.md). Builds on [ADR 0004](0004-standalone-commerce-api-service.md) (apps/api owns orders) and [ADR 0001](0001-monorepo-content-commerce-split.md) (apps in the monorepo talk over HTTP, never by importing each other).

The learning goal is to build the *receiving* side correctly: signature check, idempotency, ordering, refunds. A mock that lives inside apps/api, or that apps/api can reach by a function call, would let the receiving side cheat (share a database, skip the signature, trust a function argument) and the interesting failure modes could not happen.

## Decision

1. **The gateway is its own app, `apps/gateway`** (Fastify, port 4100), with its own SQLite file, `gateway.db`. It is only ever reached over HTTP. apps/api never imports it, and it never imports apps/api.
2. **Two directions, two credentials.**
   - apps/api → gateway (`/v1/*`: create an intent, refund): a bearer `GATEWAY_API_KEY`, compared as SHA-256 digests with `timingSafeEqual`.
   - gateway → apps/api (`POST /webhooks/payments`): an HMAC signature with `GATEWAY_WEBHOOK_SECRET`. No cookie, no session, no CORS.
3. **The gateway has a hosted pay page** (`/pay/:intentId`, Stripe Checkout style) with three buttons: Pay, "Pay (webhook delivered twice)" and Decline. The unguessable intent id (128 random bits) is that page's only credential. The return URL is fixed at intent creation and must be on `ALLOWED_RETURN_ORIGIN` (checked by parsed origin, not by prefix), so the page cannot be used as an open redirect.
4. **Plain SQL in the gateway**, with numbered `.sql` migrations and a ~30-line migrator, instead of Drizzle. Everything else (Fastify, better-sqlite3, TypeScript, ESLint, Vitest, tsx) is the same packages at the same versions as apps/api, hoisted to one copy at the repo root. No new package was added to the repo.
5. **Scenarios supported:** success, decline, a duplicated delivery (same event id sent twice), and a late success after the order expired or was cancelled. **Not supported:** automatic retries with backoff, delayed delivery, a "bad signature" button. (apps/api still verifies and rejects bad signatures, and tests cover that.)
6. **The gateway delivers inline.** `POST /pay/:id` settles the intent, sends the webhook, and only then redirects the shopper (one attempt, 3 s timeout). By the time the order page loads the order is normally already `paid`. A failed delivery never blocks the redirect; it is counted in `events.delivery_attempts`.

## Alternatives considered

- **A mock module inside apps/api** — least work, but the receiving code could share a DB and skip the network, and "the provider is down" or "the response was lost" could not be tested for real. Rejected.
- **A real provider in test mode (Stripe)** — the most realistic, but needs an account, keys, a tunnel for webhooks, and makes the project impossible to run offline or clone-and-go. The point here is the receiving logic, which transfers.
- **A fake `simulate-payment` route (what Phase 4 had)** — a route that marks an order paid is the one thing production must never have. It is deleted in this phase.
- **A queue and retry scheduler in the gateway** — realistic, but a large amount of code that teaches nothing about the receiving side. Left as a known gap.
- **Drizzle in the gateway** — would reuse a pattern already known, but the gateway is four tables and is deliberately a different system. Plain SQL keeps it honest about not sharing apps/api's data layer.

## Consequences

**Easier:**
- The receiving code is tested against the same bytes and headers a real provider sends, including a **fixed cross-app signature vector** asserted in both apps' tests so the two sides cannot drift apart silently.
- A third app is a realistic shape for the monorepo, and swapping in a real provider means replacing one `PaymentGateway` object in apps/api (`createHttpPaymentGateway`) plus the signature scheme.

**Harder / accepted debt:**
- **Four processes** in local dev (`npm run dev` now starts the gateway too), and **five secrets/URLs to keep in step** between two `.env` files (`GATEWAY_API_KEY`, `GATEWAY_WEBHOOK_SECRET`, `GATEWAY_URL`, `GATEWAY_PUBLIC_URL`, `WEBHOOK_URL`). Production boot refuses the example placeholder secrets.
- **No retries.** A webhook that fails once is not re-sent. An order whose webhook never arrives stays `pending_payment` until its hold expires. A reconcile job (using `GET /v1/payment_intents/:id`, which exists for it) is the missing piece.
- **The pay page is a mock.** It has no card entry, no 3-D Secure, no real fraud signals, and no rate limiting.
- **Some duplication on purpose:** `signWebhook` (gateway) and `verifyWebhookSignature` (apps/api) are separate files, and the locale list is copied into apps/api's pay route (same stance as ADR 0001).

## Related

- [ADR 0010](0010-webhook-as-only-source-of-payment-truth.md) — how apps/api treats what the gateway sends.
- [Spec 0005](../specs/0005-payments.md)
- `apps/gateway/src/app.ts`, `apps/gateway/src/pay/routes/pay.ts`, `apps/api/src/payments/lib/gatewayClient.ts`
