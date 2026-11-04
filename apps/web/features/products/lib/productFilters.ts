/**
 * Every storefront product filter, in one place: its URL key, where it runs
 * (the CMS query or apps/api's live stock), how a raw URL string becomes a
 * value, and how a value goes back into the URL. The filter bar and the CMS
 * query builder read this registry, so a new filter is one entry here plus a
 * typed CMS field, not new plumbing.
 *
 * Everything in the URL is untrusted: a facet's `parse` returns `undefined`
 * for anything it does not accept, and nothing unparsed is used downstream.
 */

/**
 * Shape of a category slug. A copy of apps/cms's `CATEGORY_SLUG_PATTERN`
 * (separate deploys, see ADR 0001). Checked before the slug is compared with
 * the CMS's category list, so a malformed value is never forwarded anywhere.
 */
export const CATEGORY_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const MAX_CATEGORY_SLUG_LENGTH = 60;

export const SORT_KEYS = [
  "title",
  "title-desc",
  "price-asc",
  "price-desc",
] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export const DEFAULT_SORT: SortKey = "title";

export const MAX_SEARCH_LENGTH = 80;
export const MAX_PRICE = 1_000_000;
export const MAX_MIN_QTY = 999;

export type ProductFilters = {
  /** Free-text search on the (localized) title. */
  q?: string;
  /** A category slug that exists in the CMS (checked by `parseProductFilters`). */
  category?: string;
  /** Price bounds in major units (the CMS's `price`), inclusive. */
  min?: number;
  max?: number;
  /** Only products with at least one unit available. */
  inStock?: true;
  /** Only products with at least this many units available. */
  minQty?: number;
  sort: SortKey;
};

type Facet<V> = {
  runsIn: "cms" | "api";
  parse: (raw: string) => V | undefined;
  serialize: (value: V) => string;
};

type FacetRegistry = {
  [K in keyof ProductFilters]-?: Facet<NonNullable<ProductFilters[K]>>;
};

function parseText(raw: string): string | undefined {
  const cleaned = raw
    .replace(/\p{Cc}/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_SEARCH_LENGTH)
    .trim();
  return cleaned === "" ? undefined : cleaned;
}

function parseOneOf<T extends string>(options: readonly T[]) {
  return (raw: string): T | undefined =>
    options.find((option) => option === raw);
}

/** Shape only. Whether the category exists is decided by `parseProductFilters`, which has the CMS list. */
function parseCategorySlug(raw: string): string | undefined {
  return raw.length <= MAX_CATEGORY_SLUG_LENGTH &&
    CATEGORY_SLUG_PATTERN.test(raw)
    ? raw
    : undefined;
}

/** Plain decimal with at most 2 places: rejects "1e3", "-5", "0x10", "Infinity", "12.345". */
function parsePrice(raw: string): number | undefined {
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) {
    return undefined;
  }
  const value = Number(raw);
  return value <= MAX_PRICE ? value : undefined;
}

/** Whole number from 1 to MAX_MIN_QTY. 0 is "no filter", so it is dropped like any other non-value. */
function parseMinQty(raw: string): number | undefined {
  if (!/^\d+$/.test(raw)) {
    return undefined;
  }
  const value = Number(raw);
  return value >= 1 && value <= MAX_MIN_QTY ? value : undefined;
}

export const FACETS: FacetRegistry = {
  q: { runsIn: "cms", parse: parseText, serialize: (value) => value },
  category: {
    runsIn: "cms",
    parse: parseCategorySlug,
    serialize: (value) => value,
  },
  min: { runsIn: "cms", parse: parsePrice, serialize: String },
  max: { runsIn: "cms", parse: parsePrice, serialize: String },
  inStock: {
    runsIn: "api",
    parse: (raw) => (raw === "1" ? true : undefined),
    serialize: () => "1",
  },
  minQty: { runsIn: "api", parse: parseMinQty, serialize: String },
  sort: {
    runsIn: "cms",
    parse: parseOneOf(SORT_KEYS),
    serialize: (value) => value,
  },
};

const FACET_KEYS = Object.keys(FACETS) as (keyof ProductFilters)[];

type RawParams = Record<string, string | string[] | undefined>;

/** A repeated param (`?q=a&q=b`) arrives as an array; the first one wins, the rest are ignored. */
function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Turns the page's `searchParams` into validated filters; anything invalid is dropped, never forwarded.
 * `knownCategories` is the CMS's current category slugs. It is required (not optional) so a caller
 * cannot forget it and let any well-formed slug through.
 */
export function parseProductFilters(
  params: RawParams,
  knownCategories: readonly string[],
): ProductFilters {
  const parsed: Record<string, unknown> = {};

  for (const key of FACET_KEYS) {
    const raw = firstValue(params[key]);
    if (raw === undefined) {
      continue;
    }
    const value = FACETS[key].parse(raw);
    if (value !== undefined) {
      parsed[key] = value;
    }
  }

  const filters = { sort: DEFAULT_SORT, ...parsed } as ProductFilters;

  if (
    filters.category !== undefined &&
    !knownCategories.includes(filters.category)
  ) {
    delete filters.category;
  }

  if (
    filters.min !== undefined &&
    filters.max !== undefined &&
    filters.min > filters.max
  ) {
    [filters.min, filters.max] = [filters.max, filters.min];
  }

  return filters;
}

/** The URL for a filter set. Defaults are left out so the unfiltered catalog keeps a clean URL. */
export function serializeProductFilters(
  filters: ProductFilters,
): URLSearchParams {
  const params = new URLSearchParams();

  for (const key of FACET_KEYS) {
    const value = filters[key];
    if (value === undefined || (key === "sort" && value === DEFAULT_SORT)) {
      continue;
    }
    params.set(key, FACETS[key].serialize(value as never));
  }

  return params;
}

/** True when a filter needs apps/api's live stock, so the result must not be cached. */
export function hasLiveFacet(filters: ProductFilters): boolean {
  return FACET_KEYS.some(
    (key) => FACETS[key].runsIn === "api" && filters[key] !== undefined,
  );
}
