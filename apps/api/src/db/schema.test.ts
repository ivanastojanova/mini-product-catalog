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

describe("payments constraints", () => {
  async function makeOrder() {
    const [order] = await db.insert(schema.orders).values(orderValues()).returning();
    return order.id;
  }

  function paymentValues(orderId: number, overrides: Partial<typeof schema.payments.$inferInsert> = {}) {
    counter += 1;
    return {
      orderId,
      gatewayIntentId: `pi_${counter}`,
      amountCents: 1000,
      currency: "EUR",
      ...overrides,
    };
  }

  it("accepts a valid row and defaults to pending with no refund", async () => {
    const orderId = await makeOrder();
    const [payment] = await db.insert(schema.payments).values(paymentValues(orderId)).returning();
    expect(payment.status).toBe("pending");
    expect(payment.refundId).toBeNull();
  });

  it("rejects an amount of zero or less", async () => {
    const orderId = await makeOrder();
    await expect(
      db.insert(schema.payments).values(paymentValues(orderId, { amountCents: 0 })),
    ).rejects.toThrow(/CHECK constraint/);
    await expect(
      db.insert(schema.payments).values(paymentValues(orderId, { amountCents: -5 })),
    ).rejects.toThrow(/CHECK constraint/);
  });

  it("accepts every status the schema lists and rejects anything else", async () => {
    for (const status of schema.PAYMENT_STATUS_VALUES) {
      // A fresh order each time, so the one-pending-per-order rule doesn't interfere.
      const orderId = await makeOrder();
      await db.insert(schema.payments).values(paymentValues(orderId, { status }));
    }
    const orderId = await makeOrder();
    await expect(
      db.insert(schema.payments).values(paymentValues(orderId, { status: "captured" })),
    ).rejects.toThrow(/CHECK constraint/);
  });

  it("rejects a payment for an order that doesn't exist", async () => {
    await expect(db.insert(schema.payments).values(paymentValues(999_999))).rejects.toThrow(
      /FOREIGN KEY constraint/,
    );
  });

  it("refuses to delete an order that has a payment (financial history is kept)", async () => {
    const orderId = await makeOrder();
    await db.insert(schema.payments).values(paymentValues(orderId));
    expect(() => sqlite.prepare("DELETE FROM orders WHERE id = ?").run(orderId)).toThrow(
      /FOREIGN KEY constraint/,
    );
  });

  it("rejects a reused gateway intent id", async () => {
    const orderId = await makeOrder();
    const otherOrderId = await makeOrder();
    await db.insert(schema.payments).values(paymentValues(orderId, { gatewayIntentId: "pi_dup" }));
    await expect(
      db.insert(schema.payments).values(paymentValues(otherOrderId, { gatewayIntentId: "pi_dup" })),
    ).rejects.toThrow(/UNIQUE constraint/);
  });

  it("allows several rows with no intent id yet (NULLs are distinct)", async () => {
    const first = await makeOrder();
    const second = await makeOrder();
    await db.insert(schema.payments).values(paymentValues(first, { gatewayIntentId: null }));
    await db.insert(schema.payments).values(paymentValues(second, { gatewayIntentId: null }));
  });

  it("allows only one pending attempt per order", async () => {
    const orderId = await makeOrder();
    await db.insert(schema.payments).values(paymentValues(orderId, { status: "pending" }));
    await expect(
      db.insert(schema.payments).values(paymentValues(orderId, { status: "pending" })),
    ).rejects.toThrow(/UNIQUE constraint/);
  });

  it("allows a new attempt once the previous one is no longer pending, and any number of finished ones", async () => {
    const orderId = await makeOrder();
    await db.insert(schema.payments).values(paymentValues(orderId, { status: "failed" }));
    await db.insert(schema.payments).values(paymentValues(orderId, { status: "failed" }));
    await db.insert(schema.payments).values(paymentValues(orderId, { status: "pending" }));
    await db.insert(schema.payments).values(paymentValues(orderId, { status: "refunded" }));
  });

  it("lets a pending attempt on another order coexist", async () => {
    const first = await makeOrder();
    const second = await makeOrder();
    await db.insert(schema.payments).values(paymentValues(first, { status: "pending" }));
    await db.insert(schema.payments).values(paymentValues(second, { status: "pending" }));
  });
});

describe("payment_events constraints", () => {
  function eventValues(overrides: Partial<typeof schema.paymentEvents.$inferInsert> = {}) {
    counter += 1;
    return {
      gatewayEventId: `evt_${counter}`,
      type: "payment_intent.succeeded",
      payload: "{}",
      outcome: "applied",
      ...overrides,
    };
  }

  it("accepts every outcome the schema lists and rejects anything else", async () => {
    for (const outcome of schema.PAYMENT_EVENT_OUTCOME_VALUES) {
      await db.insert(schema.paymentEvents).values(eventValues({ outcome }));
    }
    await expect(
      db.insert(schema.paymentEvents).values(eventValues({ outcome: "maybe" })),
    ).rejects.toThrow(/CHECK constraint/);
  });

  it("rejects the same gateway event id twice (this is the idempotency guarantee)", async () => {
    await db.insert(schema.paymentEvents).values(eventValues({ gatewayEventId: "evt_same" }));
    await expect(
      db.insert(schema.paymentEvents).values(eventValues({ gatewayEventId: "evt_same" })),
    ).rejects.toThrow(/UNIQUE constraint/);
  });

  it("requires a type and a payload", async () => {
    await expect(
      db.insert(schema.paymentEvents).values({ ...eventValues(), type: null as unknown as string }),
    ).rejects.toThrow(/NOT NULL constraint/);
    await expect(
      db.insert(schema.paymentEvents).values({ ...eventValues(), payload: null as unknown as string }),
    ).rejects.toThrow(/NOT NULL constraint/);
  });
});
