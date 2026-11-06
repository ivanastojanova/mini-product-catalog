# ADR 0011: Server-side catalog filtering through the CMS, with live stock facets applied in apps/web

**Status:** Accepted

**Date:** 2026-11-06

## Context

Phase 6 adds a search and filter bar to the catalog: text search on the title, category, a price range, sort, and live stock filters (in stock, minimum quantity). Until now the storefront listed every product from one cached CMS request. Full design in [spec 0006](../specs/0006-storefront-polish.md) (Decisions 2 and 3).

Two facts constrain the design:

1. **Catalog data lives in apps/cms** (title, price, category) and apps/web may only reach it over HTTP, never through the Local API ([ADR 0001](0001-monorepo-content-commerce-split.md)).
2. **Stock lives in apps/api** (`inventory`, `available = on_hand − reserved`), not in the CMS ([ADR 0007](0007-inventory-and-lazy-reservation-expiry.md)). Copying it into the CMS would be stale by the next order, and a CMS `where` on stock has nothing to match.

The catalog is about ten products today. That makes a browser-only filter viable, but it would not survive pagination or a larger catalog, and it would put sorting and filtering rules in a second place next to the CMS query.

## Decision

1. **All filter state lives in the URL**, e.g. `?q=lamp&category=lighting&min=100&max=900&inStock=1&minQty=2&sort=price-asc`. Filters survive reload, can be shared, and the back button works. The page and the filter bar never keep a second copy: the bar holds a local draft only while the shopper types.
2. **A facet registry is the single definition of a filter.** Each entry declares its URL key, the kind of value, where it runs (`cms` or `api`), and how to parse and serialize it. The URL parser validates against it, the query builder reads it, and the bar renders from the same list. Adding a filter means a typed CMS field plus one registry entry.
3. **Input from the URL is untrusted.** `parseProductFilters` drops anything it does not recognise, caps lengths, parses numbers, swaps an inverted price range, and accepts a category only if it is in the CMS's current category list. Nothing raw from the URL reaches the CMS.
4. **Catalog facets run in the CMS query.** Text → `where[title][like]`, category → `where[category.slug][equals]`, price → inclusive `greater_than_equal` / `less_than_equal`, sort → Payload's `sort`. Both price sorts add `title` as a tie-breaker so equal prices do not shuffle between requests.
5. **Live facets run in apps/web after the CMS query.** When `inStock` or `minQty` is set, apps/web asks apps/api's batch `GET /stock?slugs=` (public, `no-store`, capped at 100 distinct slugs, sweeps expired holds first) and filters the CMS result. A product missing from the answer counts as 0. CMS order is preserved.
6. **Categories are CMS content, not a constant.** A `categories` collection (validated lowercase slug + localized name) replaces the hard-coded list; each product has one optional `category` relationship. Editors add categories without a deploy, and apps/web validates `?category=` against the CMS list it fetches. Product reads take `depth: 1` for the relationship.
7. **Cache only what has a finite key space.** Category + sort go through `unstable_cache` under the existing `products` tag, so the current webhook invalidation keeps working. Free text and price bounds call the CMS live: any number up to the cap is a valid bound, so caching by value would let a crawler fill the cache one `?min=` at a time. A request with a live facet never caches its stock step.
8. **The unfiltered catalog keeps its cached data path.** The home page now reads `searchParams`, so it renders per request; the unfiltered request still resolves through the cached `getProducts(locale)` entry, and only filtered requests that are not cacheable hit the CMS live.

## Alternatives considered

- **Filter the full cached list in the browser** — simplest and fine at ten products, but it stops at the query's `limit` and duplicates sorting/filtering in the client. It does not scale to pagination, and the CMS is already a database that can do this.
- **Hybrid: category on the server, the rest in the browser** — a middle ground with none of the simplicity of the first option and none of the coherence of the chosen one.
- **Put stock in the CMS and filter everything in one query** — one query and one filter language, but stock changes on every order and hold. Writing it back from apps/api per order would add a second consistency problem across services.
- **A dedicated search service (Meilisearch, Typesense, Postgres full-text)** — the honest answer for a large catalog with facets and pagination. It is another service to run and keep in sync, which this project does not need yet. The trigger to revisit is pagination or a much larger catalog (see Consequences).
- **Cache every filter combination** — unbounded key space from `q`, `min` and `max`; a crawler can mint a new cache entry per request. Rejected in favour of caching only finite facets.
- **Hard-code the category list in apps/web** — one fewer CMS collection, but a new category would need a code change and a deploy, and the labels are already localized in the CMS.
- **Raise the batch stock endpoint's cap instead of chunking in apps/web** — moves the limit rather than removing it, and lets one request ask for an unbounded amount of work.

## Consequences

**Easier:**
- Adding a property is a typed CMS field plus one registry entry; the parser, query builder and bar all follow.
- Filters are shareable, reload-safe and back-button-safe, with no client-side state library.
- One definition of "what the catalog query is" (`buildProductSearchParams`), unit-tested independently of the CMS.
- The existing `products` tag still invalidates filtered listings, categories included.

**Harder / accepted debt:**
- **Two-step reads can disagree.** The CMS query and the stock batch are separate requests; stock can change in between. The window is small and the stock value is the authoritative read, so a product can only be momentarily misclassified at the edges of the filter.
- **Pagination plus a live facet would give wrong page counts.** A page of 20 from the CMS can shrink after the stock filter. Pagination is out of scope now; if the catalog needs it, the stock filter has to move into the data layer (or a search service), which means revisiting this ADR.
- **Known SQLite limitation:** `LIKE` is case-insensitive only for ASCII. `?q=MALMÖ` finds nothing. Accepted for now; accent folding or a proper search index is the fix.
- **`LIKE` treats `%` and `_` as wildcards.** A query of `%` matches everything. It is a read-only title search, so this is harmless but unescaped.
- **Most filtered views are uncached** (free text, price bounds), so they cost a CMS request per page view. Category and sort combinations stay cached.
- **The category relationship adds `depth` to product reads**, and every product currently has at most one category. Multiple tags would need `hasMany` and an "in" query.
- **The filter bar is browser-tested, not unit-tested.** The pure pieces (parser, query builder, live filter, draft) have tests; the rendered component does not, because the repo has no component-test setup.
- **Production needs a Payload migration** for the new category tables; Payload only auto-pushes schema in development.

## Related

- [Spec 0006](../specs/0006-storefront-polish.md) (Decisions 2 and 3), [ADR 0001](0001-monorepo-content-commerce-split.md), [ADR 0007](0007-inventory-and-lazy-reservation-expiry.md), [ADR 0002](0002-webhook-based-revalidation.md)
- `apps/web/features/products/lib/productFilters.ts` (facet registry, URL parser), `productQuery.ts` (Payload query, cache rule), `liveFilters.ts`, `filterDraft.ts`
- `apps/web/features/products/api/products.ts` (`getProducts`, `getFilteredProducts`), `api/categories.ts`, `api/stock.ts`
- `apps/web/features/products/components/ProductFilterBar.tsx`, `apps/web/app/[lang]/page.tsx`
- `apps/cms/collections/Category.ts`, `apps/cms/collections/Product.ts`, `apps/cms/seed/categories.ts`
- `apps/api/src/inventory/routes/stock.ts` (`GET /stock?slugs=`)
