# Spec 0006: Frontend e-commerce polish (mini-cart, cart page, filtering, order confirmation)

**Status:** In progress (scope settled; filtering design settled, CMS `categories` collection built, seed and apps/web wiring next)

**Phase:** 6

**Related:** [Spec 0003](0003-cart.md) (cart API and the one-query cart cache), [Spec 0004](0004-checkout.md) (`GET /checkout/preview`, which prices a cart), [Spec 0005](0005-payments.md) (order page and payment states).

## Context

Phases 2 to 5 built the whole commerce backend and a working but bare storefront. The only cart UI is the "N in cart" label on a product page, and the header "Checkout" link doubles as the cart review. The catalog home page lists every product with no way to narrow it. This phase makes the storefront feel like a shop. It is mostly apps/web work, plus one small CMS schema change.

## Settled decisions (agreed with the user)

| Question | Decision |
|---|---|
| Mini-cart shape | Header cart button with an item-count badge that opens a dropdown (lines, quantity change, remove, subtotal, link to cart page). Plus a full `/[lang]/cart` page that links on to checkout. Built with the Base UI primitives already used (no new dependency, to be confirmed when we get there). |
| Pending-order "Continue shopping" issue | **Left alone** for this phase (stays under *Future dev fixes* in PLAN.md). |
| Order confirmation | Polish only: a clear "payment received" state on paid orders with next steps, EN/DE copy. No new routes, no email (email needs a service and a dependency, so it needs separate sign-off). |
| Filtering: what | One search and filter bar: text search on title, category, price range, sort by price/name, and live stock filters (in stock, minimum quantity). Built on a facet registry so more properties can be added later (Decision 3). Needs a `category` field in the CMS (plus seed update). |
| Filtering: where it runs | **Server-side through the CMS query** (chosen by the user after weighing client-side and hybrid options, see Decision 2). |

## Decision 1: Cart data for the new UI

The cart API returns slug + quantity only (Spec 0003). Titles and prices live in the CMS and are priced by apps/api at `GET /checkout/preview?locale=`. The mini-cart and cart page should show titles, unit prices and a subtotal, so they read the **preview** rather than re-implementing pricing in apps/web. That keeps one definition of "what this cart costs" and reuses the `insufficient_stock` / `unknown_product` flags.

- The count badge only needs the cart query (`cartKeys.current()`), which is already shared. It must not wait for the preview.
- Quantity change and remove call the existing `PUT` / `DELETE /cart/items/:slug`. After each, the cart query and the preview are refreshed.
- To decide when we build it: whether the preview request is made when the dropdown opens or in the background. The preview also sweeps expired holds, so it is not free.
- The preview returns `409` for mixed currencies. The UI needs a readable state for that, not a blank panel.

## Decision 2: Filtering runs server-side through the CMS query

**Chosen:** the storefront reads filters from the URL (`?q=&min=&max=&category=&sort=`), validates them, and passes them to Payload's REST `where` / `sort`. The alternatives considered were filtering the full cached list in the browser (simplest, fine for ~10 products, stops at the existing `limit: 100`) and a hybrid (category on the server, the rest in the browser). The user chose the server-side route. It scales, it is the natural base for pagination, and the database sorts and filters.

**Checked against the live CMS (SQLite):**

| Query | Result |
|---|---|
| `where[price][greater_than_equal]` + `[less_than_equal]` with `sort=-price` | Works |
| `sort=title` with `locale=de` | Works, sorted by the German title |
| `where[title][like]=lamp` / `LAMP` | Matches (case-insensitive) |
| `where[title][like]=malmö` | Matches |
| `where[title][like]=MALMÖ` or `Ö` | **No match.** SQLite `LIKE` is only case-insensitive for ASCII |
| `where[title][like]=malmo` | No match (no accent folding) |

**Consequences to design for:**
- **Known limitation:** a search with an uppercase non-ASCII letter finds nothing. Accepted for now. If it matters, the options are lowercasing the query in apps/web (does not help for uppercase letters stored in titles) or moving text search to the browser.
- **The home page becomes dynamic when filters are present.** Reading `searchParams` opts the page out of static rendering. The unfiltered view should stay on the cached `getProducts` path.
- **Cache keys:** filter combinations with a finite set of values (category, sort) can use `unstable_cache` keyed by the normalised filters and tagged `products`, so the existing webhook invalidation still covers them. Free-text `q` has an unbounded key space and **skips the cache** (a live CMS call).
- **Input is untrusted.** Filters from the URL are parsed by a pure function that whitelists `sort` and `category`, parses numbers, drops anything invalid and clamps lengths. Nothing from the URL is forwarded to the CMS unparsed. This gets unit tests.
- **UX:** search input is debounced; changing a filter uses a transition so the old results stay visible while the new ones load; filters survive reload and can be shared.
- Write this up as an ADR when the filtering code lands.

## Decision 3: Search and filter bar, with a facet registry and a two-step flow

**Goal (from the user):** one search and filter bar: text search, then category/tag, stock or quantity, and later other product properties.

