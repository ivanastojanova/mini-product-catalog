import { describe, expect, it } from "vitest";
import type { CmsProduct } from "../../cart/lib/cmsClient.js";
import { priceCart } from "./priceCart.js";

const product = (slug: string, price: number, currency = "EUR"): [string, CmsProduct] => [
  slug,
  { slug, title: `Title ${slug}`, price, currency },
];

const products = (...entries: Array<[string, CmsProduct]>) => new Map(entries);
const stock = (obj: Record<string, number>) => new Map(Object.entries(obj));

describe("priceCart", () => {
  it("prices lines in integer cents and sums them", () => {
    const result = priceCart(
      [
        { slug: "a", quantity: 2 },
        { slug: "b", quantity: 1 },
      ],
      products(product("a", 19.99), product("b", 790)),
      stock({ a: 10, b: 10 }),
    );

    expect(result).toEqual({
      ok: true,
      currency: "EUR",
      subtotalCents: 2 * 1999 + 79000,
      items: [
        { slug: "a", title: "Title a", unitPriceCents: 1999, quantity: 2, lineTotalCents: 3998, available: 10 },
        { slug: "b", title: "Title b", unitPriceCents: 79000, quantity: 1, lineTotalCents: 79000, available: 10 },
      ],
    });
  });

  it("has no float drift on awkward prices (0.1 + 0.2 style)", () => {
    const result = priceCart(
      [{ slug: "a", quantity: 3 }, { slug: "b", quantity: 1 }],
      products(product("a", 0.1), product("b", 0.2)),
      stock({ a: 5, b: 5 }),
    );
    expect(result).toMatchObject({ ok: true, subtotalCents: 3 * 10 + 20 });
  });

  it("keeps the cart's line order", () => {
    const result = priceCart(
      [{ slug: "z", quantity: 1 }, { slug: "a", quantity: 1 }],
      products(product("a", 1), product("z", 1)),
      stock({ a: 1, z: 1 }),
    );
    expect(result.ok && result.items.map((i) => i.slug)).toEqual(["z", "a"]);
  });

  describe("unknown products", () => {
    it("flags the line, prices it at 0 and leaves it out of the subtotal", () => {
      const result = priceCart(
        [{ slug: "a", quantity: 1 }, { slug: "ghost", quantity: 4 }],
        products(product("a", 10)),
        stock({ a: 5 }),
      );

      expect(result).toMatchObject({ ok: true, subtotalCents: 1000 });
      expect(result.ok && result.items[1]).toMatchObject({
        slug: "ghost",
        unitPriceCents: 0,
        lineTotalCents: 0,
        quantity: 4,
        problem: "unknown_product",
      });
    });

    it("a cart of only unknown products has no currency and a zero subtotal", () => {
      const result = priceCart([{ slug: "ghost", quantity: 1 }], products(), stock({}));
      expect(result).toMatchObject({ ok: true, currency: null, subtotalCents: 0 });
    });
  });

  describe("stock", () => {
    it("flags a line asking for more than is available, but still prices it", () => {
      const result = priceCart([{ slug: "a", quantity: 3 }], products(product("a", 10)), stock({ a: 2 }));

      expect(result.ok && result.items[0]).toMatchObject({
        available: 2,
        lineTotalCents: 3000,
        problem: "insufficient_stock",
      });
    });

    it("accepts a line that asks for exactly what is available", () => {
      const result = priceCart([{ slug: "a", quantity: 2 }], products(product("a", 10)), stock({ a: 2 }));
      expect(result.ok && result.items[0].problem).toBeUndefined();
    });

    it("treats a product with no inventory entry as 0 available", () => {
      const result = priceCart([{ slug: "a", quantity: 1 }], products(product("a", 10)), stock({}));
      expect(result.ok && result.items[0]).toMatchObject({ available: 0, problem: "insufficient_stock" });
    });
  });

  describe("currency", () => {
    it("rejects a cart that mixes currencies instead of adding euros to dollars", () => {
      const result = priceCart(
        [{ slug: "a", quantity: 1 }, { slug: "b", quantity: 1 }],
        products(product("a", 10, "EUR"), product("b", 10, "USD")),
        stock({ a: 1, b: 1 }),
      );
      expect(result).toEqual({ ok: false, reason: "mixed_currency", currencies: ["EUR", "USD"] });
    });

    it("an unknown product doesn't count towards the currencies", () => {
      const result = priceCart(
        [{ slug: "a", quantity: 1 }, { slug: "ghost", quantity: 1 }],
        products(product("a", 10, "USD")),
        stock({ a: 1 }),
      );
      expect(result).toMatchObject({ ok: true, currency: "USD" });
    });
  });

  it("an empty cart prices to nothing", () => {
    expect(priceCart([], products(), stock({}))).toEqual({
      ok: true,
      currency: null,
      items: [],
      subtotalCents: 0,
    });
  });
});
