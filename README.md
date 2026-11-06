# Mini E-Commerce Monorepo

Started as a take-home: a localized (**en** / **de**) product catalog built with **Next.js App Router** and **Payload CMS**. Now being extended into a fuller e-commerce exercise — auth, cart, checkout, orders, and a mock payment gateway — while staying structured as a learning project: every architectural decision gets an [ADR](docs/adr/), and [AGENTS.md](AGENTS.md) documents the conventions for anyone (human or AI) extending it.

**Package manager:** npm (workspaces)

## Project shape

```
apps/
  cms/   Payload CMS — catalog content only (Products, Media, admin auth).
         SQLite, own payload.db. Serves REST/GraphQL on :3001.
  web/   Storefront. Talks to apps/cms and apps/api over real HTTP, never the
         Payload Local API. Serves on :3000.
  api/   Commerce API (customers, cart, orders, payments, webhook receiver).
         Fastify + SQLite (commerce.db). Serves on :4000.
  gateway/  Mock payment provider (Stripe-style): hosted pay page, signed
         webhooks, refunds. Fastify + plain SQL (gateway.db). Serves on :4100.
docs/adr/   One Markdown file per significant architectural decision.
```

This split (two separate Next.js apps, two separate processes, two separate databases) is itself an ADR — see [`docs/adr/0001-monorepo-content-commerce-split.md`](docs/adr/0001-monorepo-content-commerce-split.md) for the full reasoning, including why the commerce domain is deliberately **not** a Payload collection.

## Tech stack

- Next.js 16 App Router, React 19
- Payload CMS (SQLite, `apps/cms`)
- Fastify + SQLite for the commerce API and the mock gateway
- TanStack Query (client state in `apps/web`)
- Tailwind CSS + shadcn-style components over Base UI primitives
- Vitest (`apps/web`, `apps/api`, `apps/gateway`)

## Setup and run

```bash
npm install                 # installs all workspaces
npm run dev                 # starts apps/cms (:3001), apps/api (:4000), apps/gateway (:4100), apps/web (:3000)
npm run seed                # optional — seeds ~9 EN/DE furniture products + media
npm run seed:categories --workspace=apps/cms  # optional — seeds the category list and assigns products
```

Or run each app independently (useful when working on just one side):

```bash
npm run dev:cms      # http://localhost:3001
npm run dev:api      # http://localhost:4000
npm run dev:gateway  # http://localhost:4100
npm run dev:web      # http://localhost:3000
```

Paying for an order needs all four running. Copy each app's `.env.example` to `.env` first (`apps/api` and `apps/gateway` need the **same** `GATEWAY_API_KEY` and `GATEWAY_WEBHOOK_SECRET`; generate them with `openssl rand -hex 32`).

