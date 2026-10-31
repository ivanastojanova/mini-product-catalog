import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import * as schema from "../../db/schema.js";
import { corsOptions } from "../../corsConfig.js";
import { generateSessionToken, hashSessionToken } from "../../auth/lib/session.js";

const sqlite = new Database(":memory:");
sqlite.pragma("foreign_keys = ON");
const testDb = drizzle(sqlite, { schema });
migrate(testDb, { migrationsFolder: "./src/db/migrations" });

vi.mock("../../db/client.js", () => ({ db: testDb }));

const { registerOrderRoutes } = await import("./orders.js");
const { applyTransition } = await import("../lib/applyTransition.js");
const { reserveStock } = await import("../../inventory/lib/inventoryRepo.js");

async function buildApp(withCors = false) {
  const app = Fastify();
  if (withCors) await app.register(cors, corsOptions);
  await app.register(cookie);
  registerOrderRoutes(app);
  await app.ready();
  return app;
}

let counter = 0;

function makeCustomer(name = "Cora") {
  counter += 1;
  const [row] = testDb
    .insert(schema.customers)
    .values({ email: `c${counter}@example.com`, passwordHash: "x", name })
    .returning()
    .all();
  const sessionToken = generateSessionToken();
  testDb
    .insert(schema.sessions)
    .values({ id: hashSessionToken(sessionToken), customerId: row.id, expiresAt: new Date(Date.now() + 60_000) })
    .run();
  return { id: row.id, sessionToken };
}

/** Creates an order the way createOrder would have: row, lines, held stock. */
function makeOrder(
  owner: { customerId: number } | { guestToken: string },
  opts: { lines?: Array<[string, number]>; status?: string; createdAt?: Date; expiresAt?: Date } = {},
) {
  counter += 1;
  const { lines = [["lamp", 2]], createdAt = new Date(), expiresAt = new Date(Date.now() + 15 * 60_000) } = opts;
  const [order] = testDb
    .insert(schema.orders)
    .values({
      publicId: `pub-${counter}-${"x".repeat(14)}`,
      customerId: "customerId" in owner ? owner.customerId : null,
      guestTokenHash: "guestToken" in owner ? hashSessionToken(owner.guestToken) : null,
      contactEmail: "buyer@example.com",
      currency: "EUR",
      totalCents: 1000,
      shipName: "Ada",
      shipLine1: "1 Main St",
      shipCity: "Berlin",
      shipPostalCode: "10115",
      shipCountry: "DE",
      idempotencyKey: `idem-${counter}`,
      reservationExpiresAt: expiresAt,
      createdAt,
    })
    .returning()
    .all();
  for (const [productSlug, quantity] of lines) {
    testDb
      .insert(schema.orderItems)
      .values({ orderId: order.id, productSlug, title: `Title ${productSlug}`, unitPriceCents: 500, quantity })
      .run();
  }
  const held = reserveStock(testDb, lines.map(([slug, quantity]) => ({ slug, quantity })));
  if (!held.ok) throw new Error("test setup: not enough stock");
  if (opts.status && opts.status !== "pending_payment") {
    if (opts.status === "paid") applyTransition(testDb, order.id, "pay");
    else if (opts.status === "fulfilled") {
      applyTransition(testDb, order.id, "pay");
      applyTransition(testDb, order.id, "fulfil");
    } else if (opts.status === "cancelled") applyTransition(testDb, order.id, "cancel");
    else if (opts.status === "expired") applyTransition(testDb, order.id, "expire");
  }
  return { id: order.id, publicId: order.publicId };
}

const stock = (slug: string) => {
  const r = testDb.select().from(schema.inventory).where(eq(schema.inventory.productSlug, slug)).get();
  return r && { onHand: r.onHand, reserved: r.reserved };
};
const statusOf = (id: number) => testDb.select().from(schema.orders).where(eq(schema.orders.id, id)).get()!.status;
const cookieOf = (res: { cookies: Array<{ name: string; value: string }> }, name: string) =>
  res.cookies.find((c) => c.name === name);

beforeEach(() => {
  sqlite.exec(
    "DELETE FROM order_events; DELETE FROM order_items; DELETE FROM orders; DELETE FROM inventory; DELETE FROM sessions; DELETE FROM customers;",
  );
  testDb.insert(schema.inventory).values([{ productSlug: "lamp", onHand: 20 }, { productSlug: "chair", onHand: 20 }]).run();
});

afterAll(() => {
  sqlite.close();
});

