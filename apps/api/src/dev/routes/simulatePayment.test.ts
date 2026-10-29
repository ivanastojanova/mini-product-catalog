import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import * as schema from "../../db/schema.js";
import { generateSessionToken, hashSessionToken } from "../../auth/lib/session.js";

const sqlite = new Database(":memory:");
sqlite.pragma("foreign_keys = ON");
const testDb = drizzle(sqlite, { schema });
migrate(testDb, { migrationsFolder: "./src/db/migrations" });

vi.mock("../../db/client.js", () => ({ db: testDb }));

const { registerSimulatePaymentRoute } = await import("./simulatePayment.js");
const { applyTransition } = await import("../../orders/lib/applyTransition.js");
const { reserveStock } = await import("../../inventory/lib/inventoryRepo.js");

async function buildApp() {
  const app = Fastify();
  await app.register(cookie);
  registerSimulatePaymentRoute(app);
  await app.ready();
  return app;
}

let counter = 0;

function makeCustomer() {
  counter += 1;
  const [row] = testDb
    .insert(schema.customers)
    .values({ email: `c${counter}@example.com`, passwordHash: "x", name: "C" })
    .returning()
    .all();
  const sessionToken = generateSessionToken();
  testDb
    .insert(schema.sessions)
    .values({ id: hashSessionToken(sessionToken), customerId: row.id, expiresAt: new Date(Date.now() + 60_000) })
    .run();
  return { id: row.id, sessionToken };
}

function makeOrder(
  owner: { customerId: number } | { guestToken: string },
  opts: { quantity?: number; expiresAt?: Date } = {},
) {
  counter += 1;
  const { quantity = 3, expiresAt = new Date(Date.now() + 15 * 60_000) } = opts;
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
    })
    .returning()
    .all();
  testDb
    .insert(schema.orderItems)
    .values({ orderId: order.id, productSlug: "lamp", title: "Lamp", unitPriceCents: 500, quantity })
    .run();
  reserveStock(testDb, [{ slug: "lamp", quantity }]);
  return { id: order.id, publicId: order.publicId };
}

const stock = () => {
  const r = testDb.select().from(schema.inventory).where(eq(schema.inventory.productSlug, "lamp")).get();
  return r && { onHand: r.onHand, reserved: r.reserved };
};
const statusOf = (id: number) => testDb.select().from(schema.orders).where(eq(schema.orders.id, id)).get()!.status;
const pay = (app: Awaited<ReturnType<typeof buildApp>>, publicId: string, cookies: Record<string, string> = {}) =>
  app.inject({ method: "POST", url: `/dev/orders/${publicId}/simulate-payment`, cookies });