| What | URL |
|------|-----|
| Storefront | [http://localhost:3000](http://localhost:3000) (`/` → `/en`) |
| Payload admin | [http://localhost:3001/admin](http://localhost:3001/admin) |
| CMS REST API | [http://localhost:3001/api/products](http://localhost:3001/api/products) |

### Environment variables

**`apps/cms/.env`**

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | SQLite file (e.g. `file:./payload.db`) |
| `PAYLOAD_SECRET` | Payload sessions |
| `WEB_APP_URL` | Storefront base URL — apps/cms POSTs here on product writes |
| `REVALIDATE_SECRET` | Shared secret for the revalidation webhook (must match apps/web) |

**`apps/web/.env`**

| Variable | Purpose |
|----------|---------|
| `CMS_API_URL` | apps/cms base URL — apps/web fetches products from here |
| `REVALIDATE_SECRET` | Auth for `POST /api/revalidate` (must match apps/cms) |
| `NEXT_PUBLIC_API_URL` | apps/api base URL (the browser calls it directly) |

**`apps/api/.env`** (payment-related; see `.env.example` for the rest)

| Variable | Purpose |
|----------|---------|
| `GATEWAY_URL` | Where apps/api calls the gateway (server to server) |
| `GATEWAY_PUBLIC_URL` | Where the **browser** reaches the gateway's pay page |
| `GATEWAY_API_KEY` | Bearer key for the gateway's `/v1/*` API (must match apps/gateway) |
| `GATEWAY_WEBHOOK_SECRET` | HMAC key that signs webhooks (must match apps/gateway) |

**`apps/gateway/.env`**

| Variable | Purpose |
|----------|---------|
| `PORT`, `DATABASE_URL` | Listen port (4100) and SQLite file (`file:./gateway.db`) |
| `GATEWAY_API_KEY`, `GATEWAY_WEBHOOK_SECRET` | Same values as apps/api |
| `WEBHOOK_URL` | Where signed events are POSTed (apps/api's `/webhooks/payments`) |
| `ALLOWED_RETURN_ORIGIN` | The only origin a payment may send the shopper back to (apps/web) |
| `GATEWAY_PUBLIC_URL` | Base of the pay page links |

Both apps refuse to start in `NODE_ENV=production` if these secrets are missing or still the `replace-me…` placeholders. The gateway refuses to start without them in any environment.

### Trying a payment

1. Add something to the cart and check out; you land on the order page.
2. **Pay now** goes to the gateway's mock page. Choose **Pay**, **Pay (webhook delivered twice)** (same event sent two times; the order is still paid once) or **Decline card** (you return to the order, which stays open so you can try again).
3. To see a late payment: press **Pay now**, **cancel the order in another tab**, then press **Pay** on the gateway page. The order stays cancelled and the payment is refunded.

The order only becomes `paid` when apps/api receives the gateway's signed webhook; returning from the gateway page changes nothing by itself. See [ADR 0009](docs/adr/0009-separate-mock-payment-gateway.md) and [ADR 0010](docs/adr/0010-webhook-as-only-source-of-payment-truth.md).

A paid order shows a confirmation panel with the order number, the paid date and the next steps. It deliberately does not promise an email: there is no email service in this project yet.

Products can also be added by hand in `/admin` — the seed script is convenience, not required.

---

## Architecture

The App Router is intentionally kept thin in both apps. Pages are responsible for routing and composition, while business logic, data access and UI live inside feature modules.

```text
CMS write (Payload admin / seed)  — apps/cms
        │
        ▼
┌───────────────────┐   POST /api/revalidate  ┌─────────────────────┐
│  Payload CMS      │ ─────────────────────►  │  apps/web           │
│  (SQLite + admin) │   webhook (Bearer)       │  Next.js cache      │
│  :3001            │                          │  unstable_cache     │
└───────────────────┘                          └──────────┬──────────┘
        ▲                                                  │
        │  GET /api/products (REST, HTTP)      Server Components
        │                                      (SSG + unstable_cache)
        │                                                  ▼
        └──────────────────────────────────────  ┌─────────────────────┐
                                                   │  /[lang]            │
                                                   │  /[lang]/products/  │
                                                   │       [slug]        │
                                                   └──────────┬──────────┘
                                                              │
                                   Client (TanStack Query)    │
                                                              ▼
                                                   ┌─────────────────────┐
                                                   │  (cart, stock →     │
                                                   │   apps/api)         │
                                                   └─────────────────────┘
```

```text
apps/cms/
  collections/   Payload schemas (Product, Media, Users)
  lib/           notifyRevalidate — webhook to apps/web on product writes
  app/           Payload admin + REST/GraphQL routes (generated, don't edit)

apps/web/
  app/                  routing + composition only
  features/products/    catalog: filters, query builders, cards, stock
  features/cart/        cart query, mini-cart, cart page, optimistic add, cart math
  features/checkout/    preview, place order, checkout form
  features/orders/      order reads, history, payment start, status view
  features/auth/        session, login/register, route protection
  components/ui/        Base UI primitives and shadcn-style wrappers
  shared/cms/           REST client + hand-written CMS response types
  shared/i18n/          locale routing (duplicated, not shared, from apps/cms)

apps/api/               Fastify commerce API (auth, cart, inventory, orders, payments webhook)
apps/gateway/           mock payment provider (hosted pay page, signed webhooks, refunds)
```

| Path | Public URL | Owner |
|------|------------|--------|
| `apps/web/app/api/revalidate` | `:3000/api/revalidate` | apps/web — cache purge, called by apps/cms webhook |
| `apps/api` `/cart`, `/cart/items/:slug` | `:4000/cart*` | apps/api — persistent guest + customer cart (Phase 3) |
| `apps/api` `/stock/:slug` | `:4000/stock/:slug` | apps/api — real inventory: available = on hand − reserved (Phase 4) |
| `apps/api` `/stock?slugs=a,b,c` | `:4000/stock?slugs=…` | apps/api — batch availability for the catalog's live stock filters (Phase 6) |
| `apps/cms/app/admin` | `:3001/admin` | Payload admin |
| `apps/cms/app/api/*` | `:3001/api/*` | Payload REST + GraphQL |

Payload was chosen because it integrates directly with Next.js App Router, supports localization, generates TypeScript types, and makes it easy to demonstrate CMS-driven cache revalidation. apps/web treats it like any third-party headless CMS — see `apps/web/shared/cms/client.ts` + `apps/web/shared/cms/types.ts`: no generated Payload types or Local API calls cross the app boundary. Locales: `en` / `de` with URL prefixes, configured independently (and intentionally duplicated — see ADR 0001) in each app.

---

## Caching & freshness

| Surface | How | Tags |
|---------|-----|------|
| Landing (`/[lang]`) | `unstable_cache` → `getProducts(locale)` | `products` |
| Catalog with category/sort filters | `unstable_cache`, keyed by locale + category + sort → `getProducts(locale, filters)` | `products` |
| Catalog with text search or a price range | live CMS query (unbounded key space, so not cached) | — |
| Category list | `unstable_cache` → `getCategories(locale)` | `products` |
| PDP (`/[lang]/products/[slug]`) | `unstable_cache` + `generateStaticParams` | `product:{slug}` |

Locale is part of the cache **key**, not the tag — one save refreshes both locales for that slug, plus the listing. Editing one product does not bust other `product:{other}` entries.

**Flow:** CMS save (apps/cms) → Payload `afterChange`/`afterDelete` → `notifyRevalidate` → `POST` to apps/web's `/api/revalidate` (Bearer-authenticated webhook) → `revalidateTag` (`products`, `product:{slug}`, and `product:{previousSlug}` if renamed). The same endpoint also accepts manual/external purges (curl, webhook tools) via Bearer or `x-revalidate-secret`. See [`docs/adr/0002-webhook-based-revalidation.md`](docs/adr/0002-webhook-based-revalidation.md) for why this moved from an in-process call to a real webhook, and what that cost (no retry on delivery failure, no HMAC signing — intentionally lighter-weight than what the upcoming payment webhook will need).

**Why tags:** data-oriented — one document feeds listing + detail + locales without enumerating every path. Time-based ISR alone would leave content stale and wouldn't show CMS-driven freshness. Immediate expire (`expire: 0`) for demos; under load, stale-while-revalidate (`'max'`) would be preferable.

### Static vs client

| Data | Where | Why |
|------|-------|-----|
| Name, description, images, specs, **price**, **category** | CMS → Server Components → cached HTML | SEO / catalog; refreshed via revalidation |
| **Stock** | Client → TanStack Query → apps/api `/stock/:slug`; catalog filters use the batch `/stock?slugs=` | Volatile; page paints while it loads |
| **Cart quantity** | Client → TanStack mutation → apps/api `/cart/items` | Server-side cart (guest cookie or customer); optimistic add on the PDP, server-confirmed quantity/remove on the cart page |
| **Cart prices, subtotal** | Client → `GET /checkout/preview` (cart page; mini-cart fetches on open) | Live CMS prices + stock flags; the same pricing checkout charges |

Price stays in the CMS cache on purpose — treating it as client-only would hide the revalidation story. Stock changes often and isn't SEO-critical.

### Catalog filtering

The catalog's search and filter bar keeps its state in the URL, so a filtered view survives reload and back/forward and can be shared:

| Param | Values | Runs in |
|-------|--------|---------|
| `q` | up to 80 characters, title search | CMS (`where[title][like]`) |
| `category` | a category slug that exists in the CMS | CMS (`where[category.slug][equals]`) |
| `min`, `max` | price bounds in major units, inclusive | CMS (`where[price]`) |
| `sort` | `title` (default), `title-desc`, `price-asc`, `price-desc` | CMS (`sort`, with `title` as tie-breaker) |
| `inStock` | `1` | apps/api `/stock?slugs=`, then apps/web |
| `minQty` | 1–999 | apps/api `/stock?slugs=`, then apps/web |

Invalid values are dropped, never forwarded to the CMS. Categories are CMS content (`categories` collection), so adding one needs no code change. Category and sort combinations are cached (see above); `q` and price bounds always call the CMS live. Live stock filters run after the CMS query, so combining them with pagination would give wrong page counts — there is no pagination yet. Search uses SQLite `LIKE`, which is not case-insensitive for non-ASCII letters, so `MALMÖ` finds nothing. See [ADR 0011](docs/adr/0011-server-side-catalog-filtering.md).

Stock is seeded once from the CMS slugs (`npm run db:seed-inventory --workspace=apps/api`, 10 units each, never overwrites existing rows). To see an out-of-stock label, set a product's `on_hand` to 0 in Drizzle Studio.

### Cross-origin media

Since apps/cms and apps/web are different origins now, product images (served by Payload from `apps/cms`) are absolute URLs pointing at `CMS_API_URL`, and `apps/web/next.config.ts` allowlists that origin via `images.remotePatterns`. In local dev this also needs `images.dangerouslyAllowLocalIP: true`, since Next's image optimizer refuses to proxy any origin resolving to a private/loopback IP by default (an SSRF guard) — safe here since the only private-IP origin ever used is our own apps/cms. See ADR 0001's "Consequences" section.

---

## Demo: content freshness (across the two apps)

1. Open `http://localhost:3000/en/products/malmo-lounge-chair` and note the title.
2. Edit the product in `http://localhost:3001/admin` and save.
3. Refresh the storefront — change appears without restart/redeploy, even though it's a different process on a different port.

Optional manual purge (curl or browser console against `localhost:3000`):

```bash
curl -X POST http://localhost:3000/api/revalidate \
  -H "Authorization: Bearer $REVALIDATE_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"slug":"malmo-lounge-chair"}'
```

**Authorized (expect `200`):**

```js
fetch("http://localhost:3000/api/revalidate", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: "Bearer YOUR_REVALIDATE_SECRET",
  },
  body: JSON.stringify({ slug: "malmo-lounge-chair" }),
})
  .then((r) => r.json().then((body) => console.log(r.status, body)))
  .catch(console.error);
```

**Unauthorized — no Bearer (expect `401`):**

```js
fetch("http://localhost:3000/api/revalidate", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ slug: "malmo-lounge-chair" }),
})
  .then((r) => r.json().then((body) => console.log(r.status, body)))
  .catch(console.error);
```

---

## Bonus

| Item | Status |
|------|--------|
| Secured revalidation | Done — Bearer / `x-revalidate-secret`, now a real cross-service webhook |
| Multilanguage (`en` / `de`) | Done — switcher in layout, config duplicated per app (ADR 0001) |
| Optimistic cart | Done — see below |
| Tests | Vitest in `apps/api` and `apps/web`, see below |

### Optimistic add-to-cart

On a PDP, **Add to cart** updates **"N in cart"** immediately, then `POST /cart/items` on apps/api confirms (the server's quantity wins, e.g. when clamped at 10) or rolls back on failure (unknown product, CMS or API down). Mutation: `features/cart/hooks/useAddToCart`; UI: `AddToCartButton`. The old flaky stub is gone, so to see a rollback, stop apps/api and click the button.

The header cart button opens a mini-cart with the same priced preview: each line with unit price, quantity stepper (1–10) and remove, plus the subtotal and links to the full `/[lang]/cart` page or checkout. The preview is fetched when the popover opens (it prices from the CMS and sweeps expired holds, so it is not prefetched on every page view). The cart page and the mini-cart share `CartLineItem` and the same write hooks; each write re-reads both the cart badge query and the preview on settle, so neither view shows a guessed price or stock flag.

---

## Testing

Vitest lives in `apps/api`, `apps/gateway` and `apps/web`.

```bash
npm run test                        # from root — runs apps/api's suite, then apps/gateway's, then apps/web's
npm run test --workspace=apps/api   # one app, explicit
npm run test:watch --workspace=apps/web
```

Current coverage: apps/api has Vitest suites for auth (hashing, session tokens, register/login/logout/session routes), the cart (resolution, routes, guest→customer merge), inventory and reservations, checkout preview and order creation, and the payment webhook (signature, idempotency). apps/gateway covers its API key, return-URL allow-list, idempotency keys, settling once, signed delivery, refunds and the pay page. apps/web covers the catalog filters and query builders, cart client (API wrappers, optimistic add + rollback, cart write invalidation), route protection, order/checkout API wrappers and formatting helpers. Also `/api/revalidate` auth accept/reject + tag selection on rename (`apps/web/app/api/revalidate/route.test.ts`) — the highest-value test from the original take-home's testing plan, now also covering the webhook path end-to-end.

Catalog filtering (Phase 6): the URL parser/facet registry, Payload query builder and cache rule, live stock filters and the filter draft are unit-tested. The rendered filter bar has no component tests (the repo has none); it is covered by a browser click-through. The filtering decision and its tradeoffs are in [ADR 0011](docs/adr/0011-server-side-catalog-filtering.md).

Payments (Phase 5): webhook signature verification (including a fixed test vector asserted in both apps/api and apps/gateway), insert-first idempotency, late-payment and wrong-amount refunds, the order state machine, starting a payment (reuse, retry after decline, gateway down), and the gateway itself (API key, return-URL allow-list, idempotency keys, settling an intent once, signed delivery, refunds, the pay page). Security-relevant tests were mutation-checked.

Planned, in priority order as each phase lands (see [AGENTS.md](AGENTS.md) "Testing"):

1. ~~Auth: password hashing, session tokens/expiry, login/register/logout~~ — done in Phase 2
2. ~~Cart: guest↔user merge, quantity edge cases~~ — done in Phase 3
3. ~~Orders: total calculation, state transitions, authorization (owner-or-admin)~~ — done in Phase 4
4. ~~Payments: webhook signature verification, idempotency/replay safety~~ — done in Phase 5
5. Catalog filtering: facet registry, URL parser, CMS query builder, live stock filters — done in Phase 6

Money-critical and security-critical logic ships with tests in the same change, not retrofitted later.

---

## Roadmap

This project is being extended in phases. See [`docs/PLAN.md`](docs/PLAN.md) for live status and session handoff notes, [`docs/specs/`](docs/specs/) for per-phase design detail, and [`docs/adr/`](docs/adr/) for the frozen decision log.

| Phase | Scope | Status |
|-------|-------|--------|
| 0 | AI workflow scaffolding — AGENTS.md, ADR template | ✅ Done |
| 1 | Monorepo split (apps/web + apps/cms), webhook revalidation, Vitest | ✅ Done |
| 2 | Customers & auth (session cookies, not JWT — see [ADR 0003](docs/adr/0003-session-cookie-auth.md)) | ✅ Done |
| 3 | Persistent cart (guest cookie + customer cart, merged on login — see [ADR 0006](docs/adr/0006-cookie-guest-cart-merged-on-login.md)) | ✅ Done |
| 4 | Checkout & orders (state machine, stock reservation — see [ADR 0007](docs/adr/0007-inventory-and-lazy-reservation-expiry.md), [ADR 0008](docs/adr/0008-cookie-bound-guest-orders.md)) | ✅ Done |
| 5 | Mock payment gateway (async, Stripe-style webhook + idempotency — see [ADR 0009](docs/adr/0009-separate-mock-payment-gateway.md), [ADR 0010](docs/adr/0010-webhook-as-only-source-of-payment-truth.md)) | ✅ Done |
| 6 | Frontend e-commerce polish (filtering, mini-cart, cart page, order confirmation) — filtering decision in [ADR 0011](docs/adr/0011-server-side-catalog-filtering.md) | ✅ Done |
| 7 | CI (lint/typecheck/test on PR) | Planned |

### Tradeoffs / open items

| Area | Now | With more time |
|------|-----|----------------|
| Media | Local uploads | S3-compatible + CDN |
| Localization | Duplicated locale config per app | Shared workspace package if locales grow |
| Stock / cart | Real inventory in apps/api with reserve-at-order and lazy expiry (ADR 0007) | Stock admin UI; move the live stock filter into the data layer if the catalog gets pagination |
| Catalog search | CMS `where` queries; SQLite `LIKE` is ASCII-only case-insensitive | Search service (e.g. Postgres full-text or Meilisearch) once facets/pagination outgrow the CMS |
| Catalog scale | Listing capped at `limit: 100`, no pagination | Pagination plus a search service (see the filtering ADR) |
| Revalidation delivery | Fire-and-forget, no retry | Queue + retries for webhook delivery |
| Secret compare | String equality | Constant-time comparison |
| New slugs | On-demand until next build | Clearer path registration |
