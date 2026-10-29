import { beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import * as schema from "../../db/schema.js";
import { createOrder, type CreateOrderInput } from "./createOrder.js";
import { applyTransition } from "./applyTransition.js";
import type { PricedLine } from "./priceCart.js";

const sqlite = new Database(":memory:");
sqlite.pragma("foreign_keys = ON");
const db = drizzle(sqlite, { schema });
migrate(db, { migrationsFolder: "./src/db/migrations" });

const TTL = 15 * 60_000;

const line = (slug: string, quantity: number, unitPriceCents = 1000): PricedLine => ({
  slug,
  title: `Title ${slug}`,
  unitPriceCents,
  quantity,
  lineTotalCents: unitPriceCents * quantity,
  available: 99,
});

let counter = 0;

function makeGuestCart(lines: Array<[string, number]>) {
  counter += 1;
  const [cart] = db
    .insert(schema.carts)
    .values({ guestTokenHash: `cart-guest-${counter}` })
    .returning()
    .all();
  for (const [productSlug, quantity] of lines) {
    db.insert(schema.cartItems).values({ cartId: cart.id, productSlug, quantity }).run();
  }
  return cart.id;
}

function makeCustomer() {
  counter += 1;
  return db
    .insert(schema.customers)
    .values({ email: `c${counter}@example.com`, passwordHash: "x", name: "C" })
    .returning()
    .get().id;
}

function baseInput(overrides: Partial<CreateOrderInput> & Pick<CreateOrderInput, "cartId" | "lines">): CreateOrderInput {
  counter += 1;
  return {
    owner: { kind: "guest", tokenHash: "browser-1" },
    idempotencyKey: `key-${counter}`,
    contactEmail: "shopper@example.com",
    shippingAddress: { name: "Ada", line1: "1 Main St", line2: null, city: "Berlin", postalCode: "10115", country: "DE" },
    currency: "EUR",
    reservationTtlMs: TTL,
    ...overrides,
  };
}

function stock(slug: string) {
  const row = db.select().from(schema.inventory).where(eq(schema.inventory.productSlug, slug)).get();
  return row ? { onHand: row.onHand, reserved: row.reserved } : undefined;
}

function cartLines(cartId: number) {
  return db
    .select({ slug: schema.cartItems.productSlug, quantity: schema.cartItems.quantity })
    .from(schema.cartItems)
    .where(eq(schema.cartItems.cartId, cartId))
    .orderBy(schema.cartItems.productSlug)
    .all();
}

const orderCount = () => db.select().from(schema.orders).all().length;

beforeEach(() => {
  sqlite.exec(
    "DELETE FROM order_events; DELETE FROM order_items; DELETE FROM orders; DELETE FROM inventory; DELETE FROM cart_items; DELETE FROM carts; DELETE FROM sessions; DELETE FROM customers;",
  );
  db.insert(schema.inventory)
    .values([
      { productSlug: "a", onHand: 10 },
      { productSlug: "b", onHand: 10 },
    ])
    .run();
});

describe("createOrder", () => {
  describe("happy path", () => {
    it("creates a pending order, holds the stock, snapshots prices and total, and clears the cart lines", () => {
      const cartId = makeGuestCart([["a", 2], ["b", 1]]);
      const now = new Date("2030-01-01T12:00:00Z");

      const result = createOrder(
        db,
        baseInput({ cartId, lines: [line("a", 2, 1999), line("b", 1, 500)], now }),
      );

      expect(result).toMatchObject({ ok: true, replay: false });
      const order = db.select().from(schema.orders).get()!;
      expect(order).toMatchObject({
        status: "pending_payment",
        currency: "EUR",
        totalCents: 2 * 1999 + 500,
        contactEmail: "shopper@example.com",
        guestTokenHash: "browser-1",
        customerId: null,
        shipName: "Ada",
        shipCountry: "DE",
      });
      expect(order.reservationExpiresAt.getTime()).toBe(now.getTime() + TTL);
      expect(order.publicId).toMatch(/^[A-Za-z0-9_-]{22}$/);

      const items = db.select().from(schema.orderItems).orderBy(schema.orderItems.productSlug).all();
      expect(items.map((i) => [i.productSlug, i.title, i.unitPriceCents, i.quantity])).toEqual([
        ["a", "Title a", 1999, 2],
        ["b", "Title b", 500, 1],
      ]);

      expect(stock("a")).toEqual({ onHand: 10, reserved: 2 });
      expect(stock("b")).toEqual({ onHand: 10, reserved: 1 });
      expect(cartLines(cartId)).toEqual([]);
    });

    it("keeps the cart row (a guest's cart cookie stays valid)", () => {
      const cartId = makeGuestCart([["a", 1]]);
      createOrder(db, baseInput({ cartId, lines: [line("a", 1)] }));
      expect(db.select().from(schema.carts).where(eq(schema.carts.id, cartId)).get()).toBeDefined();
    });

    it("writes the creation event", () => {
      const cartId = makeGuestCart([["a", 1]]);
      createOrder(db, baseInput({ cartId, lines: [line("a", 1)] }));
      const events = db.select().from(schema.orderEvents).all();
      expect(events.map((e) => [e.fromStatus, e.toStatus, e.reason])).toEqual([
        [null, "pending_payment", "order created"],
      ]);
    });

    it("a customer's order has customer_id and no guest hash", () => {
      const customerId = makeCustomer();
      const [cart] = db.insert(schema.carts).values({ customerId }).returning().all();
      db.insert(schema.cartItems).values({ cartId: cart.id, productSlug: "a", quantity: 1 }).run();

      createOrder(
        db,
        baseInput({ owner: { kind: "customer", customerId }, cartId: cart.id, lines: [line("a", 1)] }),
      );

      expect(db.select().from(schema.orders).get()).toMatchObject({ customerId, guestTokenHash: null });
    });

    it("gives every order a different public id", () => {
      const first = makeGuestCart([["a", 1]]);
      createOrder(db, baseInput({ cartId: first, lines: [line("a", 1)] }));
      db.update(schema.orders).set({ status: "cancelled" }).run();
      const second = makeGuestCart([["a", 1]]);
      createOrder(db, baseInput({ cartId: second, lines: [line("a", 1)] }));

      const ids = db.select({ id: schema.orders.publicId }).from(schema.orders).all().map((o) => o.id);
      expect(new Set(ids).size).toBe(2);
    });
  });

  describe("stock", () => {
    it("refuses when a line is short: nothing is held, no order exists, the cart is untouched", () => {
      const cartId = makeGuestCart([["a", 3], ["b", 2]]);
      db.update(schema.inventory).set({ onHand: 1 }).where(eq(schema.inventory.productSlug, "b")).run();

      const result = createOrder(db, baseInput({ cartId, lines: [line("a", 3), line("b", 2)] }));

      expect(result).toEqual({
        ok: false,
        code: "insufficient_stock",
        items: [{ slug: "b", requested: 2, available: 1 }],
      });
      expect(stock("a")).toEqual({ onHand: 10, reserved: 0 });
      expect(stock("b")).toEqual({ onHand: 1, reserved: 0 });
      expect(orderCount()).toBe(0);
      expect(cartLines(cartId)).toEqual([["a", 3], ["b", 2]].map(([slug, quantity]) => ({ slug, quantity })));
    });

    it("two shoppers racing for the last unit: exactly one gets it", () => {
      db.update(schema.inventory).set({ onHand: 1 }).where(eq(schema.inventory.productSlug, "a")).run();
      const cart1 = makeGuestCart([["a", 1]]);
      const cart2 = makeGuestCart([["a", 1]]);

      const first = createOrder(
        db,
        baseInput({ owner: { kind: "guest", tokenHash: "browser-1" }, cartId: cart1, lines: [line("a", 1)] }),
      );
      const second = createOrder(
        db,
        baseInput({ owner: { kind: "guest", tokenHash: "browser-2" }, cartId: cart2, lines: [line("a", 1)] }),
      );

      expect(first.ok).toBe(true);
      expect(second).toMatchObject({ ok: false, code: "insufficient_stock" });
      expect(orderCount()).toBe(1);
      expect(stock("a")).toEqual({ onHand: 1, reserved: 1 });
      expect(cartLines(cart2)).toEqual([{ slug: "a", quantity: 1 }]);
    });

    it("an expired hold held by someone else no longer blocks this order", () => {
      db.update(schema.inventory).set({ onHand: 1 }).where(eq(schema.inventory.productSlug, "a")).run();
      const cart1 = makeGuestCart([["a", 1]]);
      createOrder(
        db,
        baseInput({
          owner: { kind: "guest", tokenHash: "browser-1" },
          cartId: cart1,
          lines: [line("a", 1)],
          now: new Date("2030-01-01T12:00:00Z"),
        }),
      );
      const cart2 = makeGuestCart([["a", 1]]);

      const later = new Date("2030-01-01T12:00:00Z").getTime() + TTL + 1000;
      const result = createOrder(
        db,
        baseInput({
          owner: { kind: "guest", tokenHash: "browser-2" },
          cartId: cart2,
          lines: [line("a", 1)],
          now: new Date(later),
        }),
      );

      expect(result.ok).toBe(true);
      expect(stock("a")).toEqual({ onHand: 1, reserved: 1 });
      expect(db.select().from(schema.orders).orderBy(schema.orders.id).all().map((o) => o.status)).toEqual([
        "expired",
        "pending_payment",
      ]);
    });
  });

  describe("idempotency", () => {
    it("replaying the same key and owner returns the same order and reserves nothing more", () => {
      const cartId = makeGuestCart([["a", 2]]);
      const input = baseInput({ cartId, lines: [line("a", 2)], idempotencyKey: "retry-me" });

      const first = createOrder(db, input);
      const replay = createOrder(db, input);

      expect(first).toMatchObject({ ok: true, replay: false });
      expect(replay).toMatchObject({ ok: true, replay: true });
      expect(replay.ok && first.ok && replay.orderId).toBe(first.ok && first.orderId);
      expect(orderCount()).toBe(1);
      expect(stock("a")).toEqual({ onHand: 10, reserved: 2 });
    });

    it("a replay still works after the order moved on (e.g. paid)", () => {
      const cartId = makeGuestCart([["a", 2]]);
      const input = baseInput({ cartId, lines: [line("a", 2)], idempotencyKey: "retry-me" });
      const first = createOrder(db, input);
      if (!first.ok) throw new Error("setup");
      applyTransition(db, first.orderId, "pay");

      const replay = createOrder(db, input);

      expect(replay).toMatchObject({ ok: true, replay: true, orderId: first.orderId });
      expect(stock("a")).toEqual({ onHand: 8, reserved: 0 });
    });

    it("the same key from a different owner is a conflict, never that owner's order", () => {
      const cart1 = makeGuestCart([["a", 1]]);
      createOrder(
        db,
        baseInput({ owner: { kind: "guest", tokenHash: "browser-1" }, cartId: cart1, lines: [line("a", 1)], idempotencyKey: "shared" }),
      );
      const cart2 = makeGuestCart([["a", 1]]);

      const result = createOrder(
        db,
        baseInput({ owner: { kind: "guest", tokenHash: "browser-2" }, cartId: cart2, lines: [line("a", 1)], idempotencyKey: "shared" }),
      );

      expect(result).toEqual({ ok: false, code: "key_conflict" });
      expect(orderCount()).toBe(1);
      expect(cartLines(cart2)).toHaveLength(1);
    });

    it("a customer can't replay a guest's key (and vice versa)", () => {
      const cart1 = makeGuestCart([["a", 1]]);
      createOrder(db, baseInput({ cartId: cart1, lines: [line("a", 1)], idempotencyKey: "shared" }));
      const customerId = makeCustomer();
      const [cart2] = db.insert(schema.carts).values({ customerId }).returning().all();
      db.insert(schema.cartItems).values({ cartId: cart2.id, productSlug: "a", quantity: 1 }).run();

      const result = createOrder(
        db,
        baseInput({ owner: { kind: "customer", customerId }, cartId: cart2.id, lines: [line("a", 1)], idempotencyKey: "shared" }),
      );

      expect(result).toEqual({ ok: false, code: "key_conflict" });
    });

    it("a replay does not trip the open-order guard", () => {
      const cartId = makeGuestCart([["a", 1]]);
      const input = baseInput({ cartId, lines: [line("a", 1)], idempotencyKey: "k" });
      createOrder(db, input);
      expect(createOrder(db, input)).toMatchObject({ ok: true, replay: true });
    });
  });

  describe("one open order per owner", () => {
    it("blocks a second order while one is unpaid, pointing at the open one", () => {
      const cart1 = makeGuestCart([["a", 1]]);
      createOrder(db, baseInput({ cartId: cart1, lines: [line("a", 1)] }));
      const open = db.select().from(schema.orders).get()!;
      const cart2 = makeGuestCart([["b", 1]]);

      const result = createOrder(db, baseInput({ cartId: cart2, lines: [line("b", 1)] }));

      expect(result).toEqual({ ok: false, code: "open_order", orderPublicId: open.publicId });
      expect(orderCount()).toBe(1);
      expect(stock("b")).toEqual({ onHand: 10, reserved: 0 });
      expect(cartLines(cart2)).toHaveLength(1);
    });

    it("applies per customer too", () => {
      const customerId = makeCustomer();
      const [cart] = db.insert(schema.carts).values({ customerId }).returning().all();
      const owner = { kind: "customer", customerId } as const;
      db.insert(schema.cartItems).values({ cartId: cart.id, productSlug: "a", quantity: 1 }).run();
      createOrder(db, baseInput({ owner, cartId: cart.id, lines: [line("a", 1)] }));
      db.insert(schema.cartItems).values({ cartId: cart.id, productSlug: "b", quantity: 1 }).run();

      expect(createOrder(db, baseInput({ owner, cartId: cart.id, lines: [line("b", 1)] }))).toMatchObject({
        ok: false,
        code: "open_order",
      });
    });

    it("does not block a different owner", () => {
      const cart1 = makeGuestCart([["a", 1]]);
      createOrder(db, baseInput({ owner: { kind: "guest", tokenHash: "browser-1" }, cartId: cart1, lines: [line("a", 1)] }));
      const cart2 = makeGuestCart([["b", 1]]);

      const result = createOrder(
        db,
        baseInput({ owner: { kind: "guest", tokenHash: "browser-2" }, cartId: cart2, lines: [line("b", 1)] }),
      );

      expect(result.ok).toBe(true);
    });

    it.each(["cancel", "pay"] as const)("allows a new order once the open one is %s-ed", (event) => {
      const cart1 = makeGuestCart([["a", 1]]);
      const first = createOrder(db, baseInput({ cartId: cart1, lines: [line("a", 1)] }));
      if (!first.ok) throw new Error("setup");
      applyTransition(db, first.orderId, event);
      const cart2 = makeGuestCart([["b", 1]]);

      expect(createOrder(db, baseInput({ cartId: cart2, lines: [line("b", 1)] })).ok).toBe(true);
    });

    it("allows a new order once the open one has expired", () => {
      const cart1 = makeGuestCart([["a", 1]]);
      const t0 = new Date("2030-01-01T12:00:00Z");
      createOrder(db, baseInput({ cartId: cart1, lines: [line("a", 1)], now: t0 }));
      const cart2 = makeGuestCart([["b", 1]]);

      const result = createOrder(
        db,
        baseInput({ cartId: cart2, lines: [line("b", 1)], now: new Date(t0.getTime() + TTL + 1) }),
      );

      expect(result.ok).toBe(true);
      expect(stock("a")).toEqual({ onHand: 10, reserved: 0 });
    });
  });

  describe("cart consistency", () => {
    it("refuses when the cart changed after pricing (different quantity)", () => {
      const cartId = makeGuestCart([["a", 5]]);

      const result = createOrder(db, baseInput({ cartId, lines: [line("a", 2)] }));

      expect(result).toEqual({ ok: false, code: "cart_changed" });
      expect(orderCount()).toBe(0);
      expect(stock("a")).toEqual({ onHand: 10, reserved: 0 });
    });

    it("refuses when a line was added after pricing", () => {
      const cartId = makeGuestCart([["a", 1], ["b", 1]]);
      expect(createOrder(db, baseInput({ cartId, lines: [line("a", 1)] }))).toEqual({
        ok: false,
        code: "cart_changed",
      });
    });

    it("refuses when a priced line was removed", () => {
      const cartId = makeGuestCart([["a", 1]]);
      expect(createOrder(db, baseInput({ cartId, lines: [line("a", 1), line("b", 1)] }))).toEqual({
        ok: false,
        code: "cart_changed",
      });
    });

    it("refuses an empty order", () => {
      const cartId = makeGuestCart([]);
      expect(createOrder(db, baseInput({ cartId, lines: [] }))).toEqual({ ok: false, code: "cart_changed" });
    });
  });

  describe("atomicity", () => {
    it("rolls the stock hold and the order back together if a later insert fails", () => {
      const cartId = makeGuestCart([["a", 2]]);
      // A negative unit price violates order_items' CHECK after the hold and the order row were written.
      const bad = { ...line("a", 2), unitPriceCents: -1, lineTotalCents: -2 };

      expect(() => createOrder(db, baseInput({ cartId, lines: [bad] }))).toThrow();

      expect(orderCount()).toBe(0);
      expect(stock("a")).toEqual({ onHand: 10, reserved: 0 });
      expect(cartLines(cartId)).toEqual([{ slug: "a", quantity: 2 }]);
      expect(db.select().from(schema.orderEvents).all()).toHaveLength(0);
    });
  });
});
