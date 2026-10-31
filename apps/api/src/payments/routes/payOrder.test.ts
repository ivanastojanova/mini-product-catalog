import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import * as schema from "../../db/schema.js";
import { generateSessionToken, hashSessionToken } from "../../auth/lib/session.js";
import type { PaymentGateway } from "../lib/gatewayClient.js";

const sqlite = new Database(":memory:");
sqlite.pragma("foreign_keys = ON");
const testDb = drizzle(sqlite, { schema });
migrate(testDb, { migrationsFolder: "./src/db/migrations" });

vi.mock("../../db/client.js", () => ({ db: testDb }));

const { registerPayOrderRoute } = await import("./payOrder.js");
const { applyTransition } = await import("../../orders/lib/applyTransition.js");
const { reserveStock } = await import("../../inventory/lib/inventoryRepo.js");

const PUBLIC = "http://localhost:4100";

function fakeGateway(overrides: Partial<PaymentGateway> = {}) {
  let n = 0;
  const createPaymentIntent = vi.fn<PaymentGateway["createPaymentIntent"]>(async () => {
    n += 1;
    return { id: `pi_fake${n}` };
  });
  const gateway: PaymentGateway = {
    createPaymentIntent,
    refund: vi.fn(async () => ({ id: "re_1" })),
    ...overrides,
  };
  return { gateway, createPaymentIntent };
}

async function buildApp(gateway: PaymentGateway) {
  const app = Fastify();
  await app.register(cookie);
  registerPayOrderRoute(app, {
    gateway,
    getGatewayPublicUrl: () => PUBLIC,
    webOrigin: "http://localhost:3000",
  });
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
  opts: { status?: "paid" | "cancelled" | "expired"; expiresAt?: Date; totalCents?: number } = {},
) {
  counter += 1;
  const [order] = testDb
    .insert(schema.orders)
    .values({
      publicId: `pub-${counter}-${"x".repeat(14)}`,
      customerId: "customerId" in owner ? owner.customerId : null,
      guestTokenHash: "guestToken" in owner ? hashSessionToken(owner.guestToken) : null,
      contactEmail: "buyer@example.com",
      currency: "EUR",
      totalCents: opts.totalCents ?? 1000,
      shipName: "Ada",
      shipLine1: "1 Main St",
      shipCity: "Berlin",
      shipPostalCode: "10115",
      shipCountry: "DE",
      idempotencyKey: `idem-${counter}`,
      reservationExpiresAt: opts.expiresAt ?? new Date(Date.now() + 15 * 60_000),
    })
    .returning()
    .all();
  testDb
    .insert(schema.orderItems)
    .values({ orderId: order.id, productSlug: "lamp", title: "Lamp", unitPriceCents: 500, quantity: 2 })
    .run();
  const held = reserveStock(testDb, [{ slug: "lamp", quantity: 2 }]);
  if (!held.ok) throw new Error("test setup: not enough stock");
  if (opts.status === "paid") applyTransition(testDb, order.id, "pay");
  if (opts.status === "cancelled") applyTransition(testDb, order.id, "cancel");
  if (opts.status === "expired") applyTransition(testDb, order.id, "expire");
  return { id: order.id, publicId: order.publicId };
}

const paymentsOf = (orderId: number) =>
  testDb.select().from(schema.payments).where(eq(schema.payments.orderId, orderId)).orderBy(schema.payments.id).all();
const statusOf = (id: number) => testDb.select().from(schema.orders).where(eq(schema.orders.id, id)).get()!.status;

beforeEach(() => {
  sqlite.exec(
    "DELETE FROM payment_events; DELETE FROM payments; DELETE FROM order_events; DELETE FROM order_items; DELETE FROM orders; DELETE FROM inventory; DELETE FROM sessions; DELETE FROM customers;",
  );
  testDb.insert(schema.inventory).values({ productSlug: "lamp", onHand: 20 }).run();
});

afterAll(() => {
  sqlite.close();
});

const pay = (app: Awaited<ReturnType<typeof buildApp>>, publicId: string, cookies: Record<string, string>, query = "") =>
  app.inject({ method: "POST", url: `/orders/${publicId}/pay${query}`, cookies });

