import { beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import * as schema from "../../db/schema.js";
import { reserveStock } from "../../inventory/lib/inventoryRepo.js";
import { applyTransition } from "../../orders/lib/applyTransition.js";
import type { OrderStatus } from "../../orders/lib/orderStateMachine.js";
import { applyPaymentEvent } from "./applyPaymentEvent.js";
import type { GatewayEvent } from "./gatewayEvent.js";

const sqlite = new Database(":memory:");
sqlite.pragma("foreign_keys = ON");
const db = drizzle(sqlite, { schema });
migrate(db, { migrationsFolder: "./src/db/migrations" });

const log = { error: vi.fn(), warn: vi.fn() };

let counter = 0;

/** An order for 2 x slug "a" at 500 cents = 1000 total, holding its stock the way order creation does. */
function makeOrder(opts: { status?: OrderStatus; expiresAt?: Date } = {}) {
  counter += 1;
  const { status = "pending_payment", expiresAt = new Date(Date.now() + 15 * 60_000) } = opts;

  const [order] = db
    .insert(schema.orders)
    .values({
      publicId: `pub-${counter}`,
      guestTokenHash: `guest-${counter}`,
      contactEmail: "g@example.com",
      status: "pending_payment",
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

  db.insert(schema.orderItems)
    .values({ orderId: order.id, productSlug: "a", title: "A", unitPriceCents: 500, quantity: 2 })
    .run();

  const held = reserveStock(db, [{ slug: "a", quantity: 2 }]);
  if (!held.ok) throw new Error("test setup: not enough stock");

  if (status === "paid" || status === "fulfilled") applyTransition(db, order.id, "pay");
  if (status === "fulfilled") applyTransition(db, order.id, "fulfil");
  if (status === "cancelled") applyTransition(db, order.id, "cancel");
  if (status === "expired") applyTransition(db, order.id, "expire");

  return order.id;
}

function makePayment(
  orderId: number,
  opts: { status?: (typeof schema.PAYMENT_STATUS_VALUES)[number]; intentId?: string } = {},
) {
  counter += 1;
  const intentId = opts.intentId ?? `pi_${counter}`;
  const [row] = db
    .insert(schema.payments)
    .values({
      orderId,
      gatewayIntentId: intentId,
      amountCents: 1000,
      currency: "EUR",
      status: opts.status ?? "pending",
    })
    .returning()
    .all();
  return { id: row.id, intentId };
}

function succeeded(intentId: string, over: { id?: string; amount?: number; currency?: string } = {}) {
  counter += 1;
  return {
    id: over.id ?? `evt_${counter}`,
    type: "payment_intent.succeeded",
    data: { object: { id: intentId, amount: over.amount ?? 1000, currency: over.currency ?? "EUR" } },
  } satisfies GatewayEvent;
}

function failed(intentId: string, id?: string) {
  counter += 1;
  return {
    id: id ?? `evt_${counter}`,
    type: "payment_intent.payment_failed",
    data: { object: { id: intentId, amount: 1000, currency: "EUR" } },
  } satisfies GatewayEvent;
}

const apply = (event: GatewayEvent) => applyPaymentEvent(db, event, JSON.stringify(event), log);

function orderRow(orderId: number) {
  return db.select().from(schema.orders).where(eq(schema.orders.id, orderId)).get()!;
}

function stock() {
  const row = db.select().from(schema.inventory).where(eq(schema.inventory.productSlug, "a")).get()!;
  return { onHand: row.onHand, reserved: row.reserved };
}

function paymentRow(id: number) {
  return db.select().from(schema.payments).where(eq(schema.payments.id, id)).get()!;
}

function orderEventsOf(orderId: number) {
  return db
    .select()
    .from(schema.orderEvents)
    .where(eq(schema.orderEvents.orderId, orderId))
    .orderBy(schema.orderEvents.id)
    .all()
    .map((e) => [e.fromStatus, e.toStatus]);
}

function storedEvent(id: string) {
  return db.select().from(schema.paymentEvents).where(eq(schema.paymentEvents.gatewayEventId, id)).get();
}

beforeEach(() => {
  sqlite.exec(
    "DELETE FROM payment_events; DELETE FROM payments; DELETE FROM order_events; DELETE FROM order_items; DELETE FROM orders; DELETE FROM inventory;",
  );
  db.insert(schema.inventory).values({ productSlug: "a", onHand: 10 }).run();
  log.error.mockClear();
  log.warn.mockClear();
});

describe("payment_intent.succeeded on a payable order", () => {
  it("pays the order, commits the stock and marks the payment succeeded", () => {
    const orderId = makeOrder();
    const payment = makePayment(orderId);
    expect(stock()).toEqual({ onHand: 10, reserved: 2 });

    const result = apply(succeeded(payment.intentId));

    expect(result).toMatchObject({ status: "processed", outcome: "applied", refundPaymentIds: [] });
    expect(orderRow(orderId).status).toBe("paid");
    expect(orderRow(orderId).paidAt).not.toBeNull();
    expect(stock()).toEqual({ onHand: 8, reserved: 0 });
    expect(paymentRow(payment.id).status).toBe("succeeded");
  });

  it("records the event with its raw body and outcome", () => {
    const orderId = makeOrder();
    const payment = makePayment(orderId);
    const event = succeeded(payment.intentId, { id: "evt_record" });

    applyPaymentEvent(db, event, "the-exact-bytes", log);

    expect(storedEvent("evt_record")).toMatchObject({
      type: "payment_intent.succeeded",
      payload: "the-exact-bytes",
      outcome: "applied",
    });
  });

  it("writes the payment into the order's audit trail", () => {
    const orderId = makeOrder();
    const payment = makePayment(orderId);
    apply(succeeded(payment.intentId));

    const reason = db
      .select()
      .from(schema.orderEvents)
      .where(eq(schema.orderEvents.toStatus, "paid"))
      .get()!.reason;
    expect(reason).toBe(`payment ${payment.intentId}`);
  });
});

describe("idempotency (duplicate delivery)", () => {
  it("applies the same event id once: one transition, one audit row, stock committed once", () => {
    const orderId = makeOrder();
    const payment = makePayment(orderId);
    const event = succeeded(payment.intentId, { id: "evt_dup" });

    const first = apply(event);
    const second = apply(event);
    const third = apply(event);

    expect(first.status).toBe("processed");
    expect(second).toEqual({ status: "duplicate" });
    expect(third).toEqual({ status: "duplicate" });
    expect(orderEventsOf(orderId)).toEqual([["pending_payment", "paid"]]);
    expect(stock()).toEqual({ onHand: 8, reserved: 0 });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM payment_events").get()).toEqual({ n: 1 });
  });

  it("recognises a duplicate by the event id alone, whatever else the body says", () => {
    const orderId = makeOrder();
    const payment = makePayment(orderId);
    apply(succeeded(payment.intentId, { id: "evt_same_id" }));

    const different = succeeded(payment.intentId, { id: "evt_same_id", amount: 1 });
    expect(apply(different)).toEqual({ status: "duplicate" });
  });

  it("treats an event id that already exists in the table as a duplicate (the primary-key path two simultaneous deliveries would hit)", () => {
    const orderId = makeOrder();
    const payment = makePayment(orderId);
    db.insert(schema.paymentEvents)
      .values({ gatewayEventId: "evt_raced", type: "payment_intent.succeeded", payload: "{}", outcome: "applied" })
      .run();

    expect(apply(succeeded(payment.intentId, { id: "evt_raced" }))).toEqual({ status: "duplicate" });
    expect(orderRow(orderId).status).toBe("pending_payment");
    expect(stock()).toEqual({ onHand: 10, reserved: 2 });
  });

  it("does not refund twice when a late success is redelivered", () => {
    const orderId = makeOrder({ status: "expired" });
    const payment = makePayment(orderId);
    const event = succeeded(payment.intentId, { id: "evt_late_dup" });

    expect(apply(event)).toMatchObject({ refundPaymentIds: [payment.id] });
    expect(apply(event)).toEqual({ status: "duplicate" });
  });

  it("distinct event ids for the same intent are separate events", () => {
    const orderId = makeOrder();
    const payment = makePayment(orderId);
    apply(succeeded(payment.intentId, { id: "evt_1" }));
    const second = apply(succeeded(payment.intentId, { id: "evt_2" }));

    expect(second).toMatchObject({ status: "processed", outcome: "ignored" });
    expect(orderEventsOf(orderId)).toEqual([["pending_payment", "paid"]]);
    expect(stock()).toEqual({ onHand: 8, reserved: 0 });
  });
});

describe("payment_intent.payment_failed", () => {
  it("marks the payment failed and leaves the order open with its hold intact", () => {
    const orderId = makeOrder();
    const payment = makePayment(orderId);

    const result = apply(failed(payment.intentId));

    expect(result).toMatchObject({ status: "processed", outcome: "applied", refundPaymentIds: [] });
    expect(paymentRow(payment.id).status).toBe("failed");
    expect(orderRow(orderId).status).toBe("pending_payment");
    expect(stock()).toEqual({ onHand: 10, reserved: 2 });
    expect(orderEventsOf(orderId)).toEqual([]);
  });

  it("lets the shopper pay with a new attempt afterwards", () => {
    const orderId = makeOrder();
    const first = makePayment(orderId);
    apply(failed(first.intentId));

    const second = makePayment(orderId);
    apply(succeeded(second.intentId));

    expect(orderRow(orderId).status).toBe("paid");
    expect(paymentRow(first.id).status).toBe("failed");
    expect(paymentRow(second.id).status).toBe("succeeded");
  });

  it("ignores a failure that arrives after the payment already succeeded", () => {
    const orderId = makeOrder();
    const payment = makePayment(orderId);
    apply(succeeded(payment.intentId));

    const result = apply(failed(payment.intentId));

    expect(result).toMatchObject({ status: "processed", outcome: "ignored" });
    expect(paymentRow(payment.id).status).toBe("succeeded");
    expect(orderRow(orderId).status).toBe("paid");
  });

  it("does not cancel or expire the order", () => {
    const orderId = makeOrder();
    const payment = makePayment(orderId);
    apply(failed(payment.intentId));
    expect(orderRow(orderId).status).not.toBe("cancelled");
    expect(orderRow(orderId).status).not.toBe("expired");
  });
});

describe("late success: the order is no longer payable", () => {
  it.each(["expired", "cancelled"] as const)(
    "leaves a %s order and its stock alone and queues a refund",
    (status) => {
      const orderId = makeOrder({ status });
      const payment = makePayment(orderId);
      const stockBefore = stock();
      const eventsBefore = orderEventsOf(orderId);

      const result = apply(succeeded(payment.intentId, { id: "evt_late" }));

      expect(result).toMatchObject({
        status: "processed",
        outcome: "refund_requested",
        refundPaymentIds: [payment.id],
      });
      expect(orderRow(orderId).status).toBe(status);
      expect(stock()).toEqual(stockBefore);
      expect(orderEventsOf(orderId)).toEqual(eventsBefore);
      expect(paymentRow(payment.id).status).toBe("refund_pending");
      expect(storedEvent("evt_late")?.outcome).toBe("refund_requested");
    },
  );

  it("does not resurrect an expired order even when its stock is free again", () => {
    const orderId = makeOrder({ status: "expired" });
    const payment = makePayment(orderId);
    expect(stock()).toEqual({ onHand: 10, reserved: 0 });

    apply(succeeded(payment.intentId));

    expect(orderRow(orderId).status).toBe("expired");
    expect(stock()).toEqual({ onHand: 10, reserved: 0 });
  });

  it("treats an order past its deadline as expired even if nobody has swept it yet", () => {
    const orderId = makeOrder({ expiresAt: new Date(Date.now() - 1000) });
    const payment = makePayment(orderId);
    expect(orderRow(orderId).status).toBe("pending_payment");

    const result = apply(succeeded(payment.intentId));

    expect(result).toMatchObject({ outcome: "refund_requested", refundPaymentIds: [payment.id] });
    expect(orderRow(orderId).status).toBe("expired");
    expect(stock()).toEqual({ onHand: 10, reserved: 0 });
    expect(paymentRow(payment.id).status).toBe("refund_pending");
  });
});

describe("a second payment for an order that is already paid", () => {
  it("refunds the second one and leaves the order and stock alone", () => {
    const orderId = makeOrder();
    const first = makePayment(orderId);
    apply(succeeded(first.intentId));
    // The index allows a new attempt only once the first is no longer pending.
    const second = makePayment(orderId);
    const stockAfterFirst = stock();

    const result = apply(succeeded(second.intentId));

    expect(result).toMatchObject({ outcome: "refund_requested", refundPaymentIds: [second.id] });
    expect(paymentRow(first.id).status).toBe("succeeded");
    expect(paymentRow(second.id).status).toBe("refund_pending");
    expect(stock()).toEqual(stockAfterFirst);
    expect(orderEventsOf(orderId)).toEqual([["pending_payment", "paid"]]);
  });

  it("also refunds a payment for a fulfilled order", () => {
    const orderId = makeOrder({ status: "fulfilled" });
    const payment = makePayment(orderId);
    expect(apply(succeeded(payment.intentId))).toMatchObject({ refundPaymentIds: [payment.id] });
    expect(orderRow(orderId).status).toBe("fulfilled");
  });
});

describe("amount and currency must match the order", () => {
  it("does not pay the order for the wrong amount; refunds it", () => {
    const orderId = makeOrder();
    const payment = makePayment(orderId);

    const result = apply(succeeded(payment.intentId, { amount: 999 }));

    expect(result).toMatchObject({ outcome: "refund_requested", refundPaymentIds: [payment.id] });
    expect(orderRow(orderId).status).toBe("pending_payment");
    expect(stock()).toEqual({ onHand: 10, reserved: 2 });
    expect(paymentRow(payment.id).status).toBe("refund_pending");
    expect(log.error).toHaveBeenCalled();
  });

  it("rejects an amount that is too high as well as too low", () => {
    const orderId = makeOrder();
    const payment = makePayment(orderId);
    expect(apply(succeeded(payment.intentId, { amount: 100_000 }))).toMatchObject({ outcome: "refund_requested" });
    expect(orderRow(orderId).status).toBe("pending_payment");
  });

  it("does not pay the order in the wrong currency", () => {
    const orderId = makeOrder();
    const payment = makePayment(orderId);

    const result = apply(succeeded(payment.intentId, { currency: "USD" }));

    expect(result).toMatchObject({ outcome: "refund_requested" });
    expect(orderRow(orderId).status).toBe("pending_payment");
  });

  it("leaves the order payable by a correct attempt afterwards", () => {
    const orderId = makeOrder();
    const wrong = makePayment(orderId);
    apply(succeeded(wrong.intentId, { amount: 1 }));
    expect(paymentRow(wrong.id).status).toBe("refund_pending");

    const right = makePayment(orderId);
    apply(succeeded(right.intentId));
    expect(orderRow(orderId).status).toBe("paid");
  });
});

describe("events that can't be acted on are acknowledged, not errors", () => {
  it("ignores an unknown payment intent", () => {
    const orderId = makeOrder();
    makePayment(orderId);

    const result = apply(succeeded("pi_nobody_knows", { id: "evt_unknown" }));

    expect(result).toMatchObject({ status: "processed", outcome: "ignored", refundPaymentIds: [] });
    expect(orderRow(orderId).status).toBe("pending_payment");
    expect(storedEvent("evt_unknown")?.outcome).toBe("ignored");
  });

  it("ignores an unknown event type", () => {
    const orderId = makeOrder();
    const payment = makePayment(orderId);

    const result = apply({ id: "evt_weird", type: "customer.created", data: { object: { id: payment.intentId } } });

    expect(result).toMatchObject({ status: "processed", outcome: "ignored" });
    expect(orderRow(orderId).status).toBe("pending_payment");
    expect(paymentRow(payment.id).status).toBe("pending");
  });

  it.each([
    ["no data", { id: "e1", type: "payment_intent.succeeded" }],
    ["data that is not an object", { id: "e2", type: "payment_intent.succeeded", data: "x" }],
    ["no object", { id: "e3", type: "payment_intent.succeeded", data: {} }],
    ["no amount", { id: "e4", type: "payment_intent.succeeded", data: { object: { id: "pi", currency: "EUR" } } }],
    ["a fractional amount", { id: "e5", type: "payment_intent.succeeded", data: { object: { id: "pi", amount: 10.5, currency: "EUR" } } }],
    ["a string amount", { id: "e6", type: "payment_intent.succeeded", data: { object: { id: "pi", amount: "1000", currency: "EUR" } } }],
    ["no currency", { id: "e7", type: "payment_intent.succeeded", data: { object: { id: "pi", amount: 1000 } } }],
    ["no intent id", { id: "e8", type: "payment_intent.succeeded", data: { object: { amount: 1000, currency: "EUR" } } }],
  ])("ignores a success event with %s without touching any order", (_label, event) => {
    const orderId = makeOrder();
    makePayment(orderId, { intentId: "pi" });

    expect(apply(event as GatewayEvent)).toMatchObject({ status: "processed", outcome: "ignored" });
    expect(orderRow(orderId).status).toBe("pending_payment");
  });

  it("ignores a repeat success for a payment that is already refund_pending or refunded", () => {
    const orderId = makeOrder({ status: "expired" });
    const pending = makePayment(orderId, { status: "refund_pending" });
    const done = makePayment(orderId, { status: "refunded" });

    expect(apply(succeeded(pending.intentId))).toMatchObject({ outcome: "ignored", refundPaymentIds: [] });
    expect(apply(succeeded(done.intentId))).toMatchObject({ outcome: "ignored", refundPaymentIds: [] });
    expect(paymentRow(done.id).status).toBe("refunded");
  });
});

describe("atomicity", () => {
  it("rolls the event row back if applying it fails, so a retry is processed rather than treated as a duplicate", () => {
    const orderId = makeOrder();
    const payment = makePayment(orderId);
    const event = succeeded(payment.intentId, { id: "evt_boom" });
    // Paying commits stock, which throws when the inventory row is missing.
    sqlite.exec("PRAGMA foreign_keys = OFF; DELETE FROM inventory; PRAGMA foreign_keys = ON;");

    expect(() => apply(event)).toThrow(/No inventory row/);

    expect(storedEvent("evt_boom")).toBeUndefined();
    expect(orderRow(orderId).status).toBe("pending_payment");
    expect(paymentRow(payment.id).status).toBe("pending");
    expect(orderEventsOf(orderId)).toEqual([]);

    db.insert(schema.inventory).values({ productSlug: "a", onHand: 10, reserved: 2 }).run();
    expect(apply(event)).toMatchObject({ status: "processed", outcome: "applied" });
    expect(orderRow(orderId).status).toBe("paid");
  });

  it("does not leave a half-paid state: order, stock and payment move together", () => {
    const orderId = makeOrder();
    const payment = makePayment(orderId);
    apply(succeeded(payment.intentId));

    expect(orderRow(orderId).status).toBe("paid");
    expect(paymentRow(payment.id).status).toBe("succeeded");
    expect(stock()).toEqual({ onHand: 8, reserved: 0 });
  });
});
