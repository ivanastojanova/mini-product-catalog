import { beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "../../db/schema.js";
import { getOrderDto } from "./orderDto.js";

const sqlite = new Database(":memory:");
sqlite.pragma("foreign_keys = ON");
const db = drizzle(sqlite, { schema });
migrate(db, { migrationsFolder: "./src/db/migrations" });

let counter = 0;

function makeOrder() {
  counter += 1;
  const [order] = db
    .insert(schema.orders)
    .values({
      publicId: `pub-${counter}`,
      guestTokenHash: `g-${counter}`,
      contactEmail: "g@example.com",
      currency: "EUR",
      totalCents: 1000,
      shipName: "Ada",
      shipLine1: "1 Main St",
      shipCity: "Berlin",
      shipPostalCode: "10115",
      shipCountry: "DE",
      idempotencyKey: `k-${counter}`,
      reservationExpiresAt: new Date(Date.now() + 60_000),
    })
    .returning()
    .all();
  return order.id;
}

function addPayment(orderId: number, status: (typeof schema.PAYMENT_STATUS_VALUES)[number]) {
  counter += 1;
  db.insert(schema.payments)
    .values({ orderId, gatewayIntentId: `pi_secret_${counter}`, amountCents: 1000, currency: "EUR", status, refundId: status === "refunded" ? "re_secret" : null })
    .run();
}

beforeEach(() => {
  sqlite.exec("DELETE FROM payments; DELETE FROM order_items; DELETE FROM orders;");
});

describe("order DTO payment field", () => {
  it("is null before any payment was started", () => {
    expect(getOrderDto(db, makeOrder()).payment).toBeNull();
  });

  it.each([
    ["pending", "pending"],
    ["failed", "failed"],
    ["succeeded", "succeeded"],
    ["refund_pending", "refunding"],
    ["refunded", "refunded"],
  ] as const)("maps a %s payment to %s", (stored, shown) => {
    const orderId = makeOrder();
    addPayment(orderId, stored);
    expect(getOrderDto(db, orderId).payment).toEqual({ status: shown });
  });

  it("reflects the MOST RECENT attempt", () => {
    const orderId = makeOrder();
    addPayment(orderId, "failed");
    addPayment(orderId, "pending");
    expect(getOrderDto(db, orderId).payment).toEqual({ status: "pending" });
  });

  it("only looks at its own order's payments", () => {
    const mine = makeOrder();
    const other = makeOrder();
    addPayment(other, "succeeded");
    expect(getOrderDto(db, mine).payment).toBeNull();
  });

  it("leaks no intent id, refund id or gateway data", () => {
    const orderId = makeOrder();
    addPayment(orderId, "refunded");
    const json = JSON.stringify(getOrderDto(db, orderId));
    expect(json).not.toContain("pi_secret");
    expect(json).not.toContain("re_secret");
    expect(json).not.toMatch(/intent|refundId|gateway/i);
  });
});
