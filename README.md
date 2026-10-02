# Mini E-Commerce Monorepo

Started as a take-home: a localized (**en** / **de**) product catalog built with **Next.js App Router** and **Payload CMS**. Now being extended into a fuller e-commerce exercise — auth, cart, checkout, orders, and a mock payment gateway — while staying structured as a learning project: every architectural decision gets an [ADR](docs/adr/), and [AGENTS.md](AGENTS.md) documents the conventions for anyone (human or AI) extending it.

**Package manager:** npm (workspaces)

## Project shape

```
apps/
  cms/   Payload CMS — catalog content only (Products, Media, admin auth).
         SQLite, own payload.db. Serves REST/GraphQL on :3001.
  web/   Storefront + BFF — commerce domain lives here (customers, cart,
         orders, payments). Talks to apps/cms over real HTTP, never the
         Payload Local API. Serves on :3000.
docs/adr/   One Markdown file per significant architectural decision.
```

This split (two separate Next.js apps, two separate processes, two separate databases) is itself an ADR — see [`docs/adr/0001-monorepo-content-commerce-split.md`](docs/adr/0001-monorepo-content-commerce-split.md) for the full reasoning, including why the commerce domain is deliberately **not** a Payload collection.

## Tech stack

- Next.js 16 App Router, React 19
- Payload CMS (SQLite, `apps/cms`)
- TanStack Query (client state in `apps/web`)
- Tailwind CSS + shadcn/ui
- Vitest (`apps/web`)

## Setup and run

```bash
npm install                 # installs both workspaces
npm run dev                 # starts apps/cms (:3001) and apps/web (:3000)
npm run seed                # optional — seeds ~9 EN/DE furniture products + media
```

Or run each app independently (useful when working on just one side):

```bash
npm run dev:cms   # http://localhost:3001
npm run dev:web   # http://localhost:3000
```

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
                                                   │  GET /api/stock     │
                                                   │  POST /api/cart     │
                                                   └─────────────────────┘
