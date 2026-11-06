import { describe, expect, it } from "vitest";

import {
  EMPTY_DRAFT,
  draftToFilters,
  filtersToDraft,
} from "@/features/products/lib/filterDraft";
import {
  parseProductFilters,
  serializeProductFilters,
} from "@/features/products/lib/productFilters";

const CATEGORIES = ["lighting", "seating"];

describe("draftToFilters", () => {
  it("is the default filters for an empty draft", () => {
    expect(draftToFilters(EMPTY_DRAFT, CATEGORIES)).toEqual({ sort: "title" });
  });

  it("drops unfinished or invalid input instead of forwarding it", () => {
    const filters = draftToFilters(
      { ...EMPTY_DRAFT, min: "12.", max: "abc", minQty: "0", q: "   " },
      CATEGORIES,
    );
    expect(filters).toEqual({ sort: "title" });
  });

  it("drops a category the CMS does not have", () => {
    const filters = draftToFilters(
      { ...EMPTY_DRAFT, category: "garden" },
      CATEGORIES,
    );
    expect(filters.category).toBeUndefined();
  });

  it("keeps every valid value", () => {
    const filters = draftToFilters(
      {
        q: "lamp",
        category: "lighting",
        min: "10",
        max: "99.5",
        inStock: true,
        minQty: "3",
        sort: "price-desc",
      },
      CATEGORIES,
    );
    expect(filters).toEqual({
      q: "lamp",
      category: "lighting",
      min: 10,
      max: 99.5,
      inStock: true,
      minQty: 3,
      sort: "price-desc",
    });
  });

  it("an unchecked box means no stock filter", () => {
    expect(
      draftToFilters({ ...EMPTY_DRAFT, inStock: false }, CATEGORIES).inStock,
    ).toBeUndefined();
  });
});

describe("filtersToDraft", () => {
  it("is the empty draft for the default filters", () => {
    expect(filtersToDraft({ sort: "title" })).toEqual(EMPTY_DRAFT);
  });

  it("round-trips: a draft built from URL filters produces the same URL", () => {
    const filters = parseProductFilters(
      {
        q: "chair",
        category: "seating",
        min: "100",
        max: "800.5",
        inStock: "1",
        minQty: "2",
        sort: "price-asc",
      },
      CATEGORIES,
    );
    const back = draftToFilters(filtersToDraft(filters), CATEGORIES);
    expect(serializeProductFilters(back).toString()).toBe(
      serializeProductFilters(filters).toString(),
    );
  });
});
