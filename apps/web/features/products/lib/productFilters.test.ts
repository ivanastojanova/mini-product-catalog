import { describe, expect, it } from "vitest";

import {
  DEFAULT_SORT,
  FACETS,
  MAX_MIN_QTY,
  MAX_PRICE,
  MAX_SEARCH_LENGTH,
  CATEGORY_SLUG_PATTERN,
  MAX_CATEGORY_SLUG_LENGTH,
  SORT_KEYS,
  hasLiveFacet,
  parseProductFilters,
  serializeProductFilters,
} from "./productFilters";

const KNOWN = ["lighting", "seating", "tables", "storage", "beds"];

const parse = (params: Parameters<typeof parseProductFilters>[0]) =>
  parseProductFilters(params, KNOWN);

describe("parseProductFilters: defaults", () => {
  it("returns only the default sort when nothing is set", () => {
    expect(parse({})).toEqual({ sort: "title" });
    expect(DEFAULT_SORT).toBe("title");
  });

  it("ignores params it does not know", () => {
    expect(parse({ foo: "bar", "where[price]": "1" })).toEqual({
      sort: "title",
    });
  });

  it("takes the first value of a repeated param", () => {
    expect(parse({ q: ["lamp", "chair"] })).toEqual({
      sort: "title",
      q: "lamp",
    });
  });
});

describe("parseProductFilters: q", () => {
  it("trims and collapses whitespace", () => {
    expect(parse({ q: "  floor   lamp \n" }).q).toBe("floor lamp");
  });

  it("replaces control characters instead of passing them on", () => {
    expect(parse({ q: "a\u0000b\tc" }).q).toBe("a b c");
  });

  it("drops an empty or whitespace-only search", () => {
    expect(parse({ q: "" }).q).toBeUndefined();
    expect(parse({ q: "   " }).q).toBeUndefined();
  });

  it("clamps an over-long search rather than rejecting it", () => {
    const q = parse({ q: "a".repeat(500) }).q;
    expect(q).toHaveLength(MAX_SEARCH_LENGTH);
  });

  it("keeps non-ASCII letters", () => {
    expect(parse({ q: "Malmö" }).q).toBe("Malmö");
  });
});

describe("parseProductFilters: category (checked against the CMS list)", () => {
  it.each(KNOWN)("accepts the known category %s", (category) => {
    expect(parse({ category }).category).toBe(category);
  });

  it("drops a well-formed slug the CMS does not have", () => {
    expect(parse({ category: "sofas" }).category).toBeUndefined();
  });

  it("drops near misses and case variants of a known slug", () => {
    for (const category of ["Lighting", "lighting ", " lighting", "lighting-", "", "__proto__", "constructor"]) {
      expect(parse({ category }).category, JSON.stringify(category)).toBeUndefined();
    }
  });

  it("accepts nothing when the CMS has no categories (or could not be read)", () => {
    expect(parseProductFilters({ category: "lighting" }, []).category).toBeUndefined();
  });

  it("uses the list it is given, so a category added in the CMS works without a code change", () => {
    expect(parseProductFilters({ category: "outdoor" }, [...KNOWN, "outdoor"]).category).toBe("outdoor");
  });

  it("rejects a slug longer than the CMS allows even if the list contained it", () => {
    const long = "a".repeat(MAX_CATEGORY_SLUG_LENGTH + 1);
    expect(parseProductFilters({ category: long }, [long]).category).toBeUndefined();
  });

  it("only passes slugs that match the CMS slug shape", () => {
    for (const bad of ["a b", "a_b", "a--b", "-a", "a-", "Ä", "a/b", "a&b=c"]) {
      expect(CATEGORY_SLUG_PATTERN.test(bad), bad).toBe(false);
      expect(parseProductFilters({ category: bad }, [bad]).category, bad).toBeUndefined();
    }
  });
});

describe("parseProductFilters: sort (whitelist)", () => {
  it.each(SORT_KEYS)("accepts the sort %s", (sort) => {
    expect(parse({ sort }).sort).toBe(sort);
  });

  it("falls back to the default sort for anything else, never to a raw CMS sort", () => {
    for (const sort of ["-price", "price", "createdAt", "title,price", ""]) {
      expect(parse({ sort }).sort).toBe(DEFAULT_SORT);
    }
  });
});

