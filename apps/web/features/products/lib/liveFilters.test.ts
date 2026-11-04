import { describe, expect, it } from "vitest";

import type { Product } from "@/features/products/types/product";
import { applyLiveFilters } from "./liveFilters";
import { DEFAULT_SORT, type ProductFilters } from "./productFilters";

function product(slug: string): Product {
  return { id: slug, slug, price: 10, currency: "EUR", title: slug };
}

const products = ["a", "b", "c", "d"].map(product);
const available = new Map([
  ["a", 0],
  ["b", 1],
  ["c", 5],
  ["d", 12],
]);

function filters(extra: Partial<ProductFilters>): ProductFilters {
  return { sort: DEFAULT_SORT, ...extra };
}

function slugs(result: Product[]) {
  return result.map((p) => p.slug);
}

describe("applyLiveFilters", () => {
  it("returns every product when no live facet is set", () => {
    expect(slugs(applyLiveFilters(products, available, filters({})))).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
  });

  it("inStock keeps products with at least one unit and drops zero", () => {
    expect(
      slugs(applyLiveFilters(products, available, filters({ inStock: true }))),
    ).toEqual(["b", "c", "d"]);
  });

  it("minQty keeps products at or above the threshold (inclusive)", () => {
    expect(
      slugs(applyLiveFilters(products, available, filters({ minQty: 5 }))),
    ).toEqual(["c", "d"]);
    expect(
      slugs(applyLiveFilters(products, available, filters({ minQty: 6 }))),
    ).toEqual(["d"]);
  });

  it("applies both facets together (the stricter one wins)", () => {
    expect(
      slugs(
        applyLiveFilters(
          products,
          available,
          filters({ inStock: true, minQty: 12 }),
        ),
      ),
    ).toEqual(["d"]);
  });

  it("treats a product missing from the stock response as 0, so it never passes", () => {
    const partial = new Map([["c", 5]]);

    expect(
      slugs(applyLiveFilters(products, partial, filters({ inStock: true }))),
    ).toEqual(["c"]);
    expect(
      slugs(applyLiveFilters(products, partial, filters({ minQty: 1 }))),
    ).toEqual(["c"]);
  });

  it("keeps the CMS order", () => {
    const reversed = [...products].reverse();

    expect(
      slugs(applyLiveFilters(reversed, available, filters({ inStock: true }))),
    ).toEqual(["d", "c", "b"]);
  });

  it("does not mutate its input", () => {
    const input = [...products];

    applyLiveFilters(input, available, filters({ inStock: true }));

    expect(input).toHaveLength(4);
  });
});
