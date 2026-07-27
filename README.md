# Mini Product Catalog

Localized (**en** / **de**) product catalog built with **Next.js App Router** and **Payload CMS**. Product pages are **Server Components** so HTML is generated on the server and can be statically cached while still benefiting from SEO. Server Components allow product data to be fetched on the server, reduce the client-side JavaScript bundle, and work naturally with static generation and caching. CMS edits stay fresh via on-demand tag revalidation — no redeploy. Stock availability and cart interactions are handled client-side with TanStack Query.

**Package manager:** npm

## Tech stack

- Next.js 16 App Router
- React 19
- Payload CMS (SQLite, embedded)
- TanStack Query
- Tailwind CSS
- shadcn/ui

## Setup and run

```bash
# Env: DATABASE_URL, PAYLOAD_SECRET, REVALIDATE_SECRET
npm install
npm run dev
npm run seed   # optional — seeds ~5 EN/DE furniture products + media
```

| What | URL |
|------|-----|
| Storefront | [http://localhost:3000](http://localhost:3000) (`/` → `/en`) |
| Payload admin | [http://localhost:3000/admin](http://localhost:3000/admin) |

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | SQLite file (e.g. `file:./payload.db`) |
| `PAYLOAD_SECRET` | Payload sessions |
| `REVALIDATE_SECRET` | Auth for `POST /api/revalidate` |

Products can also be added by hand in `/admin` — the seed script is convenience, not required.

---

## Architecture

The App Router is intentionally kept thin. Pages are responsible for routing and composition, while business logic, data access and UI live inside feature modules.

```text
CMS write (Payload admin / seed)
        │
        ▼
┌───────────────────┐     revalidateTag      ┌─────────────────────┐
│  Payload CMS      │ ─────────────────────► │  Next.js cache      │
│  (SQLite + admin) │   products             │  unstable_cache     │
└───────────────────┘   product:{slug}       └──────────┬──────────┘
                                                        │
                        Server Components                 │
                     (SSG + unstable_cache)               │
                                                        ▼
                                              ┌─────────────────────┐
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
app/                 # routing + composition only
features/products/   # domain: components, api, hooks, types
shared/              # cms, i18n, providers
collections/         # Payload schemas
```

| Path on disk | Public URL | Owner |
|--------------|------------|--------|
| `app/api/revalidate` | `/api/revalidate` | Storefront — cache purge |
| `app/api/stock/[slug]` | `/api/stock/[slug]` | Storefront — inventory stub |
| `app/api/cart` | `/api/cart` | Storefront — flaky cart stub |
| `app/(payload)/admin` | `/admin` | Payload admin |

Payload was chosen because it integrates directly with Next.js App Router, supports localization, generates TypeScript types, and makes it easy to demonstrate CMS-driven cache revalidation within a single application. It runs in the same Next.js process for this exercise (one `npm run dev`, local SQLite). Locales: `en` / `de` with URL prefixes from the start.

---

## Caching & freshness

| Surface | How | Tags |
|---------|-----|------|
| Landing (`/[lang]`) | `unstable_cache` → `getProducts(locale)` | `products` |
| PDP (`/[lang]/products/[slug]`) | `unstable_cache` + `generateStaticParams` | `product:{slug}` |

Locale is part of the cache **key**, not the tag — one save refreshes both locales for that slug, plus the listing. Editing one product does not bust other `product:{other}` entries.

**Flow:** CMS save → Payload `afterChange` / `afterDelete` → `revalidateTag` (`products`, `product:{slug}`, and `product:{previousSlug}` if renamed). `POST /api/revalidate` does the same for webhooks / manual purge (Bearer or `x-revalidate-secret`).

**Why tags:** data-oriented — one document feeds listing + detail + locales without enumerating every path. Time-based ISR alone would leave content stale and wouldn’t show CMS-driven freshness. Immediate expire (`expire: 0`) for demos; under load, stale-while-revalidate (`'max'`) would be preferable.

### Static vs client

| Data | Where | Why |
|------|-------|-----|
| Name, description, images, specs, **price** | CMS → Server Components → cached HTML | SEO / catalog; refreshed via revalidation |
| **Stock** | Client → TanStack Query → `/api/stock/[slug]` | Volatile; page paints while it loads |
| **Cart quantity** | Client → TanStack mutation → `/api/cart` | Optimistic UI demo |

Price stays in the CMS cache on purpose — treating it as client-only would hide the revalidation story. Stock changes often and isn’t SEO-critical.

Simulate stock failure: `GET /api/stock/malmo-lounge-chair?fail=1`.

---

## Demo: content freshness

1. Open `/en/products/malmo-lounge-chair` and note the title.
2. Edit the product in `/admin` and save.
3. Refresh the storefront — change appears without restart/redeploy.

Optional purge (`curl` or browser console on `localhost:3000`):

```bash
curl -X POST http://localhost:3000/api/revalidate \
  -H "Authorization: Bearer $REVALIDATE_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"slug":"malmo-lounge-chair"}'
```

**Authorized (expect `200`):**

```js
fetch("/api/revalidate", {
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
fetch("/api/revalidate", {
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
| Secured revalidation | Done — Bearer / `x-revalidate-secret` |
| Multilanguage (`en` / `de`) | Done — switcher in layout |
| Optimistic cart | Done — see below |
| Tests | Not yet — see Additional Notes |

### Optimistic add-to-cart

On a PDP, **Add to cart** updates **“N in cart”** immediately, then `POST /api/cart` confirms or rolls back (~40% random failure + latency). Mutation: `useAddToCart`; UI: `AddToCartButton`.

---

## Additional Notes

### Production architecture

Embedding Payload was a convenience tradeoff. In production I’d prefer a monorepo (`apps/web`, `apps/cms`): separate deploys, self-hosted CMS, storefront still owns `POST /api/revalidate` — triggered by webhook instead of an in-process hook.

### Tradeoffs / next steps

| Area | Now | With more time |
|------|-----|----------------|
| Deploy | Payload in Next app | Monorepo + webhook revalidation |
| Media | Local uploads | S3-compatible + CDN |
| Localization | Payload localization | Translation workflow / fallback locales |
| Stock / cart | Stubs | Real inventory; persistent cart (`features/cart` if it grows) |
| Revalidation under load | `expire: 0` | Stale-while-revalidate; queue + retries for webhooks |
| Secret compare | String equality | Constant-time comparison |
| New slugs | On-demand until next build | Clearer path registration |

### Testing strategy

Not implemented due to the scope of the assignment. Given more time, I would prioritize (Vitest + Testing Library):

1. `revalidateProductCache` tag selection + `/api/revalidate` auth accept/reject  
2. Stock route + `ProductStock` loading/error/retry  
3. Cart optimistic update + rollback  

That covers freshness, the client boundary, and the cart bonus.