describe("parseProductFilters: price bounds", () => {
  it("parses whole and 2-decimal prices", () => {
    expect(parse({ min: "0", max: "99.5" })).toMatchObject({
      min: 0,
      max: 99.5,
    });
    expect(parse({ min: "12.34" }).min).toBe(12.34);
  });

  it("drops anything that is not a plain non-negative decimal", () => {
    for (const bad of ["-5", "1e3", "0x10", "Infinity", "NaN", "12.345", "1,5", "abc", "", " 5", "5 "]) {
      const parsed = parse({ min: bad, max: bad });
      expect(parsed.min, `min=${JSON.stringify(bad)}`).toBeUndefined();
      expect(parsed.max, `max=${JSON.stringify(bad)}`).toBeUndefined();
    }
  });

  it("accepts the maximum and drops anything above it", () => {
    expect(parse({ max: String(MAX_PRICE) }).max).toBe(MAX_PRICE);
    expect(parse({ max: String(MAX_PRICE + 1) }).max).toBeUndefined();
  });

  it("swaps bounds given the wrong way round", () => {
    expect(parse({ min: "500", max: "100" })).toMatchObject({
      min: 100,
      max: 500,
    });
  });

  it("leaves equal bounds alone", () => {
    expect(parse({ min: "100", max: "100" })).toMatchObject({
      min: 100,
      max: 100,
    });
  });

  it("does not invent the other bound when only one is given", () => {
    const parsed = parse({ min: "100" });
    expect(parsed.min).toBe(100);
    expect("max" in parsed).toBe(false);
  });
});

describe("parseProductFilters: live stock filters", () => {
  it("accepts inStock only as 1", () => {
    expect(parse({ inStock: "1" }).inStock).toBe(true);
    for (const bad of ["0", "true", "yes", "", "2"]) {
      expect(parse({ inStock: bad }).inStock).toBeUndefined();
    }
  });

  it("accepts minQty from 1 to the cap", () => {
    expect(parse({ minQty: "1" }).minQty).toBe(1);
    expect(parse({ minQty: String(MAX_MIN_QTY) }).minQty).toBe(MAX_MIN_QTY);
  });

  it("drops minQty of 0, above the cap, fractional, negative or not a number", () => {
    for (const bad of ["0", String(MAX_MIN_QTY + 1), "2.5", "-1", "1e2", "abc", ""]) {
      expect(parse({ minQty: bad }).minQty).toBeUndefined();
    }
  });

  it("keeps inStock and minQty independent", () => {
    expect(parse({ minQty: "3" })).toEqual({ sort: "title", minQty: 3 });
    expect(parse({ inStock: "1" })).toEqual({ sort: "title", inStock: true });
  });
});

describe("serializeProductFilters", () => {
  it("is empty for the unfiltered catalog", () => {
    expect(serializeProductFilters({ sort: "title" }).toString()).toBe("");
  });

  it("omits the default sort but keeps any other", () => {
    expect(serializeProductFilters({ sort: "price-desc" }).toString()).toBe("sort=price-desc");
  });

  it("writes every set filter", () => {
    const params = serializeProductFilters({
      q: "floor lamp",
      category: "lighting",
      min: 10,
      max: 99.5,
      inStock: true,
      minQty: 3,
      sort: "price-asc",
    });
    expect(Object.fromEntries(params)).toEqual({
      q: "floor lamp",
      category: "lighting",
      min: "10",
      max: "99.5",
      inStock: "1",
      minQty: "3",
      sort: "price-asc",
    });
  });

  it("round-trips: parsing what was serialized gives the same filters", () => {
    const filters = parse({
      q: "  Malmö  chair ",
      category: "seating",
      min: "100",
      max: "800.5",
      inStock: "1",
      minQty: "2",
      sort: "price-desc",
    });
    const roundTripped = parse(
      Object.fromEntries(serializeProductFilters(filters)),
    );
    expect(roundTripped).toEqual(filters);
  });
});

describe("hasLiveFacet", () => {
  it("is false for catalog-only filters", () => {
    expect(
      hasLiveFacet({ q: "lamp", category: "lighting", min: 1, max: 5, sort: "title" }),
    ).toBe(false);
  });

  it("is true for inStock or minQty, alone or together", () => {
    expect(hasLiveFacet({ sort: "title", inStock: true })).toBe(true);
    expect(hasLiveFacet({ sort: "title", minQty: 2 })).toBe(true);
    expect(hasLiveFacet({ sort: "title", inStock: true, minQty: 2 })).toBe(true);
  });
});

describe("registry", () => {
  it("runs stock filters in apps/api and everything else in the CMS", () => {
    expect(
      Object.entries(FACETS)
        .filter(([, facet]) => facet.runsIn === "api")
        .map(([key]) => key)
        .sort(),
    ).toEqual(["inStock", "minQty"]);
  });
});