describe("GET /orders/:publicId - who may see an order", () => {
  it("a customer sees their own order", async () => {
    const cora = makeCustomer();
    const order = makeOrder({ customerId: cora.id });
    const app = await buildApp();

    const res = await app.inject({ method: "GET", url: `/orders/${order.publicId}`, cookies: { session: cora.sessionToken } });

    expect(res.statusCode).toBe(200);
    expect(res.json().order).toMatchObject({
      publicId: order.publicId,
      status: "pending_payment",
      items: [{ slug: "lamp", title: "Title lamp", unitPriceCents: 500, quantity: 2, lineTotalCents: 1000 }],
      shippingAddress: { name: "Ada", country: "DE" },
    });
    await app.close();
  });

  it("customer A can't see customer B's order: 404, indistinguishable from a missing order", async () => {
    const a = makeCustomer("A");
    const b = makeCustomer("B");
    const bOrder = makeOrder({ customerId: b.id });
    const app = await buildApp();

    const notYours = await app.inject({ method: "GET", url: `/orders/${bOrder.publicId}`, cookies: { session: a.sessionToken } });
    const missing = await app.inject({ method: "GET", url: "/orders/does-not-exist", cookies: { session: a.sessionToken } });

    expect(notYours.statusCode).toBe(404);
    expect(notYours.body).toBe(missing.body);
    expect(notYours.body).not.toContain("buyer@example.com");
    await app.close();
  });

  it("a guest sees their order with the matching order_token cookie", async () => {
    const token = generateSessionToken();
    const order = makeOrder({ guestToken: token });
    const app = await buildApp();

    const res = await app.inject({ method: "GET", url: `/orders/${order.publicId}`, cookies: { order_token: token } });

    expect(res.statusCode).toBe(200);
    expect(res.json().order.publicId).toBe(order.publicId);
    await app.close();
  });

  it("the public id alone is not enough for a guest order: no cookie is a 404", async () => {
    const order = makeOrder({ guestToken: generateSessionToken() });
    const app = await buildApp();

    const res = await app.inject({ method: "GET", url: `/orders/${order.publicId}` });

    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("another guest's cookie gets a 404", async () => {
    const order = makeOrder({ guestToken: generateSessionToken() });
    const app = await buildApp();

    const res = await app.inject({
      method: "GET", url: `/orders/${order.publicId}`, cookies: { order_token: generateSessionToken() },
    });

    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("a logged-in customer can't open a guest order, even holding that guest's cookie (session wins)", async () => {
    const token = generateSessionToken();
    const order = makeOrder({ guestToken: token });
    const cora = makeCustomer();
    const app = await buildApp();

    const res = await app.inject({
      method: "GET", url: `/orders/${order.publicId}`, cookies: { session: cora.sessionToken, order_token: token },
    });

    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("a guest cookie can't open a customer's order", async () => {
    const cora = makeCustomer();
    const order = makeOrder({ customerId: cora.id });
    const app = await buildApp();

    const res = await app.inject({
      method: "GET", url: `/orders/${order.publicId}`, cookies: { order_token: generateSessionToken() },
    });

    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("an expired session is treated as logged out", async () => {
    const cora = makeCustomer();
    const order = makeOrder({ customerId: cora.id });
    testDb.update(schema.sessions).set({ expiresAt: new Date(Date.now() - 1000) }).run();
    const app = await buildApp();

    const res = await app.inject({ method: "GET", url: `/orders/${order.publicId}`, cookies: { session: cora.sessionToken } });

    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("a stranger with neither cookie gets a 404 and nothing is set", async () => {
    const order = makeOrder({ guestToken: generateSessionToken() });
    const app = await buildApp();

    const res = await app.inject({ method: "GET", url: `/orders/${order.publicId}` });

    expect(res.statusCode).toBe(404);
    expect(res.headers["set-cookie"]).toBeUndefined();
    await app.close();
  });

  it("refreshes a guest's order_token cookie when they view their order, but sets none for customers", async () => {
    const token = generateSessionToken();
    const guestOrder = makeOrder({ guestToken: token });
    const cora = makeCustomer();
    const customerOrder = makeOrder({ customerId: cora.id });
    const app = await buildApp();

    const guest = await app.inject({ method: "GET", url: `/orders/${guestOrder.publicId}`, cookies: { order_token: token } });
    const customer = await app.inject({
      method: "GET", url: `/orders/${customerOrder.publicId}`, cookies: { session: cora.sessionToken },
    });

    expect(cookieOf(guest, "order_token")?.value).toBe(token);
    expect(guest.headers["set-cookie"]).toEqual(expect.stringContaining("HttpOnly"));
    expect(customer.headers["set-cookie"]).toBeUndefined();
    await app.close();
  });

  it("never exposes internal ids, owner columns or the idempotency key", async () => {
    const cora = makeCustomer();
    const order = makeOrder({ customerId: cora.id });
    const app = await buildApp();

    const res = await app.inject({ method: "GET", url: `/orders/${order.publicId}`, cookies: { session: cora.sessionToken } });

    expect(Object.keys(res.json().order).sort()).toEqual(
      ["contactEmail", "createdAt", "currency", "items", "paidAt", "payment", "publicId", "reservationExpiresAt", "shippingAddress", "status", "totalCents"].sort(),
    );
    await app.close();
  });

  it("is never cached", async () => {
    const cora = makeCustomer();
    const order = makeOrder({ customerId: cora.id });
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: `/orders/${order.publicId}`, cookies: { session: cora.sessionToken } });
    expect(res.headers["cache-control"]).toBe("no-store");
    await app.close();
  });

  it("shows an unpaid order as expired once its deadline passed (the read sweeps first)", async () => {
    const cora = makeCustomer();
    const order = makeOrder({ customerId: cora.id }, { expiresAt: new Date(Date.now() - 60_000) });
    expect(stock("lamp")).toEqual({ onHand: 20, reserved: 2 });
    const app = await buildApp();

    const res = await app.inject({ method: "GET", url: `/orders/${order.publicId}`, cookies: { session: cora.sessionToken } });

    expect(res.json().order.status).toBe("expired");
    expect(stock("lamp")).toEqual({ onHand: 20, reserved: 0 });
    await app.close();
  });
});

describe("GET /orders - history", () => {
  it("is 401 without a session", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/orders" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("is 401 for a guest, even one with orders", async () => {
    const token = generateSessionToken();
    makeOrder({ guestToken: token });
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/orders", cookies: { order_token: token } });
    expect(res.statusCode).toBe(401);
    expect(res.body).not.toContain("buyer@example.com");
    await app.close();
  });

  it("is 401 for an expired session", async () => {
    const cora = makeCustomer();
    testDb.update(schema.sessions).set({ expiresAt: new Date(Date.now() - 1000) }).run();
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/orders", cookies: { session: cora.sessionToken } });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("lists only the customer's own orders, newest first", async () => {
    const cora = makeCustomer("Cora");
    const other = makeCustomer("Other");
    const old = makeOrder({ customerId: cora.id }, { lines: [["lamp", 1]], status: "cancelled", createdAt: new Date("2030-01-01T10:00:00Z") });
    const recent = makeOrder({ customerId: cora.id }, { lines: [["chair", 1]], createdAt: new Date("2030-01-02T10:00:00Z") });
    makeOrder({ customerId: other.id }, { lines: [["lamp", 3]] });
    makeOrder({ guestToken: generateSessionToken() }, { lines: [["lamp", 1]] });
    const app = await buildApp();

    const res = await app.inject({ method: "GET", url: "/orders", cookies: { session: cora.sessionToken } });

    expect(res.statusCode).toBe(200);
    expect(res.json().orders.map((o: { publicId: string }) => o.publicId)).toEqual([recent.publicId, old.publicId]);
    expect(res.json().orders[0].items).toHaveLength(1);
    await app.close();
  });

  it("returns an empty list for a customer with no orders", async () => {
    const cora = makeCustomer();
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/orders", cookies: { session: cora.sessionToken } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ orders: [] });
    await app.close();
  });

  it("does not list a guest order placed before logging in (known gap: no attaching)", async () => {
    const token = generateSessionToken();
    makeOrder({ guestToken: token });
    const cora = makeCustomer();
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/orders", cookies: { session: cora.sessionToken, order_token: token },
    });
    expect(res.json()).toEqual({ orders: [] });
    await app.close();
  });

  it("is never cached", async () => {
    const cora = makeCustomer();
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/orders", cookies: { session: cora.sessionToken } });
    expect(res.headers["cache-control"]).toBe("no-store");
    await app.close();
  });
});

describe("POST /orders/:publicId/cancel", () => {
  it("cancels the owner's unpaid order and releases the stock", async () => {
    const cora = makeCustomer();
    const order = makeOrder({ customerId: cora.id }, { lines: [["lamp", 3]] });
    expect(stock("lamp")).toEqual({ onHand: 20, reserved: 3 });
    const app = await buildApp();

    const res = await app.inject({ method: "POST", url: `/orders/${order.publicId}/cancel`, cookies: { session: cora.sessionToken } });

    expect(res.statusCode).toBe(200);
    expect(res.json().order.status).toBe("cancelled");
    expect(statusOf(order.id)).toBe("cancelled");
    expect(stock("lamp")).toEqual({ onHand: 20, reserved: 0 });
    await app.close();
  });

  it("works for a guest with the matching cookie", async () => {
    const token = generateSessionToken();
    const order = makeOrder({ guestToken: token });
    const app = await buildApp();

    const res = await app.inject({ method: "POST", url: `/orders/${order.publicId}/cancel`, cookies: { order_token: token } });

    expect(res.statusCode).toBe(200);
    expect(statusOf(order.id)).toBe("cancelled");
    expect(stock("lamp")).toEqual({ onHand: 20, reserved: 0 });
    await app.close();
  });

  it("is idempotent: cancelling twice releases once", async () => {
    const cora = makeCustomer();
    const mine = makeOrder({ customerId: cora.id }, { lines: [["lamp", 3]] });
    const other = makeCustomer("O");
    makeOrder({ customerId: other.id }, { lines: [["lamp", 4]] });
    const app = await buildApp();

    const first = await app.inject({ method: "POST", url: `/orders/${mine.publicId}/cancel`, cookies: { session: cora.sessionToken } });
    const second = await app.inject({ method: "POST", url: `/orders/${mine.publicId}/cancel`, cookies: { session: cora.sessionToken } });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json().order.status).toBe("cancelled");
    expect(stock("lamp")).toEqual({ onHand: 20, reserved: 4 });
    await app.close();
  });

  it("a stranger can't cancel: 404 and the order and its stock are untouched", async () => {
    const cora = makeCustomer();
    const order = makeOrder({ customerId: cora.id }, { lines: [["lamp", 3]] });
    const mallory = makeCustomer("Mallory");
    const app = await buildApp();

    const asOtherCustomer = await app.inject({ method: "POST", url: `/orders/${order.publicId}/cancel`, cookies: { session: mallory.sessionToken } });
    const asAnonymous = await app.inject({ method: "POST", url: `/orders/${order.publicId}/cancel` });
    const asWrongGuest = await app.inject({ method: "POST", url: `/orders/${order.publicId}/cancel`, cookies: { order_token: generateSessionToken() } });

    expect([asOtherCustomer.statusCode, asAnonymous.statusCode, asWrongGuest.statusCode]).toEqual([404, 404, 404]);
    expect(statusOf(order.id)).toBe("pending_payment");
    expect(stock("lamp")).toEqual({ onHand: 20, reserved: 3 });
    await app.close();
  });

  it("a guest order can't be cancelled by its public id alone", async () => {
    const order = makeOrder({ guestToken: generateSessionToken() });
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: `/orders/${order.publicId}/cancel` });
    expect(res.statusCode).toBe(404);
    expect(statusOf(order.id)).toBe("pending_payment");
    await app.close();
  });

  it.each(["paid", "fulfilled"] as const)("refuses to cancel a %s order (409) and leaves stock alone", async (status) => {
    const cora = makeCustomer();
    const order = makeOrder({ customerId: cora.id }, { lines: [["lamp", 3]], status });
    const stockBefore = stock("lamp");
    const app = await buildApp();

    const res = await app.inject({ method: "POST", url: `/orders/${order.publicId}/cancel`, cookies: { session: cora.sessionToken } });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: "not_cancellable", order: { status } });
    expect(statusOf(order.id)).toBe(status);
    expect(stock("lamp")).toEqual(stockBefore);
    await app.close();
  });

  it("refuses to cancel an order that already expired (409)", async () => {
    const cora = makeCustomer();
    const order = makeOrder({ customerId: cora.id }, { status: "expired" });
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: `/orders/${order.publicId}/cancel`, cookies: { session: cora.sessionToken } });
    expect(res.statusCode).toBe(409);
    expect(statusOf(order.id)).toBe("expired");
    await app.close();
  });

  it("an unpaid order past its deadline is expired by the sweep, so cancelling it is a 409 (stock released once)", async () => {
    const cora = makeCustomer();
    const order = makeOrder({ customerId: cora.id }, { lines: [["lamp", 3]], expiresAt: new Date(Date.now() - 60_000) });
    const app = await buildApp();

    const res = await app.inject({ method: "POST", url: `/orders/${order.publicId}/cancel`, cookies: { session: cora.sessionToken } });

    expect(res.statusCode).toBe(409);
    expect(statusOf(order.id)).toBe("expired");
    expect(stock("lamp")).toEqual({ onHand: 20, reserved: 0 });
    await app.close();
  });

  it("writes the audit event with a reason", async () => {
    const cora = makeCustomer();
    const order = makeOrder({ customerId: cora.id });
    const app = await buildApp();
    await app.inject({ method: "POST", url: `/orders/${order.publicId}/cancel`, cookies: { session: cora.sessionToken } });
    const events = testDb.select().from(schema.orderEvents).where(eq(schema.orderEvents.orderId, order.id)).all();
    expect(events.map((e) => [e.fromStatus, e.toStatus, e.reason])).toEqual([
      ["pending_payment", "cancelled", "cancelled by shopper"],
    ]);
    await app.close();
  });

  it("is reachable cross-origin: POST with credentials passes the preflight and sends the order_token", async () => {
    const app = await buildApp(true);
    const res = await app.inject({
      method: "OPTIONS", url: "/orders/abc/cancel",
      headers: { origin: "http://localhost:3000", "access-control-request-method": "POST" },
    });
    expect(res.statusCode).toBeLessThan(300);
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
    await app.close();
  });
});
