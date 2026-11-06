import { describe, expect, it } from "vitest";

import {
  MAX_LINE_QUANTITY,
  addOptimistically,
  quantityInCart,
  totalQuantity,
  withConfirmedQuantity,
} from "./cartMath";

describe("addOptimistically", () => {
  it("creates the cart when none is loaded yet", () => {
    expect(addOptimistically(undefined, "lamp")).toEqual({
      items: [{ slug: "lamp", quantity: 1 }],
    });
  });

  it("appends a new line and leaves existing lines alone", () => {
    const cart = { items: [{ slug: "desk", quantity: 2 }] };

    expect(addOptimistically(cart, "lamp")).toEqual({
      items: [
        { slug: "desk", quantity: 2 },
        { slug: "lamp", quantity: 1 },
      ],
    });
  });

  it("increments only the matching line", () => {
    const cart = {
      items: [
        { slug: "lamp", quantity: 2 },
        { slug: "desk", quantity: 5 },
      ],
    };

    expect(addOptimistically(cart, "lamp").items).toEqual([
      { slug: "lamp", quantity: 3 },
      { slug: "desk", quantity: 5 },
    ]);
  });

  it("clamps at the per-line maximum like the server does", () => {
    const cart = { items: [{ slug: "lamp", quantity: MAX_LINE_QUANTITY }] };

    expect(addOptimistically(cart, "lamp").items).toEqual([
      { slug: "lamp", quantity: MAX_LINE_QUANTITY },
    ]);
  });

  it("does not mutate the cart it was given", () => {
    const cart = { items: [{ slug: "lamp", quantity: 1 }] };

    addOptimistically(cart, "lamp");

    expect(cart).toEqual({ items: [{ slug: "lamp", quantity: 1 }] });
  });
});

describe("withConfirmedQuantity", () => {
  it("overwrites the line with the server's quantity", () => {
    const cart = { items: [{ slug: "lamp", quantity: 3 }] };

    expect(withConfirmedQuantity(cart, "lamp", 10).items).toEqual([
      { slug: "lamp", quantity: 10 },
    ]);
  });

  it("adds the line if the cache doesn't have it, and keeps other lines", () => {
    const cart = { items: [{ slug: "desk", quantity: 1 }] };

    expect(withConfirmedQuantity(cart, "lamp", 2).items).toEqual([
      { slug: "desk", quantity: 1 },
      { slug: "lamp", quantity: 2 },
    ]);
  });
});

describe("quantityInCart", () => {
  it("is 0 for an unloaded cart or a missing line", () => {
    expect(quantityInCart(undefined, "lamp")).toBe(0);
    expect(quantityInCart({ items: [] }, "lamp")).toBe(0);
  });

  it("reads the line's quantity", () => {
    expect(quantityInCart({ items: [{ slug: "lamp", quantity: 4 }] }, "lamp")).toBe(4);
  });
});

describe("totalQuantity", () => {
  it("is 0 for an unloaded or empty cart", () => {
    expect(totalQuantity(undefined)).toBe(0);
    expect(totalQuantity({ items: [] })).toBe(0);
  });

  it("sums the units across every line", () => {
    expect(
      totalQuantity({
        items: [
          { slug: "lamp", quantity: 2 },
          { slug: "desk", quantity: 3 },
        ],
      }),
    ).toBe(5);
  });
});
