import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema.js";
import { ORDER_STATUSES } from "../orders/lib/orderStateMachine.js";

const sqlite = new Database(":memory:");
sqlite.pragma("foreign_keys = ON");
const db = drizzle(sqlite, { schema });
migrate(db, { migrationsFolder: "./src/db/migrations" });

let counter = 0;

function orderValues(overrides: Partial<typeof schema.orders.$inferInsert> = {}) {
  counter += 1;
  return {
    publicId: `public-${counter}`,
    guestTokenHash: `guest-hash-${counter}`,
    contactEmail: "guest@example.com",
    currency: "EUR",
    totalCents: 1000,
    shipName: "Ada",
    shipLine1: "1 Main St",
    shipCity: "Berlin",
    shipPostalCode: "10115",
    shipCountry: "DE",
    idempotencyKey: `key-${counter}`,
    reservationExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
    ...overrides,
  };
}

async function makeCustomer() {
  counter += 1;
  const [customer] = await db
    .insert(schema.customers)
    .values({ email: `c${counter}@example.com`, passwordHash: "x", name: "C" })
    .returning();
  return customer.id;
}

describe("order status lists", () => {
  it("schema's CHECK list matches the state machine's statuses", () => {
    expect([...schema.ORDER_STATUS_VALUES]).toEqual([...ORDER_STATUSES]);
  });
});

describe("inventory constraints", () => {
  it("accepts a valid row and defaults reserved to 0", async () => {
    await db.insert(schema.inventory).values({ productSlug: "inv-ok", onHand: 5 });
    const [row] = await db.select().from(schema.inventory);
    expect(row.reserved).toBe(0);
  });

  it("rejects negative on_hand", async () => {
    await expect(
      db.insert(schema.inventory).values({ productSlug: "inv-neg", onHand: -1 }),
    ).rejects.toThrow(/CHECK constraint/);
  });

  it("rejects reserved above on_hand (overselling)", async () => {
    await expect(
      db.insert(schema.inventory).values({ productSlug: "inv-over", onHand: 2, reserved: 3 }),
    ).rejects.toThrow(/CHECK constraint/);
  });

  it("rejects an update that would reserve more than is on hand", async () => {
    await db.insert(schema.inventory).values({ productSlug: "inv-upd", onHand: 2 });
    expect(() =>
      sqlite.prepare("UPDATE inventory SET reserved = reserved + 3 WHERE product_slug = 'inv-upd'").run(),
    ).toThrow(/CHECK constraint/);
  });

  it("rejects an update that would drive reserved negative", async () => {
    await db.insert(schema.inventory).values({ productSlug: "inv-under", onHand: 2 });
    expect(() =>
      sqlite.prepare("UPDATE inventory SET reserved = reserved - 1 WHERE product_slug = 'inv-under'").run(),
    ).toThrow(/CHECK constraint/);
  });
});

describe("orders constraints", () => {
  it("accepts a guest order and a customer order", async () => {
    await db.insert(schema.orders).values(orderValues());
    const customerId = await makeCustomer();
    await db.insert(schema.orders).values(orderValues({ guestTokenHash: null, customerId }));
  });

  it("defaults status to pending_payment", async () => {
    const [order] = await db.insert(schema.orders).values(orderValues()).returning();
    expect(order.status).toBe("pending_payment");
  });

  it("rejects an order with no owner", async () => {
    await expect(
      db.insert(schema.orders).values(orderValues({ guestTokenHash: null })),
    ).rejects.toThrow(/CHECK constraint/);
  });

  it("rejects an order with both owners", async () => {
    const customerId = await makeCustomer();
    await expect(
      db.insert(schema.orders).values(orderValues({ customerId })),
    ).rejects.toThrow(/CHECK constraint/);
  });

  it("rejects an unknown status", async () => {
    await expect(
      db.insert(schema.orders).values(orderValues({ status: "shipped" })),
    ).rejects.toThrow(/CHECK constraint/);
  });

  it("rejects a negative total", async () => {
    await expect(
      db.insert(schema.orders).values(orderValues({ totalCents: -1 })),
    ).rejects.toThrow(/CHECK constraint/);
  });

  it("rejects a duplicate idempotency key and a duplicate public id", async () => {
    const first = orderValues();
    await db.insert(schema.orders).values(first);
    await expect(
      db.insert(schema.orders).values(orderValues({ idempotencyKey: first.idempotencyKey })),
    ).rejects.toThrow(/UNIQUE constraint/);
    await expect(
      db.insert(schema.orders).values(orderValues({ publicId: first.publicId })),
    ).rejects.toThrow(/UNIQUE constraint/);
  });

  it("lets one guest browser place several orders (guest_token_hash is not unique)", async () => {
    await db.insert(schema.orders).values(orderValues({ guestTokenHash: "same-browser" }));
    await db.insert(schema.orders).values(orderValues({ guestTokenHash: "same-browser" }));
  });

  it("refuses to delete a customer who has orders (history is kept)", async () => {
    const customerId = await makeCustomer();
    await db.insert(schema.orders).values(orderValues({ guestTokenHash: null, customerId }));
    expect(() =>
      sqlite.prepare("DELETE FROM customers WHERE id = ?").run(customerId),
    ).toThrow(/FOREIGN KEY constraint/);
  });
});