describe("POST /orders/:publicId/pay", () => {
  it("starts a payment: a pending row, a gateway intent from the ORDER's amount, and the pay URL", async () => {
    const cora = makeCustomer();
    const order = makeOrder({ customerId: cora.id }, { totalCents: 4200 });
    const { gateway, createPaymentIntent } = fakeGateway();
    const app = await buildApp(gateway);

    const res = await pay(app, order.publicId, { session: cora.sessionToken });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ payUrl: `${PUBLIC}/pay/pi_fake1` });
    expect(res.headers["cache-control"]).toBe("no-store");

    expect(createPaymentIntent).toHaveBeenCalledTimes(1);
    expect(createPaymentIntent.mock.calls[0][0]).toMatchObject({
      amountCents: 4200,
      currency: "EUR",
      orderId: order.publicId,
      returnUrl: `http://localhost:3000/en/orders/${order.publicId}`,
    });

    expect(paymentsOf(order.id)).toMatchObject([
      { status: "pending", gatewayIntentId: "pi_fake1", amountCents: 4200, currency: "EUR" },
    ]);
    expect(statusOf(order.id)).toBe("pending_payment");
    await app.close();
  });

  it("never takes the amount from the request", async () => {
    const cora = makeCustomer();
    const order = makeOrder({ customerId: cora.id }, { totalCents: 1000 });
    const { gateway, createPaymentIntent } = fakeGateway();
    const app = await buildApp(gateway);

    await app.inject({
      method: "POST",
      url: `/orders/${order.publicId}/pay?amountCents=1&currency=USD`,
      cookies: { session: cora.sessionToken },
    });

    expect(createPaymentIntent.mock.calls[0][0]).toMatchObject({ amountCents: 1000, currency: "EUR" });
    await app.close();
  });

  it("works for a guest holding the order cookie", async () => {
    const token = generateSessionToken();
    const order = makeOrder({ guestToken: token });
    const app = await buildApp(fakeGateway().gateway);

    const res = await pay(app, order.publicId, { order_token: token });

    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it("returns to the shopper's language", async () => {
    const cora = makeCustomer();
    const order = makeOrder({ customerId: cora.id });
    const { gateway, createPaymentIntent } = fakeGateway();
    const app = await buildApp(gateway);

    await pay(app, order.publicId, { session: cora.sessionToken }, "?lang=de");

    expect(createPaymentIntent.mock.calls[0][0].returnUrl).toBe(`http://localhost:3000/de/orders/${order.publicId}`);
    await app.close();
  });

  it.each(["fr", "../evil", "en/../../x", "", "DE"])("falls back to en for lang=%j", async (lang) => {
    const cora = makeCustomer();
    const order = makeOrder({ customerId: cora.id });
    const { gateway, createPaymentIntent } = fakeGateway();
    const app = await buildApp(gateway);

    await pay(app, order.publicId, { session: cora.sessionToken }, `?lang=${encodeURIComponent(lang)}`);

    expect(createPaymentIntent.mock.calls[0][0].returnUrl).toBe(`http://localhost:3000/en/orders/${order.publicId}`);
    await app.close();
  });

  it("a second press reuses the pending attempt: same pay URL, one row, one gateway call", async () => {
    const cora = makeCustomer();
    const order = makeOrder({ customerId: cora.id });
    const { gateway, createPaymentIntent } = fakeGateway();
    const app = await buildApp(gateway);

    const first = await pay(app, order.publicId, { session: cora.sessionToken });
    const second = await pay(app, order.publicId, { session: cora.sessionToken });

    expect(second.json()).toEqual(first.json());
    expect(createPaymentIntent).toHaveBeenCalledTimes(1);
    expect(paymentsOf(order.id)).toHaveLength(1);
    await app.close();
  });

  it("after a decline, pressing Pay starts a fresh attempt", async () => {
    const cora = makeCustomer();
    const order = makeOrder({ customerId: cora.id });
    const { gateway, createPaymentIntent } = fakeGateway();
    const app = await buildApp(gateway);

    await pay(app, order.publicId, { session: cora.sessionToken });
    testDb.update(schema.payments).set({ status: "failed" }).where(eq(schema.payments.orderId, order.id)).run();
    const again = await pay(app, order.publicId, { session: cora.sessionToken });

    expect(again.json()).toEqual({ payUrl: `${PUBLIC}/pay/pi_fake2` });
    expect(createPaymentIntent).toHaveBeenCalledTimes(2);
    expect(paymentsOf(order.id).map((p) => p.status)).toEqual(["failed", "pending"]);
    await app.close();
  });

  it("uses a different gateway idempotency key for each attempt", async () => {
    const cora = makeCustomer();
    const order = makeOrder({ customerId: cora.id });
    const { gateway, createPaymentIntent } = fakeGateway();
    const app = await buildApp(gateway);

    await pay(app, order.publicId, { session: cora.sessionToken });
    testDb.update(schema.payments).set({ status: "failed" }).where(eq(schema.payments.orderId, order.id)).run();
    await pay(app, order.publicId, { session: cora.sessionToken });

    const [a, b] = createPaymentIntent.mock.calls.map(([input]) => input.idempotencyKey);
    expect(a).not.toBe(b);
    await app.close();
  });

  it.each(["paid", "cancelled", "expired"] as const)("a %s order is not payable: 409 and nothing is created", async (status) => {
    const cora = makeCustomer();
    const order = makeOrder({ customerId: cora.id }, { status });
    const { gateway, createPaymentIntent } = fakeGateway();
    const app = await buildApp(gateway);

    const res = await pay(app, order.publicId, { session: cora.sessionToken });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: "not_payable", order: { publicId: order.publicId, status } });
    expect(createPaymentIntent).not.toHaveBeenCalled();
    expect(paymentsOf(order.id)).toHaveLength(0);
    await app.close();
  });

  it("refuses an order whose hold has lapsed (and expires it), without calling the gateway", async () => {
    const cora = makeCustomer();
    const order = makeOrder({ customerId: cora.id }, { expiresAt: new Date(Date.now() - 1000) });
    const { gateway, createPaymentIntent } = fakeGateway();
    const app = await buildApp(gateway);

    const res = await pay(app, order.publicId, { session: cora.sessionToken });

    expect(res.statusCode).toBe(409);
    expect(statusOf(order.id)).toBe("expired");
    expect(createPaymentIntent).not.toHaveBeenCalled();
    await app.close();
  });

  it("someone else's order and a missing order are both 404, and nothing is created", async () => {
    const a = makeCustomer();
    const b = makeCustomer();
    const bOrder = makeOrder({ customerId: b.id });
    const { gateway, createPaymentIntent } = fakeGateway();
    const app = await buildApp(gateway);

    const notYours = await pay(app, bOrder.publicId, { session: a.sessionToken });
    const missing = await pay(app, "does-not-exist", { session: a.sessionToken });
    const anonymous = await pay(app, bOrder.publicId, {});

    expect(notYours.statusCode).toBe(404);
    expect(notYours.body).toBe(missing.body);
    expect(anonymous.statusCode).toBe(404);
    expect(createPaymentIntent).not.toHaveBeenCalled();
    expect(paymentsOf(bOrder.id)).toHaveLength(0);
    await app.close();
  });

  it("a guest order needs its cookie", async () => {
    const order = makeOrder({ guestToken: generateSessionToken() });
    const { gateway, createPaymentIntent } = fakeGateway();
    const app = await buildApp(gateway);

    expect((await pay(app, order.publicId, { order_token: generateSessionToken() })).statusCode).toBe(404);
    expect(createPaymentIntent).not.toHaveBeenCalled();
    await app.close();
  });

  it("gateway down: 502, and no pending row is left behind", async () => {
    const cora = makeCustomer();
    const order = makeOrder({ customerId: cora.id });
    const { gateway } = fakeGateway({
      createPaymentIntent: vi.fn(async () => {
        throw new Error("connect ECONNREFUSED");
      }),
    });
    const app = await buildApp(gateway);

    const res = await pay(app, order.publicId, { session: cora.sessionToken });

    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ message: "The payment service is unavailable. Please try again." });
    expect(paymentsOf(order.id)).toHaveLength(0);
    expect(statusOf(order.id)).toBe("pending_payment");
    await app.close();
  });

  it("after a gateway failure the shopper can try again and succeed", async () => {
    const cora = makeCustomer();
    const order = makeOrder({ customerId: cora.id });
    let fail = true;
    const { gateway } = fakeGateway({
      createPaymentIntent: vi.fn(async () => {
        if (fail) throw new Error("down");
        return { id: "pi_second" };
      }),
    });
    const app = await buildApp(gateway);

    expect((await pay(app, order.publicId, { session: cora.sessionToken })).statusCode).toBe(502);
    fail = false;
    const res = await pay(app, order.publicId, { session: cora.sessionToken });

    expect(res.statusCode).toBe(200);
    expect(paymentsOf(order.id)).toHaveLength(1);
    await app.close();
  });

  it("never marks the order paid: only the webhook can", async () => {
    const cora = makeCustomer();
    const order = makeOrder({ customerId: cora.id });
    const app = await buildApp(fakeGateway().gateway);

    await pay(app, order.publicId, { session: cora.sessionToken });

    expect(statusOf(order.id)).toBe("pending_payment");
    expect(testDb.select().from(schema.orderEvents).where(eq(schema.orderEvents.orderId, order.id)).all()).toHaveLength(0);
    await app.close();
  });

  it("does not leave a pending row whose intent was never stored when the intent id comes back unusable", async () => {
    const cora = makeCustomer();
    const order = makeOrder({ customerId: cora.id });
    const { gateway } = fakeGateway({
      createPaymentIntent: vi.fn(async () => {
        throw new Error("Gateway payment intent response had no valid id");
      }),
    });
    const app = await buildApp(gateway);

    expect((await pay(app, order.publicId, { session: cora.sessionToken })).statusCode).toBe(502);
    expect(paymentsOf(order.id)).toHaveLength(0);
    await app.close();
  });
});

