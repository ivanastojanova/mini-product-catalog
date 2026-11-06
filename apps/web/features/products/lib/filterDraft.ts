import {
  DEFAULT_SORT,
  parseProductFilters,
  type ProductFilters,
  type SortKey,
} from "@/features/products/lib/productFilters";

/**
 * What the filter bar's inputs hold while the shopper is typing: raw strings,
 * which may be half-finished ("12.", "") and so are not valid filters yet.
 */
export type FilterDraft = {
  q: string;
  /** "" means all categories. */
  category: string;
  min: string;
  max: string;
  inStock: boolean;
  minQty: string;
  sort: SortKey;
};

export const EMPTY_DRAFT: FilterDraft = {
  q: "",
  category: "",
  min: "",
  max: "",
  inStock: false,
  minQty: "",
  sort: DEFAULT_SORT,
};

/** The input values for filters the server has already parsed. */
export function filtersToDraft(filters: ProductFilters): FilterDraft {
  return {
    q: filters.q ?? "",
    category: filters.category ?? "",
    min: filters.min === undefined ? "" : String(filters.min),
    max: filters.max === undefined ? "" : String(filters.max),
    inStock: filters.inStock === true,
    minQty: filters.minQty === undefined ? "" : String(filters.minQty),
    sort: filters.sort,
  };
}

/**
 * Runs the draft through the same parser the page uses for `searchParams`, so
 * the browser and the server cannot disagree about what is valid. Anything the
 * parser rejects (an unfinished number, an unknown category) is simply left out.
 */
export function draftToFilters(
  draft: FilterDraft,
  knownCategories: readonly string[],
): ProductFilters {
  return parseProductFilters(
    {
      q: draft.q,
      category: draft.category,
      min: draft.min,
      max: draft.max,
      inStock: draft.inStock ? "1" : undefined,
      minQty: draft.minQty,
      sort: draft.sort,
    },
    knownCategories,
  );
}
