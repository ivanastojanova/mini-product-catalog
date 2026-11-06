import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Product } from "@/features/products/types/product";
import { DEFAULT_SORT } from "@/features/products/lib/productFilters";

const cmsFetch = vi.fn();
const getStockBatch = vi.fn();

vi.mock("@/shared/cms/client", () => ({ cmsFetch }));
vi.mock("@/features/products/api/stock", () => ({ getStockBatch }));
vi.mock("next/cache", () => ({
  unstable_cache: (fn: () => unknown) => fn,
}));

const { getFilteredProducts } = await import("./products");

function cmsDoc(slug: string) {
  return { id: slug, slug, price: 10, title: slug, currency: "EUR" };
}

function slugs(products: Product[]) {
  return products.map((p) => p.slug);
}

describe("getFilteredProducts", () => {
  beforeEach(() => {
    cmsFetch.mockReset();
    getStockBatch.mockReset();
    cmsFetch.mockResolvedValue({ docs: ["a", "b", "c"].map(cmsDoc) });
  });

  it("does not call apps/api when no live facet is set", async () => {
    const result = await getFilteredProducts("en", { sort: DEFAULT_SORT });

    expect(slugs(result)).toEqual(["a", "b", "c"]);
    expect(getStockBatch).not.toHaveBeenCalled();
  });

  it("does not call apps/api for catalog-only filters", async () => {
    await getFilteredProducts("en", { sort: "price-asc", q: "lamp", max: 50 });

    expect(getStockBatch).not.toHaveBeenCalled();
  });

  it("asks apps/api for exactly the products the CMS returned, then narrows them", async () => {
    getStockBatch.mockResolvedValue(
      new Map([
        ["a", 0],
        ["b", 4],
        ["c", 9],
      ]),
    );

    const result = await getFilteredProducts("en", {
      sort: DEFAULT_SORT,
      inStock: true,
      minQty: 5,
    });

    expect(getStockBatch).toHaveBeenCalledWith(["a", "b", "c"]);
    expect(slugs(result)).toEqual(["c"]);
  });

  it("skips the stock call when the CMS found nothing", async () => {
    cmsFetch.mockResolvedValue({ docs: [] });

    const result = await getFilteredProducts("en", {
      sort: DEFAULT_SORT,
      inStock: true,
    });

    expect(result).toEqual([]);
    expect(getStockBatch).not.toHaveBeenCalled();
  });

  it("throws when apps/api fails, never returning the unfiltered list", async () => {
    getStockBatch.mockRejectedValue(new Error("Failed to load stock"));

    await expect(
      getFilteredProducts("en", { sort: DEFAULT_SORT, inStock: true }),
    ).rejects.toThrow("Failed to load stock");
  });
});
