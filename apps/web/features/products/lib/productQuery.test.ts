import { describe, expect, it } from "vitest";

import {
  SORT_KEYS,
  type ProductFilters,
} from "./productFilters";
import {
  buildProductSearchParams,
  isCacheableQuery,
  productQueryCacheKey,
} from "./productQuery";

const base: ProductFilters = { sort: "title" };

describe("buildProductSearchParams", () => {
  it("sends only the base query when no filter is set", () => {
    expect(buildProductSearchParams(base, "en")).toEqual({
      locale: "en",
      depth: 1,
      limit: 100,
      sort: "title",
    });
  });

  it("passes the locale through", () => {
    expect(buildProductSearchParams(base, "de").locale).toBe("de");
  });

  describe("sort", () => {
    it.each([
      ["title", "title"],
      ["title-desc", "-title"],
      ["price-asc", "price,title"],
      ["price-desc", "-price,title"],
    ] as const)("maps %s to %s", (key, expected) => {
      expect(buildProductSearchParams({ sort: key }, "en").sort).toBe(expected);
    });

    it("breaks price ties by title in both directions, always ascending", () => {
      for (const key of ["price-asc", "price-desc"] as const) {
        const sort = buildProductSearchParams({ sort: key }, "en")
          .sort as string;
        expect(sort.split(",").at(-1)).toBe("title");
      }
    });

    it("maps every sort key to a non-empty value", () => {
      for (const key of SORT_KEYS) {
        expect(buildProductSearchParams({ sort: key }, "en").sort).toBeTruthy();
      }
    });
  });

  it("filters by category through the relationship's slug", () => {
    const params = buildProductSearchParams(
      { ...base, category: "lighting" },
      "en",
    );
    expect(params["where[category.slug][equals]"]).toBe("lighting");
  });

  it("builds an inclusive price range", () => {
    const params = buildProductSearchParams({ ...base, min: 100, max: 500 }, "en");
    expect(params["where[price][greater_than_equal]"]).toBe(100);
    expect(params["where[price][less_than_equal]"]).toBe(500);
  });

  it("keeps a bound of 0 (a falsy value is still a filter)", () => {
    const params = buildProductSearchParams({ ...base, min: 0, max: 0 }, "en");
    expect(params["where[price][greater_than_equal]"]).toBe(0);
    expect(params["where[price][less_than_equal]"]).toBe(0);
  });

  it("allows a one-sided range", () => {
    const params = buildProductSearchParams({ ...base, min: 100 }, "en");
    expect(params).not.toHaveProperty("where[price][less_than_equal]");
  });

  it("searches the localized title with like", () => {
    const params = buildProductSearchParams({ ...base, q: "floor lamp" }, "en");
    expect(params["where[title][like]"]).toBe("floor lamp");
  });

  it("adds no where clause for an unset filter", () => {
    const keys = Object.keys(buildProductSearchParams(base, "en"));
    expect(keys.filter((key) => key.startsWith("where"))).toEqual([]);
  });

  it("ignores live facets: stock is not in the CMS", () => {
    const params = buildProductSearchParams(
      { ...base, inStock: true, minQty: 3 },
      "en",
    );
    expect(Object.keys(params).sort()).toEqual(
      ["depth", "limit", "locale", "sort"],
    );
  });

  it("combines every catalog facet", () => {
    expect(
      buildProductSearchParams(
        {
          q: "lamp",
          category: "lighting",
          min: 10,
          max: 300,
          sort: "price-desc",
        },
        "de",
      ),
    ).toEqual({
      locale: "de",
      depth: 1,
      limit: 100,
      sort: "-price,title",
      "where[category.slug][equals]": "lighting",
      "where[price][greater_than_equal]": 10,
      "where[price][less_than_equal]": 300,
      "where[title][like]": "lamp",
    });
  });
});

describe("isCacheableQuery", () => {
  it("caches the unfiltered catalog", () => {
    expect(isCacheableQuery(base)).toBe(true);
  });

  it("caches category and sort, which have a finite set of values", () => {
    expect(
      isCacheableQuery({ sort: "price-desc", category: "lighting" }),
    ).toBe(true);
  });

  it("does not cache free-text search", () => {
    expect(isCacheableQuery({ ...base, q: "lamp" })).toBe(false);
  });

  it("does not cache price bounds, whose values are unbounded", () => {
    expect(isCacheableQuery({ ...base, min: 0 })).toBe(false);
    expect(isCacheableQuery({ ...base, max: 500 })).toBe(false);
  });

  it("is not affected by live facets", () => {
    expect(isCacheableQuery({ ...base, inStock: true, minQty: 2 })).toBe(true);
  });
});

describe("productQueryCacheKey", () => {
  it("differs by locale, category and sort", () => {
    const keys = [
      productQueryCacheKey("en", base),
      productQueryCacheKey("de", base),
      productQueryCacheKey("en", { ...base, category: "lighting" }),
      productQueryCacheKey("en", { ...base, category: "seating" }),
      productQueryCacheKey("en", { sort: "price-asc" }),
      productQueryCacheKey("en", { sort: "price-desc" }),
    ].map((key) => JSON.stringify(key));

    expect(new Set(keys).size).toBe(keys.length);
  });

  it("is the same for the same filters", () => {
    expect(productQueryCacheKey("en", { ...base, category: "beds" })).toEqual(
      productQueryCacheKey("en", { category: "beds", sort: "title" }),
    );
  });

  it("ignores live facets, so they share one entry", () => {
    expect(productQueryCacheKey("en", { ...base, inStock: true })).toEqual(
      productQueryCacheKey("en", base),
    );
  });

  it("keeps an absent category apart from every real one", () => {
    expect(productQueryCacheKey("en", base)).not.toEqual(
      productQueryCacheKey("en", { ...base, category: "title" }),
    );
  });
});