describe("order_items and order_events constraints", () => {
  async function makeOrder() {
    const [order] = await db.insert(schema.orders).values(orderValues()).returning();
    return order.id;
  }

  it("accepts a valid item and rejects quantity 0 or above the line cap", async () => {
    const orderId = await makeOrder();
    const item = { orderId, title: "T", unitPriceCents: 500 };
    await db.insert(schema.orderItems).values({ ...item, productSlug: "a", quantity: 1 });
    await db.insert(schema.orderItems).values({ ...item, productSlug: "b", quantity: schema.MAX_LINE_QUANTITY });
    await expect(
      db.insert(schema.orderItems).values({ ...item, productSlug: "c", quantity: 0 }),
    ).rejects.toThrow(/CHECK constraint/);
    await expect(
      db.insert(schema.orderItems).values({ ...item, productSlug: "d", quantity: schema.MAX_LINE_QUANTITY + 1 }),
    ).rejects.toThrow(/CHECK constraint/);
  });

  it("rejects a negative unit price and a duplicate (order, slug) line", async () => {
    const orderId = await makeOrder();
    const item = { orderId, title: "T", quantity: 1 };
    await expect(
      db.insert(schema.orderItems).values({ ...item, productSlug: "a", unitPriceCents: -1 }),
    ).rejects.toThrow(/CHECK constraint/);
    await db.insert(schema.orderItems).values({ ...item, productSlug: "a", unitPriceCents: 1 });
    await expect(
      db.insert(schema.orderItems).values({ ...item, productSlug: "a", unitPriceCents: 1 }),
    ).rejects.toThrow(/UNIQUE constraint/);
  });

  it("deletes items and events with their order", async () => {
    const orderId = await makeOrder();
    await db.insert(schema.orderItems).values({ orderId, productSlug: "a", title: "T", unitPriceCents: 1, quantity: 1 });
    await db.insert(schema.orderEvents).values({ orderId, fromStatus: null, toStatus: "pending_payment" });
    sqlite.prepare("DELETE FROM orders WHERE id = ?").run(orderId);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM order_items WHERE order_id = ?").get(orderId)).toEqual({ n: 0 });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM order_events WHERE order_id = ?").get(orderId)).toEqual({ n: 0 });
  });

  it("allows a null from_status (creation) but rejects unknown statuses in events", async () => {
    const orderId = await makeOrder();
    await db.insert(schema.orderEvents).values({ orderId, fromStatus: null, toStatus: "pending_payment" });
    await db.insert(schema.orderEvents).values({ orderId, fromStatus: "pending_payment", toStatus: "paid" });
    await expect(
      db.insert(schema.orderEvents).values({ orderId, fromStatus: "pending_payment", toStatus: "shipped" }),
    ).rejects.toThrow(/CHECK constraint/);
    await expect(
      db.insert(schema.orderEvents).values({ orderId, fromStatus: "bogus", toStatus: "paid" }),
    ).rejects.toThrow(/CHECK constraint/);
  });
});