beforeEach(() => {
  sqlite.exec(
    "DELETE FROM order_events; DELETE FROM order_items; DELETE FROM orders; DELETE FROM inventory; DELETE FROM sessions; DELETE FROM customers;",
  );
  testDb.insert(schema.inventory).values({ productSlug: "lamp", onHand: 20 }).run();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(() => {
  sqlite.close();
});

describe("POST /dev/orders/:publicId/simulate-payment", () => {
  it("marks the owner's order paid, commits the stock and stamps paidAt", async () => {
    const cora = makeCustomer();
    const order = makeOrder({ customerId: cora.id });
    expect(stock()).toEqual({ onHand: 20, reserved: 3 });
    const app = await buildApp();

    const res = await pay(app, order.publicId, { session: cora.sessionToken });

    expect(res.statusCode).toBe(200);
    expect(res.json().order.status).toBe("paid");
    expect(res.json().order.paidAt).not.toBeNull();
    expect(stock()).toEqual({ onHand: 17, reserved: 0 });
    await app.close();
  });

  it("works for a guest with the matching cookie", async () => {
    const token = generateSessionToken();
    const order = makeOrder({ guestToken: token });
    const app = await buildApp();
    const res = await pay(app, order.publicId, { order_token: token });
    expect(res.statusCode).toBe(200);
    expect(statusOf(order.id)).toBe("paid");
    await app.close();
  });

  it("paying twice commits the stock once", async () => {
    const cora = makeCustomer();
    const order = makeOrder({ customerId: cora.id });
    const app = await buildApp();

    const first = await pay(app, order.publicId, { session: cora.sessionToken });
    const second = await pay(app, order.publicId, { session: cora.sessionToken });

    expect([first.statusCode, second.statusCode]).toEqual([200, 200]);
    expect(stock()).toEqual({ onHand: 17, reserved: 0 });
    expect(testDb.select().from(schema.orderEvents).all()).toHaveLength(1);
    await app.close();
  });

  it("writes an audit event that says the payment was simulated", async () => {
    const cora = makeCustomer();
    const order = makeOrder({ customerId: cora.id });
    const app = await buildApp();
    await pay(app, order.publicId, { session: cora.sessionToken });
    const events = testDb.select().from(schema.orderEvents).all();
    expect(events.map((e) => [e.fromStatus, e.toStatus, e.reason])).toEqual([
      ["pending_payment", "paid", "simulated payment (dev)"],
    ]);
    await app.close();
  });

  it("a stranger can't pay someone else's order: 404, nothing changes", async () => {
    const cora = makeCustomer();
    const order = makeOrder({ customerId: cora.id });
    const mallory = makeCustomer();
    const app = await buildApp();

    const asOther = await pay(app, order.publicId, { session: mallory.sessionToken });
    const asAnonymous = await pay(app, order.publicId);
    const asWrongGuest = await pay(app, order.publicId, { order_token: generateSessionToken() });
    const missing = await pay(app, "does-not-exist", { session: cora.sessionToken });

    expect([asOther, asAnonymous, asWrongGuest, missing].map((r) => r.statusCode)).toEqual([404, 404, 404, 404]);
    expect(statusOf(order.id)).toBe("pending_payment");
    expect(stock()).toEqual({ onHand: 20, reserved: 3 });
    await app.close();
  });

  it("refuses an order whose hold already lapsed (409) and frees its stock instead of selling it", async () => {
    const cora = makeCustomer();
    const order = makeOrder({ customerId: cora.id }, { expiresAt: new Date(Date.now() - 60_000) });
    const app = await buildApp();

    const res = await pay(app, order.publicId, { session: cora.sessionToken });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: "not_payable", order: { status: "expired" } });
    expect(statusOf(order.id)).toBe("expired");
    expect(stock()).toEqual({ onHand: 20, reserved: 0 });
    await app.close();
  });

  it("refuses a cancelled order (409)", async () => {
    const cora = makeCustomer();
    const order = makeOrder({ customerId: cora.id });
    applyTransition(testDb, order.id, "cancel");
    const app = await buildApp();

    const res = await pay(app, order.publicId, { session: cora.sessionToken });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("not_payable");
    expect(statusOf(order.id)).toBe("cancelled");
    expect(stock()).toEqual({ onHand: 20, reserved: 0 });
    await app.close();
  });

  it("a fulfilled order is not 'paid again': 409, status unchanged", async () => {
    const cora = makeCustomer();
    const order = makeOrder({ customerId: cora.id });
    applyTransition(testDb, order.id, "pay");
    applyTransition(testDb, order.id, "fulfil");
    const app = await buildApp();

    const res = await pay(app, order.publicId, { session: cora.sessionToken });

    expect(res.statusCode).toBe(409);
    expect(statusOf(order.id)).toBe("fulfilled");
    await app.close();
  });
});

describe("production", () => {
  it("does not register the route at all when NODE_ENV is production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const cora = makeCustomer();
    const order = makeOrder({ customerId: cora.id });
    const app = await buildApp();

    const res = await pay(app, order.publicId, { session: cora.sessionToken });

    expect(res.statusCode).toBe(404);
    expect(res.json().message).toMatch(/not found/i);
    expect(statusOf(order.id)).toBe("pending_payment");
    expect(stock()).toEqual({ onHand: 20, reserved: 3 });
    await app.close();
  });

  it.each(["development", "test", ""])("is registered when NODE_ENV is %j", async (env) => {
    vi.stubEnv("NODE_ENV", env);
    const cora = makeCustomer();
    const order = makeOrder({ customerId: cora.id });
    const app = await buildApp();
    const res = await pay(app, order.publicId, { session: cora.sessionToken });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});