describe("two presses at once", () => {
  it("create one attempt and one intent, and both get a pay URL", async () => {
    const cora = makeCustomer();
    const order = makeOrder({ customerId: cora.id });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { gateway, createPaymentIntent } = fakeGateway({
      createPaymentIntent: vi.fn(async () => {
        await gate;
        return { id: "pi_only" };
      }),
    });
    const app = await buildApp(gateway);

    const first = pay(app, order.publicId, { session: cora.sessionToken });
    await vi.waitFor(() => expect(paymentsOf(order.id)).toHaveLength(1));
    const second = pay(app, order.publicId, { session: cora.sessionToken });
    await new Promise((r) => setTimeout(r, 30));
    release();
    const [a, b] = await Promise.all([first, second]);

    expect(paymentsOf(order.id)).toHaveLength(1);
    expect(a.statusCode).toBe(200);
    expect(a.json()).toEqual({ payUrl: `${PUBLIC}/pay/pi_only` });
    // The second press either reused the finished attempt or got a retryable 502; it never opened a second payment.
    expect([200, 502]).toContain(b.statusCode);
    expect(createPaymentIntent.mock.calls.length).toBeLessThanOrEqual(2);
    expect(paymentsOf(order.id)).toMatchObject([{ gatewayIntentId: "pi_only", status: "pending" }]);
    await app.close();
  });

  it("if the first press fails and cleans up while the second is still waiting, the second does not hand out an intent no payment row knows about", async () => {
    const cora = makeCustomer();
    const order = makeOrder({ customerId: cora.id });
    const releases: Array<() => void> = [];
    let calls = 0;
    const { gateway } = fakeGateway({
      createPaymentIntent: vi.fn(async () => {
        calls += 1;
        const mine = calls;
        await new Promise<void>((resolve) => releases.push(resolve));
        if (mine === 1) throw new Error("first call fails");
        return { id: "pi_orphan" };
      }),
    });
    const app = await buildApp(gateway);

    const first = pay(app, order.publicId, { session: cora.sessionToken });
    await vi.waitFor(() => expect(releases).toHaveLength(1));
    const second = pay(app, order.publicId, { session: cora.sessionToken });
    await vi.waitFor(() => expect(releases).toHaveLength(2));

    releases[0]();
    expect((await first).statusCode).toBe(502);
    expect(paymentsOf(order.id)).toHaveLength(0);

    releases[1]();
    const res = await second;

    expect(res.statusCode).toBe(502);
    expect(res.body).not.toContain("pi_orphan");
    expect(paymentsOf(order.id)).toHaveLength(0);
    await app.close();
  });
});
