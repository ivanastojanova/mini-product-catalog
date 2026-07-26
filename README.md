# Mini Product Catalog

Next.js App Router + Payload CMS product catalog. Catalog pages are statically generated / cached and kept fresh with on-demand tag revalidation — no redeploy when editors change content. Stock availability is fetched client-side with TanStack Query.

**Package manager:** npm

## Setup and run

```bash
# Env vars (copy from your local .env or create one)
# DATABASE_URL=file:./payload.db
# PAYLOAD_SECRET=<random string>
# REVALIDATE_SECRET=<shared secret for POST /api/revalidate>

npm install
npm run dev
npm run seed   # optional — seeds ~5 EN/DE furniture products + media
```

| What | URL |
|------|-----|
| Storefront | [http://localhost:3000](http://localhost:3000) (`/` → `/en`) |
| Payload admin | [http://localhost:3000/admin](http://localhost:3000/admin) |

**Env vars**

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | SQLite file for Payload (e.g. `file:./payload.db`) |
| `PAYLOAD_SECRET` | Payload encryption / sessions |
| `REVALIDATE_SECRET` | Bearer / header secret for `POST /api/revalidate` |

Products can also be added by hand in `/admin` — the seed script is convenience, not required.

---

## How to see content freshness working

1. Open a product page, e.g. `/en/products/malmo-lounge-chair`, and note the title/description.
2. In Payload admin (`/admin`), edit that product and save.
3. Refresh the storefront page (no restart, no redeploy) — the change should appear.
4. Optionally purge via the secured endpoint:

```bash
curl -X POST http://localhost:3000/api/revalidate \
  -H "Authorization: Bearer $REVALIDATE_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"slug":"malmo-lounge-chair"}'
```

Or paste into the browser console on `localhost:3000` (uses the default `REVALIDATE_SECRET` from `.env`):

**Authorized — expect `200` + `{ revalidated: true, tags: [...] }`:**

```js
fetch("http://localhost:3000/api/revalidate", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: "Bearer dev-revalidate-secret-change-me",
  },
  body: JSON.stringify({ slug: "malmo-lounge-chair" }),
})
  .then(async (response) => {
    console.log("Status:", response.status);
    const data = await response.text();
    try {
      return JSON.parse(data);
    } catch {
      return data;
    }
  })
  .then((result) => console.log("Body:", result))
  .catch((error) => console.error("Error:", error));
```

**Unauthorized (no Bearer) — expect `401`:**

```js
fetch("http://localhost:3000/api/revalidate", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ slug: "malmo-lounge-chair" }),
})
  .then(async (response) => {
    console.log("Status:", response.status);
    const data = await response.text();
    try {
      return JSON.parse(data);
    } catch {
      return data;
    }
  })
  .then((result) => console.log("Body:", result))
  .catch((error) => console.error("Error:", error));
```

Payload `afterChange` / `afterDelete` hooks already call `revalidateTag` in-process on save, so the curl / console steps are for webhooks / manual purge / demoing the secured API.

---

## Caching & freshness strategy

### What is cached

| Surface | How | Tags |
|---------|-----|------|
| Landing (`/[lang]`) | `unstable_cache` around `getProducts(locale)` | `products` |
| PDP (`/[lang]/products/[slug]`) | `unstable_cache` around `getProduct(slug, locale)` + `generateStaticParams` | `product:{slug}` |

Locale is part of the cache **key**, not the tag — one product edit invalidates both EN and DE detail caches for that slug, plus the listing.

### How it stays fresh

1. Pages are statically generated / served from cache (not refetched from the CMS on every request).
2. On CMS write, Payload hooks call `revalidateProductCache`, which runs `revalidateTag` for:
   - `products` — landing updates
   - `product:{slug}` — that PDP updates
   - `product:{previousSlug}` — if the slug was renamed
3. `POST /api/revalidate` does the same invalidation for external webhooks / manual use.

Editing one product does **not** bust every other `product:{other}` entry.

### Why tags (not only path revalidation or timed ISR)

- **`revalidateTag`** is data-oriented: one document feeds listing + detail (+ locales) without enumerating every path.
- **`revalidatePath`** works but gets brittle as routes grow (`/en`, `/de`, `/en/products/x`, …).
- **Time-based ISR alone** would leave content stale for up to N seconds and wouldn’t demonstrate CMS-driven freshness. Tags can sit alongside a long safety TTL later; this app relies on on-demand invalidation.

Hooks / API use `revalidateTag(tag, { expire: 0 })` so the next request refetches immediately (good for demos and editorial confidence). Under heavy traffic, `revalidateTag(tag, 'max')` (stale-while-revalidate) would be preferable.

### Secured revalidation (bonus)

`POST /api/revalidate` requires:

```http
Authorization: Bearer <REVALIDATE_SECRET>
```

or `x-revalidate-secret: <REVALIDATE_SECRET>`. Missing/wrong secret → `401`. Unconfigured secret → `500`.

In-process Payload hooks do not go through HTTP. The seed script passes `context: { disableRevalidate: true }` so CLI seeding does not need the Next cache runtime.

---

## Static vs client boundary

| Data | Where | Why |
|------|-------|-----|
| Name, description, images, specs, **price** | CMS → Server Components → cached HTML | SEO / catalog content; changes with editorial workflow; refreshed via revalidation |
| **Stock / availability** | Client → TanStack Query → `GET /api/stock/[slug]` | Volatile inventory; not SEO-critical; page shell paints immediately while stock loads |
| **Cart quantity** | Client → TanStack Query mutation → `POST /api/cart` | Interactive demo of optimistic updates; flaky stub so rollback is visible |

**Why stock and not live price?** Stock changes often and rarely belongs in a statically cached document. Price is commercial catalog data editors manage in the CMS and expect to revalidate with the rest of the product. Making price client-only would duplicate the source of truth and hide the revalidation story.

### Client stock flow

1. Static PDP renders immediately (CMS fields).
2. `ProductStock` calls `useProductStock(slug)` → TanStack Query.
3. Query hits a **stub inventory BFF** (`/api/stock/[slug]`) — deterministic quantity from the slug + artificial delay, not Payload.
4. Loading → skeleton; error → message + **Retry**; success → quantity or out-of-stock.

Simulate failure: `GET /api/stock/malmo-lounge-chair?fail=1`.

---

## Architecture choices

### Why Payload in the same Next.js app

Payload is code-first and runs inside this repo with local SQLite — no external CMS account, one `npm run dev`, admin + storefront on the same origin. That got the interesting parts (caching, revalidation, TanStack Query) in front fastest.

A seed script (`npm run seed`) avoids hand-entering ~5 products for demos; admin entry still works fine.

### What I’d prefer in production

I’d split into a monorepo (`apps/web`, `apps/cms` or similar): separate deploy units, clearer ownership, and a self-hosted (or managed) CMS that the storefront talks to over HTTP / webhooks. The storefront would still own `POST /api/revalidate`; only the trigger would be an external webhook instead of an in-process hook. Embedding Payload was a deliberate convenience tradeoff for this exercise, not the long-term shape I’d ship.

### Feature folders & route ownership

I chose a feature/domain folder layout so each domain (e.g. products) owns its UI, API clients, hooks, and types in one place. Adding another domain is mostly adding a sibling folder under `features/`, ownership stays clear, and most day-to-day changes stay inside that feature — which keeps reviews focused and reduces cross-cutting merge conflicts. Cross-cutting concerns (i18n, CMS client, providers) live in `shared/`.

**High-level structure** (routing stays thin; business logic lives in features):

```text
.
├── app/                          # Next.js App Router — routing / composition only
│   ├── (frontend)/
│   │   └── [lang]/
│   │       ├── page.tsx          # Catalog — imports ProductGrid from features
│   │       └── products/[slug]/
│   │           └── page.tsx      # PDP — composes ProductGallery, ProductHeader, …
│   ├── (payload)/                # Payload admin + CMS API (route group)
│   └── api/                      # Storefront BFF stubs (stock, cart, revalidate)
├── features/                     # Self-contained business domains
│   └── products/                 # Products feature (cart/stock UI live here for now)
│       # Future siblings e.g. checkout/, search/ when those domains grow
├── shared/                       # Cross-cutting app concerns
│   ├── cms/                      # Payload client, revalidation helpers
│   ├── i18n/                     # Locales, routing helpers, language switcher
│   └── providers/                # e.g. TanStack QueryProvider
├── components/ui/                # Global shared UI primitives (Button, Badge, Skeleton)
├── collections/                  # Payload collection schemas (CMS model)
└── seed/                         # Demo data scripts
```

**Internal anatomy of a feature folder** — each feature acts as an isolated mini-module:

```text
features/products/
├── components/                   # Feature-specific UI
│   ├── ProductCard.tsx
│   ├── ProductGrid.tsx
│   ├── ProductHeader.tsx
│   ├── ProductStock.tsx
│   └── AddToCartButton.tsx
├── api/                          # Client/server data access for this domain
│   ├── products.ts               # CMS reads (cached listing / PDP)
│   ├── stock.ts                  # Client fetch → /api/stock/[slug]
│   └── cart.ts                   # Client fetch → /api/cart
├── hooks/                        # Feature-specific TanStack Query hooks
│   ├── useProductStock.ts
│   └── useAddToCart.ts
├── queries/                      # Query key factories
│   └── productKeys.ts
├── lib/                          # Mappers, formatters, cache tag helpers
├── types/                        # Types exclusive to this feature
│   ├── product.ts
│   └── cart.ts
```

Pages under `app/` should mostly import and compose feature exports — not own business logic.

Route groups don’t change URLs; they clarify ownership:

| Path on disk | Public URL | Owner |
|--------------|------------|--------|
| `app/api/revalidate` | `/api/revalidate` | Storefront — cache purge |
| `app/api/stock/[slug]` | `/api/stock/[slug]` | Storefront — inventory stub |
| `app/api/cart` | `/api/cart` | Storefront — flaky cart stub (optimistic UI demo) |
| `app/(payload)/api/[...slug]` | `/api/...` | Payload REST |
| `app/(payload)/admin` | `/admin` | Payload admin |

### Multilanguage from the start (bonus)

Locales: `en` (default), `de` — URL-prefixed: `/en/...`, `/de/...`.

I built localization into the routing and CMS model up front. Retrofitting `[lang]` later tends to reshuffle the App Router tree, cache keys, and git history for little gain. A language switcher lives in the layout.

Payload: one product document with localized fields (`title`, `description`, `specifications`); shared fields (`slug`, `price`, `currency`, `images`). Revalidation tags are slug-based, so one save refreshes both locales.

`proxy.ts` redirects `/` → `/en` (Next.js 16: middleware → proxy). No Accept-Language detection on purpose — URLs stay explicit and shareable.

---

## Bonus checklist

| Bonus | Status |
|-------|--------|
| Secured revalidation endpoint | Done — Bearer / `x-revalidate-secret` |
| Multilanguage (2 locales) | Done — `en` / `de` + switcher |
| Optimistic cart (TanStack) | Done — see **MY BONUS** below |
| Tests | Not done — see **Testing strategy** below |

---

## Testing strategy

Not implemented yet. Suggested focus (Vitest + Testing Library; E2E optional):

| Layer | What |
|-------|------|
| Unit | `revalidateProductCache` tag selection; `mapProduct` / formatters |
| Route | `/api/revalidate` auth accept/reject; `/api/stock` + `/api/cart` contracts |
| Component | `ProductStock` loading/error/retry; `AddToCartButton` optimistic update + rollback |
| Manual | CMS edit → storefront freshness (already documented above) |

Practical order: (1) `revalidateProductCache` + revalidate route auth, (2) stock route + `ProductStock`, (3) cart optimistic test. That covers the three pillars: freshness, client boundary, and the cart bonus.

---

## MY BONUS

**Add to cart with TanStack Query optimistic updates** — on the product detail page.

### What it does

1. Click **Add to cart** on a PDP (e.g. `/en/products/malmo-lounge-chair`).
2. The **“N in cart”** count updates immediately (optimistic write to the query cache).
3. `POST /api/cart` runs with artificial latency and **~40% random failure**.
4. On success → cache is confirmed with the server quantity.
5. On failure → cache rolls back to the previous quantity and a short error message appears under the button.

### Why this shape

- Reuses the same client boundary as stock: Server Components for catalog content, TanStack Query for interactive / volatile UI.
- The cart API is intentionally flaky and in-memory (resets on server restart) so the optimistic rollback is easy to demo without a real checkout backend.
- Mutation lives in `useAddToCart` (`onMutate` → `onError` rollback → `onSuccess` confirm); UI is `AddToCartButton`.

### How to try it

1. Open any product page and click **Add to cart** a few times.
2. Watch the cart count jump up right away.
3. When the request fails (random), the count reverts and you see: *Could not add to cart. Please try again.*

---

## Tradeoffs / what I’d do differently with more time

| Area | Now | With more time |
|------|-----|----------------|
| Deploy shape | Payload embedded in the Next app | Monorepo: `apps/web` + `apps/cms`, webhook → storefront `/api/revalidate` |
| Media | Local Payload upload storage | S3-compatible object storage (R2/S3) + CDN |
| Stock | Deterministic `/api/stock` stub | Real inventory service |
| Cart | In-memory flaky stub under `features/products` | Persistent cart (cookie / DB); extract `features/cart` if it grows |
| Revalidation (webhook path) | In-process hook + single HTTP call | Queue + retries so a failed webhook isn’t lost |
| Build-time content | `generateStaticParams` hits Payload DB | Dedicated content-delivery API at scale |
| Tests | Not yet | See **Testing strategy** — revalidate auth, tag selection, stock/cart contracts |