```

```text
apps/cms/
  collections/   Payload schemas (Product, Media, Users)
  lib/           notifyRevalidate — webhook to apps/web on product writes
  app/           Payload admin + REST/GraphQL routes (generated, don't edit)

apps/web/
  app/                  routing + composition only
  features/products/    domain: components, api, hooks, lib, queries, types
  shared/cms/           REST client + hand-written CMS response types
  shared/i18n/          locale routing (duplicated, not shared, from apps/cms)
```

| Path | Public URL | Owner |
|------|------------|--------|
| `apps/web/app/api/revalidate` | `:3000/api/revalidate` | apps/web — cache purge, called by apps/cms webhook |
| `apps/web/app/api/stock/[slug]` | `:3000/api/stock/[slug]` | apps/web — inventory stub |
| `apps/web/app/api/cart` | `:3000/api/cart` | apps/web — flaky cart stub |
| `apps/cms/app/admin` | `:3001/admin` | Payload admin |
| `apps/cms/app/api/*` | `:3001/api/*` | Payload REST + GraphQL |

Payload was chosen because it integrates directly with Next.js App Router, supports localization, generates TypeScript types, and makes it easy to demonstrate CMS-driven cache revalidation. apps/web treats it like any third-party headless CMS — see `apps/web/shared/cms/client.ts` + `apps/web/shared/cms/types.ts`: no generated Payload types or Local API calls cross the app boundary. Locales: `en` / `de` with URL prefixes, configured independently (and intentionally duplicated — see ADR 0001) in each app.

---

## Caching & freshness

| Surface | How | Tags |
|---------|-----|------|
| Landing (`/[lang]`) | `unstable_cache` → `getProducts(locale)` | `products` |
| PDP (`/[lang]/products/[slug]`) | `unstable_cache` + `generateStaticParams` | `product:{slug}` |

Locale is part of the cache **key**, not the tag — one save refreshes both locales for that slug, plus the listing. Editing one product does not bust other `product:{other}` entries.

**Flow:** CMS save (apps/cms) → Payload `afterChange`/`afterDelete` → `notifyRevalidate` → `POST` to apps/web's `/api/revalidate` (Bearer-authenticated webhook) → `revalidateTag` (`products`, `product:{slug}`, and `product:{previousSlug}` if renamed). The same endpoint also accepts manual/external purges (curl, webhook tools) via Bearer or `x-revalidate-secret`. See [`docs/adr/0002-webhook-based-revalidation.md`](docs/adr/0002-webhook-based-revalidation.md) for why this moved from an in-process call to a real webhook, and what that cost (no retry on delivery failure, no HMAC signing — intentionally lighter-weight than what the upcoming payment webhook will need).

**Why tags:** data-oriented — one document feeds listing + detail + locales without enumerating every path. Time-based ISR alone would leave content stale and wouldn't show CMS-driven freshness. Immediate expire (`expire: 0`) for demos; under load, stale-while-revalidate (`'max'`) would be preferable.

### Static vs client

| Data | Where | Why |
|------|-------|-----|
| Name, description, images, specs, **price** | CMS → Server Components → cached HTML | SEO / catalog; refreshed via revalidation |
| **Stock** | Client → TanStack Query → `/api/stock/[slug]` | Volatile; page paints while it loads |
| **Cart quantity** | Client → TanStack mutation → `/api/cart` | Optimistic UI demo |

Price stays in the CMS cache on purpose — treating it as client-only would hide the revalidation story. Stock changes often and isn't SEO-critical.

Simulate stock failure: `GET /api/stock/malmo-lounge-chair?fail=1`.

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
    Authorization: "Bearer dev-revalidate-secret-change-me",
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
| Tests | Started — Vitest in `apps/web`, see below |

### Optimistic add-to-cart

On a PDP, **Add to cart** updates **"N in cart"** immediately, then `POST /api/cart` confirms or rolls back (~40% random failure + latency). Mutation: `useAddToCart`; UI: `AddToCartButton`.

---

## Testing

Vitest lives in `apps/web`.

```bash
npm run test                        # from root — runs apps/web's suite
npm run test --workspace=apps/web   # equivalent, explicit
npm run test:watch --workspace=apps/web
```

Current coverage: `/api/revalidate` auth accept/reject + tag selection on rename (`apps/web/app/api/revalidate/route.test.ts`) — the highest-value test from the original take-home's testing plan, now also covering the webhook path end-to-end.

Planned, in priority order as each phase lands (see [AGENTS.md](AGENTS.md) "Testing"):

1. Auth: password hashing, JWT sign/verify/expiry, refresh-token rotation
2. Cart: guest↔user merge, quantity edge cases
3. Orders: total calculation, state transitions, authorization (owner-or-admin)
4. Payments: webhook signature verification, idempotency/replay safety

Money-critical and security-critical logic ships with tests in the same change, not retrofitted later.

---

## Roadmap

This project is being extended in phases, each landing with its own ADR(s). See [AGENTS.md](AGENTS.md) for conventions and [docs/adr/](docs/adr/) for the full decision log.

| Phase | Scope | Status |
|-------|-------|--------|
| 0 | AI workflow scaffolding — AGENTS.md, ADR template | ✅ Done |
| 1 | Monorepo split (apps/web + apps/cms), webhook revalidation, Vitest | ✅ Done |
| 2 | Customers & hand-rolled JWT auth (httpOnly cookies, refresh rotation) | Next |
| 3 | Persistent cart (guest + logged-in, server-side) | Planned |
| 4 | Checkout & orders (state machine, stock reservation) | Planned |
| 5 | Mock payment gateway (async, Stripe-style webhook + idempotency) | Planned |
| 6 | Frontend e-commerce polish (filtering, mini-cart, order confirmation) | Planned |
| 7 | CI (lint/typecheck/test on PR) | Planned |

### Tradeoffs / open items

| Area | Now | With more time |
|------|-----|----------------|
| Media | Local uploads | S3-compatible + CDN |
| Localization | Duplicated locale config per app | Shared workspace package if locales grow |
| Stock / cart | Stubs (not yet backed by real inventory) | Real stock field on Product; stock reservation on checkout |
| Revalidation delivery | Fire-and-forget, no retry | Queue + retries for webhook delivery |
| Secret compare | String equality | Constant-time comparison |
| New slugs | On-demand until next build | Clearer path registration |
