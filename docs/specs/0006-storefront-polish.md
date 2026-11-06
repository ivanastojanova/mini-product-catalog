# Spec 0006: Frontend e-commerce polish (mini-cart, cart page, filtering, order confirmation)

**Status:** Done

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
- Settled when the mini-cart was built: the preview is requested when the dropdown opens, not in the background. The preview also sweeps expired holds, so it is not free (see "As built (mini-cart)").
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

1. [x] **Cart badge in the header.** Count only, from the existing cart query. Smallest visible win.
2. [x] **Cart page** `/[lang]/cart`: lines from the preview, quantity stepper, remove, subtotal, "Checkout" button, empty state. EN/DE.
3. [x] **Mini-cart dropdown** on the header badge, reusing the cart page's line components.
4. [x] **Checkout link in the header** becomes the cart. Absorbed into steps 2–3: step 1 had already replaced the separate "Checkout" text link with the cart badge, and the dropdown now holds the "View cart" link to `/[lang]/cart`.
5. [x] **Order confirmation polish** on `OrderView` for paid orders.
6. **Filtering**, in small pieces, each tested before the next:
   1. [x] Facet registry and URL parser (pure, unit tests). No UI or CMS change yet.
   2. [x] CMS `category` field and seed update (once the open question below is settled).
   3. [x] apps/web: `getProducts` takes parsed filters and builds the Payload query (catalog facets only), with cache rules.
   4. [x] apps/api: `GET /stock?slugs=` batch endpoint with tests.
   5. [x] apps/web: the live-facet step (in stock, minimum quantity).
   6. [x] The filter bar UI (debounced search, transitions, EN/DE), then a browser click-through.
7. [x] Tests and docs: pure helpers get unit tests (like the rest of apps/web); no component tests exist in the repo, so the UI is covered by a browser click-through. README and PLAN updated; an ADR is written if the filtering decision has real tradeoffs — written as [ADR 0011](../adr/0011-server-side-catalog-filtering.md).

## Out of scope

- Editing a pending order (Future dev fixes, option B).
- Confirmation email.
- Product reviews, wishlists, pagination of the catalog.

## As built (filtering)

Recorded after the filtering code landed; see [ADR 0011](../adr/0011-server-side-catalog-filtering.md) for the decision and tradeoffs.

- **Price bounds are not cached.** The original plan cached everything with a finite key space and named category and sort. Price bounds (`min`, `max`) look finite but accept any number up to `MAX_PRICE`, so they share the unbounded-key problem with free text and go to the CMS live. `isCacheableQuery` only allows category + sort.
- **The filter bar uses the Base UI primitives already in the repo** — `Select` and `Checkbox` wrappers in `apps/web/components/ui/` — not native `<select>` / `<input type="checkbox">`, matching `Button`, `Badge`, `Input` and `Field`.
- **The registry lives in `productFilters.ts`** rather than a separate file; it is the same single definition the spec asked for.
- **The home page is no longer statically rendered.** It reads `searchParams`, so it renders per request; the unfiltered data still comes from the cached `getProducts(locale)` entry, so the extra work is a cache hit rather than a CMS call.
- **Search and number inputs are debounced (350 ms)**; category, sort and the in-stock checkbox navigate immediately.
- **The stock batch endpoint is capped at 100 distinct slugs** (and a slug at 100 chars). apps/web de-duplicates and chunks its requests so a larger catalog keeps working without moving the filter into the data layer.
- **If apps/api fails while a live facet is active, the page errors** instead of showing an unfiltered list that would contradict the "in stock" filter.

## As built (cart page)

- **`/[lang]/cart` renders `GET /checkout/preview`**, so the lines, unit prices, subtotal and stock flags are the same numbers checkout will charge. The header badge now links here.
- **Quantity and remove are not optimistic.** They call the existing `PUT` / `DELETE /cart/items/:slug` and, on settle (success or failure), invalidate both the cart query and the priced preview. A failed response after apps/api applied the write therefore re-reads the server rather than leaving a guessed quantity on screen. The controls stay disabled until the write and the follow-up preview read are done, so a fast second click can't step from the old quantity.
- **The stepper is capped at the same per-line maximum as apps/api (10)**; one unit is the floor, and removal is its own button.
- **Line rendering is a separate `CartLineItem` component** so the step 3 mini-cart can reuse it instead of duplicating prices or controls.
- **A mixed-currency cart is a typed `mixed_currency` error** from the preview rather than a generic failure, and the cart page shows a localized explanation. Known limitation: the preview returns no lines in that state, so the offending line cannot be removed from the cart page yet; the message plus retry/browse is what it offers.
- **The empty state is the cart page's own**, not the checkout page's: "Your cart is empty", a browse link, and no checkout button.

## As built (mini-cart)

- **Built on the existing Base UI `Popover`** (`components/ui/popover.tsx`), not a new dependency. The header trigger is a button with the live unit badge; the panel contains the lines, subtotal, a "View cart" link and a "Checkout" link.
- **The preview is fetched when the popover opens, not in the background.** This settles the Decision 1 question with the user. `MiniCartPanel` is mounted only while the popup is open, so `useCheckoutPreview` does not run on every page view; the cost is a short skeleton on first open, and re-opening refetches (the preview's `gcTime` is 0).
- **The popover is controlled by `MiniCart`** so the links inside it close the panel before navigating. The header lives in the layout, so an uncontrolled popover would stay open across the route change.
- **It reuses `CartLineItem` (with a `compact` layout) and the same cart write hooks as the cart page**, so quantity/remove behavior — including locking controls until the refreshed preview arrives — cannot drift between the two.
- **States:** skeleton, empty with a browse link, load error with retry, mixed-currency explanation, and per-line stock problems. The panel offers "View cart" and "Checkout"; checkout still blocks if the cart has a problem.
- **It opens on click or keyboard only**, not hover, so it stays predictable for keyboard and touch users.

## As built (order confirmation)

- **Only `paid` orders get the confirmation panel.** It is additive: the status badge and its note stay, and `fulfilled` keeps its "on its way" note rather than showing a confirmation for an order that has moved on.
- **It shows the order number and the paid date**, formatted per locale by `features/orders/lib/formatDate.ts` (unit-tested; an unparseable timestamp omits the line).
- **The next steps are honest:** preparing for shipping, this page always shows the latest status, keep the link. There is deliberately no "we'll email you" step, because the project has no email service (out of scope for this phase).
- **No new route, no change to pending/declined/refunding states**, and the page stays `noindex`.

## Open questions

All settled during the build:

- **`category` modelling:** a `categories` collection (slug + localized name), with one optional relationship per product. The category list is fetched from the CMS (`getCategories`, cached under the `products` tag) and `?category=` is validated against it. The old `PRODUCT_CATEGORIES` placeholder is gone.
- **Localized labels:** yes — the name is localized in the CMS and the slug is the URL value.
- **Multiple categories per product:** single category for now. Multiple tags would make the field `hasMany` and the CMS `where` an "in".
