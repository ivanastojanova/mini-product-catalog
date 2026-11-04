import { describe, expect, it } from "vitest";

import { mapCategory, mapProduct } from "./mappers";

describe("mapCategory", () => {
  it("keeps slug and localized name from a populated category", () => {
    expect(
      mapCategory({ id: 1, slug: "lighting", name: "Beleuchtung" }),
    ).toEqual({ slug: "lighting", name: "Beleuchtung" });
  });

  it("leaves the category off when it was not populated (an id)", () => {
    expect(mapCategory(3)).toBeUndefined();
    expect(mapCategory("3")).toBeUndefined();
  });

  it("leaves it off when the product has none", () => {
    expect(mapCategory(null)).toBeUndefined();
    expect(mapCategory(undefined)).toBeUndefined();
  });

  it("leaves it off when slug or name is missing, rather than showing a half-filled one", () => {
    expect(mapCategory({ id: 1, slug: "", name: "Lighting" })).toBeUndefined();
    expect(mapCategory({ id: 1, slug: "lighting", name: "" })).toBeUndefined();
  });
});

describe("mapProduct category", () => {
  const base = { id: 1, slug: "lamp", price: 10, currency: "EUR", title: "Lamp" };

  it("carries the category onto the product", () => {
    const product = mapProduct({
      ...base,
      category: { id: 2, slug: "lighting", name: "Lighting" },
    });
    expect(product.category).toEqual({ slug: "lighting", name: "Lighting" });
  });

  it("has no category for an uncategorised product", () => {
    expect(mapProduct({ ...base, category: null }).category).toBeUndefined();
  });
});
