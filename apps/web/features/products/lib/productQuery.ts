import type {
  ProductFilters,
  SortKey,
} from "@/features/products/lib/productFilters";
import type { Locale } from "@/shared/i18n/locales";

/**
 * Payload sort strings (a leading `-` is descending, commas add tie-breakers).
 * Several products can share a price, and without a second key the database may
 * return them in a different order on each request, so both price sorts end in
 * `title`. A `Record` over `SortKey` makes a new sort key a type error until it
 * is mapped here.
 */
const PAYLOAD_SORT: Record<SortKey, string> = {
  title: "title",
  "title-desc": "-title",
  "price-asc": "price,title",
  "price-desc": "-price,title",
};

/**
 * The CMS query for the catalog facets only (category, price range, text, sort).
 * Live facets (`inStock`, `minQty`) are ignored: stock is not in the CMS.
 * Only parsed filters belong here; the values are not re-validated.
 */
export function buildProductSearchParams(
  filters: ProductFilters,
  locale: Locale,
): Record<string, string | number> {
  const params: Record<string, string | number> = {
    locale,
    depth: 1,
    limit: 100,
    sort: PAYLOAD_SORT[filters.sort],
  };

  if (filters.category !== undefined) {
    params["where[category.slug][equals]"] = filters.category;
  }
  if (filters.min !== undefined) {
    params["where[price][greater_than_equal]"] = filters.min;
  }
  if (filters.max !== undefined) {
    params["where[price][less_than_equal]"] = filters.max;
  }
  if (filters.q !== undefined) {
    params["where[title][like]"] = filters.q;
  }

  return params;
}

/**
 * Only filters with a finite set of values are cached: category (the CMS's
 * list) and sort (four keys). Free text and price bounds take any value the
 * URL can carry, so caching them would let a crawler fill the cache one
 * `?min=` at a time; those requests go to the CMS live.
 */
export function isCacheableQuery(filters: ProductFilters): boolean {
  return (
    filters.q === undefined &&
    filters.min === undefined &&
    filters.max === undefined
  );
}

/**
 * `unstable_cache` key parts for a cacheable query. Built only from the
 * cacheable facets, so a request that differs in a live facet (`inStock`,
 * `minQty`) shares the entry.
 */
export function productQueryCacheKey(
  locale: Locale,
  filters: ProductFilters,
): string[] {
  return ["products", locale, filters.category ?? "", filters.sort];
}
