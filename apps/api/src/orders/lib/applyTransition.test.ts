import { beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import * as schema from "../../db/schema.js";
import { reserveStock } from "../../inventory/lib/inventoryRepo.js";
import { applyTransition, OrderNotFoundError } from "./applyTransition.js";
import { expireStaleOrders } from "./expireStaleOrders.js";
import { IllegalTransitionError, type OrderStatus } from "./orderStateMachine.js";

const sqlite = new Database(":memory:");
sqlite.pragma("foreign_keys = ON");
const db = drizzle(sqlite, { schema });
migrate(db, { migrationsFolder: "./src/db/migrations" });

type Line = [slug: string, quantity: number];

let counter = 0;

/** Seeds inventory, creates an order with these lines and (for pending orders) holds their stock the way order creation will. */
function makeOrder(
  lines: Line[],
  opts: { status?: OrderStatus; expiresAt?: Date; hold?: boolean } = {},
) {
  counter += 1;
  const { status = "pending_payment", expiresAt = new Date(Date.now() + 15 * 60_000), hold = true } = opts;

  const [order] = db
    .insert(schema.orders)
    .values({
      publicId: `pub-${counter}`,
      guestTokenHash: `guest-${counter}`,
      contactEmail: "g@example.com",
      status,
      currency: "EUR",
      totalCents: 1000,
      shipName: "Ada",
      shipLine1: "1 Main St",
      shipCity: "Berlin",
      shipPostalCode: "10115",
      shipCountry: "DE",
      idempotencyKey: `key-${counter}`,
      reservationExpiresAt: expiresAt,
    })
    .returning()
    .all();

  for (const [slug, quantity] of lines) {
    db.insert(schema.orderItems)
      .values({ orderId: order.id, productSlug: slug, title: slug, unitPriceCents: 500, quantity })
      .run();
  }

  if (hold && status === "pending_payment") {
    const result = reserveStock(db, lines.map(([slug, quantity]) => ({ slug, quantity })));
    if (!result.ok) throw new Error("test setup: not enough stock to hold");
  }

  return order.id;
}

function stock(slug: string) {
  const row = db.select().from(schema.inventory).where(eq(schema.inventory.productSlug, slug)).get();
  return row ? { onHand: row.onHand, reserved: row.reserved } : undefined;
}

function statusOf(orderId: number) {
  return db.select().from(schema.orders).where(eq(schema.orders.id, orderId)).get()!.status;
}

function eventsOf(orderId: number) {
  return db
    .select()
    .from(schema.orderEvents)
    .where(eq(schema.orderEvents.orderId, orderId))
    .orderBy(schema.orderEvents.id)
    .all()
    .map((e) => [e.fromStatus, e.toStatus, e.reason]);
}

beforeEach(() => {
  sqlite.exec("DELETE FROM order_events; DELETE FROM order_items; DELETE FROM orders; DELETE FROM inventory;");
  db.insert(schema.inventory)
    .values([
      { productSlug: "a", onHand: 10 },
      { productSlug: "b", onHand: 10 },
    ])
    .run();
});

describe("applyTransition", () => {
  describe("pay", () => {
    it("turns the hold into a sale: reserved and on_hand both drop", () => {
      const id = makeOrder([["a", 3], ["b", 2]]);
      expect(stock("a")).toEqual({ onHand: 10, reserved: 3 });

      expect(applyTransition(db, id, "pay")).toEqual({
        outcome: "applied",
        from: "pending_payment",
        to: "paid",
      });

      expect(statusOf(id)).toBe("paid");
      expect(stock("a")).toEqual({ onHand: 7, reserved: 0 });
      expect(stock("b")).toEqual({ onHand: 8, reserved: 0 });
    });

    it("stamps paid_at", () => {
      const id = makeOrder([["a", 1]]);
      applyTransition(db, id, "pay");
      const order = db.select().from(schema.orders).where(eq(schema.orders.id, id)).get()!;
      expect(order.paidAt).toBeInstanceOf(Date);
    });
  });

  describe("cancel and expire", () => {
    it.each(["cancel", "expire"] as const)("%s releases the hold and leaves on_hand alone", (event) => {
      const id = makeOrder([["a", 3]]);

      const result = applyTransition(db, id, event);

      expect(result.outcome).toBe("applied");
      expect(statusOf(id)).toBe(event === "cancel" ? "cancelled" : "expired");
      expect(stock("a")).toEqual({ onHand: 10, reserved: 0 });
    });
  });

  describe("fulfil", () => {
    it("moves paid to fulfilled without touching stock", () => {
      const id = makeOrder([["a", 3]]);
      applyTransition(db, id, "pay");
      const afterPay = stock("a");

      expect(applyTransition(db, id, "fulfil").outcome).toBe("applied");

      expect(statusOf(id)).toBe("fulfilled");
      expect(stock("a")).toEqual(afterPay);
    });
  });

  describe("replays are no-ops", () => {
    it.each(["pay", "cancel", "expire"] as const)("a second %s does not move stock again", (event) => {
      const id = makeOrder([["a", 3]]);
      makeOrder([["a", 4]]); // someone else's hold, must be left alone
      applyTransition(db, id, event);
      const afterFirst = stock("a");
      const eventsAfterFirst = eventsOf(id);

      const second = applyTransition(db, id, event);

      expect(second.outcome).toBe("already");
      expect(stock("a")).toEqual(afterFirst);
      expect(eventsOf(id)).toEqual(eventsAfterFirst);
    });

    it("a duplicate pay does not double-commit stock (webhook retry)", () => {
      const id = makeOrder([["a", 3]]);
      applyTransition(db, id, "pay");
      applyTransition(db, id, "pay");
      applyTransition(db, id, "pay");
      expect(stock("a")).toEqual({ onHand: 7, reserved: 0 });
    });
  });

  describe("illegal moves change nothing", () => {
    it.each([
      ["paid", "cancel"],
      ["paid", "expire"],
      ["cancelled", "pay"],
      ["expired", "pay"],
      ["fulfilled", "cancel"],
      ["pending_payment", "fulfil"],
    ] as const)("%s + %s throws and leaves status, stock and events as they were", (status, event) => {
      const id = makeOrder([["a", 3]], { status });
      db.update(schema.inventory).set({ reserved: 1 }).where(eq(schema.inventory.productSlug, "a")).run();
      const stockBefore = stock("a");
      const eventsBefore = eventsOf(id);

      expect(() => applyTransition(db, id, event)).toThrow(IllegalTransitionError);

      expect(statusOf(id)).toBe(status);
      expect(stock("a")).toEqual(stockBefore);
      expect(eventsOf(id)).toEqual(eventsBefore);
    });

    it("a cancelled order can't be paid later (late payment after cancel never sells stock)", () => {
      const id = makeOrder([["a", 3]]);
      applyTransition(db, id, "cancel");
      expect(() => applyTransition(db, id, "pay")).toThrow(IllegalTransitionError);
      expect(stock("a")).toEqual({ onHand: 10, reserved: 0 });
    });
  });

  it("throws OrderNotFoundError for an unknown order", () => {
    expect(() => applyTransition(db, 99999, "pay")).toThrow(OrderNotFoundError);
  });

  describe("atomicity", () => {
    it("rolls the status change back if the stock move fails", () => {
      const id = makeOrder([["a", 3]]);
      // Corrupt the books: the order's hold is gone, so releasing it would drive reserved below 0.
      db.update(schema.inventory).set({ reserved: 0 }).where(eq(schema.inventory.productSlug, "a")).run();

      expect(() => applyTransition(db, id, "cancel")).toThrow(/CHECK constraint/);

      expect(statusOf(id)).toBe("pending_payment");
      expect(eventsOf(id)).toEqual([]);
    });

    it("is undone with the caller's transaction", () => {
      const id = makeOrder([["a", 3]]);
      expect(() =>
        db.transaction((tx) => {
          applyTransition(tx, id, "cancel");
          throw new Error("caller aborted");
        }),
      ).toThrow("caller aborted");

      expect(statusOf(id)).toBe("pending_payment");
      expect(stock("a")).toEqual({ onHand: 10, reserved: 3 });
    });
  });

  describe("audit trail", () => {
    it("appends one event per applied transition, with the reason", () => {
      const id = makeOrder([["a", 1]]);
      applyTransition(db, id, "pay", "payment confirmed");
      applyTransition(db, id, "fulfil");

      expect(eventsOf(id)).toEqual([
        ["pending_payment", "paid", "payment confirmed"],
        ["paid", "fulfilled", null],
      ]);
    });
  });
});

describe("expireStaleOrders", () => {
  const past = () => new Date(Date.now() - 60_000);
  const future = () => new Date(Date.now() + 15 * 60_000);

  it("expires an order past its deadline and frees its stock", () => {
    const id = makeOrder([["a", 4]], { expiresAt: past() });
    expect(stock("a")).toEqual({ onHand: 10, reserved: 4 });

    const result = expireStaleOrders(db);

    expect(result.expired).toEqual([id]);
    expect(statusOf(id)).toBe("expired");
    expect(stock("a")).toEqual({ onHand: 10, reserved: 0 });
    expect(eventsOf(id)).toEqual([["pending_payment", "expired", "reservation expired"]]);
  });

  it("leaves an order before its deadline untouched", () => {
    const id = makeOrder([["a", 4]], { expiresAt: future() });

    expect(expireStaleOrders(db).expired).toEqual([]);

    expect(statusOf(id)).toBe("pending_payment");
    expect(stock("a")).toEqual({ onHand: 10, reserved: 4 });
  });

  it("only touches the stale order when stale and live ones share a product", () => {
    const stale = makeOrder([["a", 2]], { expiresAt: past() });
    const live = makeOrder([["a", 3]], { expiresAt: future() });

    expect(expireStaleOrders(db).expired).toEqual([stale]);

    expect(statusOf(live)).toBe("pending_payment");
    expect(stock("a")).toEqual({ onHand: 10, reserved: 3 });
  });

  it("sweeping twice releases once", () => {
    makeOrder([["a", 4]], { expiresAt: past() });
    makeOrder([["a", 1]], { expiresAt: future() });

    expireStaleOrders(db);
    const second = expireStaleOrders(db);

    expect(second.expired).toEqual([]);
    expect(stock("a")).toEqual({ onHand: 10, reserved: 1 });
  });

  it("never expires a paid order, even past its reservation deadline", () => {
    const id = makeOrder([["a", 3]], { expiresAt: past() });
    applyTransition(db, id, "pay");

    expect(expireStaleOrders(db).expired).toEqual([]);

    expect(statusOf(id)).toBe("paid");
    expect(stock("a")).toEqual({ onHand: 7, reserved: 0 });
  });

  it("ignores orders already cancelled or expired", () => {
    const id = makeOrder([["a", 3]], { expiresAt: past() });
    applyTransition(db, id, "cancel");

    expect(expireStaleOrders(db).expired).toEqual([]);
    expect(stock("a")).toEqual({ onHand: 10, reserved: 0 });
  });

  it("uses the clock it is given", () => {
    const id = makeOrder([["a", 1]], { expiresAt: new Date("2030-01-01T00:00:00Z") });

    expect(expireStaleOrders(db, new Date("2029-12-31T23:59:00Z")).expired).toEqual([]);
    expect(expireStaleOrders(db, new Date("2030-01-01T00:00:00Z")).expired).toEqual([id]);
  });

  it("one order that can't be expired doesn't block the rest", () => {
    const broken = makeOrder([["a", 2]], { expiresAt: past() });
    const fine = makeOrder([["b", 2]], { expiresAt: past() });
    // Break the first order's books so its release throws.
    db.update(schema.inventory).set({ reserved: 0 }).where(eq(schema.inventory.productSlug, "a")).run();

    const result = expireStaleOrders(db);

    expect(result.expired).toEqual([fine]);
    expect(result.failed.map((f) => f.orderId)).toEqual([broken]);
    expect(statusOf(broken)).toBe("pending_payment");
    expect(statusOf(fine)).toBe("expired");
  });
});