**Why the CMS alone is not enough.** Stock lives in apps/api (`inventory`: on hand minus held by unpaid orders, with expired holds released lazily on read), not in Payload. A CMS `where` on stock has nothing to match, and copying stock into the CMS would be wrong (it changes on every order and hold). So filters come in two kinds:

| Kind | Examples | Data lives in | Filtered by |
|---|---|---|---|
| Catalog facets | text search, category/tag, price, later material, colour | apps/cms | Payload `where` / `sort` |
| Live facets | in stock, minimum quantity available | apps/api | apps/web, after fetching availability from apps/api |

**One URL.** All state is in the query string, e.g. `?q=&category=&min=&max=&inStock=1&sort=`.

**Facet registry.** One file in `features/products/lib/` lists every filter: URL key, type (`text`, `select`, `range`, `boolean`), where it runs (`cms` or `api`), and for CMS facets how it becomes a Payload `where` clause. The filter bar renders from the registry and the URL parser validates against it. Adding a property later means a typed CMS field plus one registry entry, with no new plumbing. The parser is pure and unit-tested (whitelisted values, numbers parsed and clamped, invalid input dropped, nothing forwarded to the CMS unparsed).

**Two-step flow in apps/web (server):**
1. Query the CMS for the catalog facets (search, category, price, sort).
2. If a live facet is set, call a new batch endpoint on apps/api, `GET /stock?slugs=a,b,c`, and drop products that fail the test. The endpoint wraps the existing `getAvailability(db, slugs)`, sweeps expired holds first like `GET /stock/:slug`, is public, and sends `Cache-Control: no-store`. It needs a cap on the number of slugs and tests. Built: `{ items: [{ slug, inStock, quantity }] }`, capped at 100 distinct slugs (over the cap is a 400, never a silent truncation).

**Cache.** Requests whose catalog facets have a finite set of values (category, sort) use `unstable_cache` under the `products` tag. Free-text `q` and the price bounds `min`/`max` (any number up to `MAX_PRICE` is valid) skip the cache and call the CMS live. Any request with a live facet never caches the stock step.

**Known limits, accepted:**
- Pagination plus a live facet gives wrong page counts (a page of 20 from the CMS can shrink after the stock filter). Not an issue at about 10 products. If the catalog needs pagination, the stock filter has to move into the data layer (a search service). That is the trigger to revisit, and it goes in the ADR.
- `specifications` (localized free-text label/value pairs) is **not** a filter source. Anything filterable gets its own typed field (a select with fixed values). A product with several tags would use a multi-select (`hasMany`), and the registry entry changes from "equals" to "in".

## Decision 4: Build order (small pieces, each clickable before the next)

1. **Cart badge in the header.** Count only, from the existing cart query. Smallest visible win.
2. **Cart page** `/[lang]/cart`: lines from the preview, quantity stepper, remove, subtotal, "Checkout" button, empty state. EN/DE.
3. **Mini-cart dropdown** on the header badge, reusing the cart page's line components.
4. **Checkout link in the header** becomes the cart (the current "Checkout" link goes to the cart page; the cart page leads to checkout).
5. **Order confirmation polish** on `OrderView` for paid orders.
6. **Filtering**, in small pieces, each tested before the next:
   1. Facet registry and URL parser (pure, unit tests). No UI or CMS change yet.
   2. CMS `category` field and seed update (once the open question below is settled).
   3. apps/web: `getProducts` takes parsed filters and builds the Payload query (catalog facets only), with cache rules.
   4. apps/api: `GET /stock?slugs=` batch endpoint with tests.
   5. apps/web: the live-facet step (in stock, minimum quantity).
   6. The filter bar UI (debounced search, transitions, EN/DE), then a browser click-through.
7. Tests and docs: pure helpers get unit tests (like the rest of apps/web); no component tests exist in the repo, so the UI is covered by a browser click-through. README and PLAN updated; an ADR is written if the filtering decision has real tradeoffs.

## Out of scope

- Editing a pending order (Future dev fixes, option B).
- Confirmation email.
- Product reviews, wishlists, pagination of the catalog.

## Open questions

- **`category` modelling: decided, a `categories` collection** (not a fixed select). Editors add categories in the admin without a deploy and names are localized. Each product has one optional `category` relationship. The category list is **not** hard-coded in apps/web: apps/web fetches it from the CMS (cached under the `products` tag) and validates `?category=` against the fetched slugs. That replaces the proposed `PRODUCT_CATEGORIES` constant in `productFilters.ts`, which is now only a placeholder and gets removed in the next piece. Still to do: a single category per product for now; multiple tags would make `category` `hasMany` and the CMS `where` an "in".
- Category `slug` is validated in the CMS (lowercase words joined by hyphens) so it is safe in URLs and with `equals`. It is the URL value; the localized `name` is the label. A collection gives localized names and lets editors add categories without a code change, at the cost of a relationship and `depth` on every product read.
- Does the `category` need localized labels (the CMS already localizes title/description)? Decide with the CMS change.
