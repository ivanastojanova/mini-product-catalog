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
import type { CmsProduct } from "../../cart/lib/cmsClient.js";

const sqlite = new Database(":memory:");
sqlite.pragma("foreign_keys = ON");
const testDb = drizzle(sqlite, { schema });
migrate(testDb, { migrationsFolder: "./src/db/migrations" });

vi.mock("../../db/client.js", () => ({ db: testDb }));

const getProductsBySlugs = vi.fn<(slugs: string[], locale?: string) => Promise<Map<string, CmsProduct>>>();
vi.mock("../../cart/lib/cmsClient.js", () => ({ getProductsBySlugs }));

const { registerCreateOrderRoute } = await import("./createOrder.js");

const catalog = (...items: Array<[string, number, string?]>) =>
  new Map(
    items.map(([slug, price, currency = "EUR"]) => [
      slug,
      { slug, title: `Title ${slug}`, price, currency } satisfies CmsProduct,
    ]),
  );

async function buildApp(withCors = false) {
  const app = Fastify();
  if (withCors) await app.register(cors, corsOptions);
  await app.register(cookie);
  registerCreateOrderRoute(app);
  await app.ready();
  return app;
}

const address = { name: "Ada Lovelace", line1: "1 Main St", city: "Berlin", postalCode: "10115", country: "de" };
const guestBody = { shippingAddress: address, email: "ada@example.com" };

let keyCounter = 0;
const newKey = () => `idem-key-${(keyCounter += 1)}-abcdefgh`;

function guestCart(lines: Array<[string, number]>) {
  const token = generateSessionToken();
  const [cart] = testDb.insert(schema.carts).values({ guestTokenHash: hashSessionToken(token) }).returning().all();
  for (const [productSlug, quantity] of lines) {
    testDb.insert(schema.cartItems).values({ cartId: cart.id, productSlug, quantity }).run();
  }
  return { cartToken: token, cartId: cart.id };
}

function customer(email = "c@example.com", lines: Array<[string, number]> = []) {
  const [row] = testDb.insert(schema.customers).values({ email, passwordHash: "x", name: "Cora" }).returning().all();
  const sessionToken = generateSessionToken();
  testDb
    .insert(schema.sessions)
    .values({ id: hashSessionToken(sessionToken), customerId: row.id, expiresAt: new Date(Date.now() + 60_000) })
    .run();
  const [cart] = testDb.insert(schema.carts).values({ customerId: row.id }).returning().all();
  for (const [productSlug, quantity] of lines) {
    testDb.insert(schema.cartItems).values({ cartId: cart.id, productSlug, quantity }).run();
  }
  return { id: row.id, sessionToken, cartId: cart.id };
}

const stockUp = (...rows: Array<[string, number]>) => {
  for (const [productSlug, onHand] of rows) testDb.insert(schema.inventory).values({ productSlug, onHand }).run();
};
const stock = (slug: string) => {
  const r = testDb.select().from(schema.inventory).where(eq(schema.inventory.productSlug, slug)).get();
  return r && { onHand: r.onHand, reserved: r.reserved };
};
const orders = () => testDb.select().from(schema.orders).all();
const cookieOf = (res: { cookies: Array<{ name: string; value: string }> }, name: string) =>
  res.cookies.find((c) => c.name === name);

beforeEach(() => {
  sqlite.exec(
    "DELETE FROM order_events; DELETE FROM order_items; DELETE FROM orders; DELETE FROM inventory; DELETE FROM cart_items; DELETE FROM carts; DELETE FROM sessions; DELETE FROM customers;",
  );
  getProductsBySlugs.mockReset();
  getProductsBySlugs.mockResolvedValue(catalog(["lamp", 265], ["chair", 790.5]));
  stockUp(["lamp", 10], ["chair", 10]);
});

afterAll(() => {
  sqlite.close();
});

describe("POST /orders as a guest", () => {
  it("creates the order, holds stock, clears the cart and sets the order_token cookie", async () => {
    const { cartToken, cartId } = guestCart([["lamp", 2], ["chair", 1]]);
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/orders",
      headers: { "idempotency-key": newKey() },
      cookies: { cart_token: cartToken },
      payload: guestBody,
    });

    expect(res.statusCode).toBe(201);
    const { order } = res.json();
    expect(order).toMatchObject({
      status: "pending_payment",
      currency: "EUR",
      totalCents: 2 * 26500 + 79050,
      contactEmail: "ada@example.com",
      shippingAddress: { name: "Ada Lovelace", line1: "1 Main St", line2: null, city: "Berlin", postalCode: "10115", country: "DE" },
      paidAt: null,
    });
    expect(order.items).toEqual([
      { slug: "chair", title: "Title chair", unitPriceCents: 79050, quantity: 1, lineTotalCents: 79050 },
      { slug: "lamp", title: "Title lamp", unitPriceCents: 26500, quantity: 2, lineTotalCents: 53000 },
    ]);
    expect(stock("lamp")).toEqual({ onHand: 10, reserved: 2 });
    expect(testDb.select().from(schema.cartItems).where(eq(schema.cartItems.cartId, cartId)).all()).toHaveLength(0);

    const orderCookie = cookieOf(res, "order_token")!;
    expect(orderCookie).toBeDefined();
    expect(orders()[0].guestTokenHash).toBe(hashSessionToken(orderCookie.value));
    expect(res.headers["set-cookie"]).toEqual(expect.stringContaining("HttpOnly"));
    await app.close();
  });

  it("never exposes internal ids, owner columns or the idempotency key", async () => {
    const { cartToken } = guestCart([["lamp", 1]]);
    const app = await buildApp();
    const key = newKey();

    const res = await app.inject({
      method: "POST",
      url: "/orders",
      headers: { "idempotency-key": key },
      cookies: { cart_token: cartToken },
      payload: guestBody,
    });

    const { order } = res.json();
    expect(Object.keys(order).sort()).toEqual(
      ["contactEmail", "createdAt", "currency", "items", "paidAt", "payment", "publicId", "reservationExpiresAt", "shippingAddress", "status", "totalCents"].sort(),
    );
    expect(JSON.stringify(res.json())).not.toContain(key);
    expect(JSON.stringify(res.json())).not.toContain(hashSessionToken(cookieOf(res, "order_token")!.value));
    await app.close();
  });

  it("reuses the browser's existing order_token for a later order", async () => {
    const first = guestCart([["lamp", 1]]);
    const app = await buildApp();
    const r1 = await app.inject({
      method: "POST", url: "/orders", headers: { "idempotency-key": newKey() },
      cookies: { cart_token: first.cartToken }, payload: guestBody,
    });
    const token = cookieOf(r1, "order_token")!.value;
    testDb.update(schema.orders).set({ status: "cancelled" }).run();
    testDb.insert(schema.cartItems).values({ cartId: first.cartId, productSlug: "chair", quantity: 1 }).run();

    const r2 = await app.inject({
      method: "POST", url: "/orders", headers: { "idempotency-key": newKey() },
      cookies: { cart_token: first.cartToken, order_token: token }, payload: guestBody,
    });

    expect(r2.statusCode).toBe(201);
    expect(new Set(orders().map((o) => o.guestTokenHash)).size).toBe(1);
    expect(cookieOf(r2, "order_token")!.value).toBe(token);
    await app.close();
  });

  it("requires a valid email", async () => {
    const { cartToken } = guestCart([["lamp", 1]]);
    const app = await buildApp();
    for (const email of [undefined, "", "nope", "a@b"]) {
      const res = await app.inject({
        method: "POST", url: "/orders", headers: { "idempotency-key": newKey() },
        cookies: { cart_token: cartToken }, payload: { shippingAddress: address, email },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().field).toBe("email");
    }
    expect(orders()).toHaveLength(0);
    await app.close();
  });
});

describe("POST /orders as a customer", () => {
  it("uses the account email, ignores a body email and an order_token cookie, and sets no order cookie", async () => {
    const c = customer("cora@example.com", [["lamp", 1]]);
    const app = await buildApp();

    const res = await app.inject({
      method: "POST", url: "/orders", headers: { "idempotency-key": newKey() },
      cookies: { session: c.sessionToken, order_token: "some-old-guest-token" },
      payload: { shippingAddress: address, email: "someone-else@example.com" },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().order.contactEmail).toBe("cora@example.com");
    expect(orders()[0]).toMatchObject({ customerId: c.id, guestTokenHash: null });
    expect(cookieOf(res, "order_token")).toBeUndefined();
    await app.close();
  });

  it("works without an email in the body", async () => {
    const c = customer("cora@example.com", [["lamp", 1]]);
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/orders", headers: { "idempotency-key": newKey() },
      cookies: { session: c.sessionToken }, payload: { shippingAddress: address },
    });
    expect(res.statusCode).toBe(201);
    await app.close();
  });

  it("a session beats a guest cart cookie: the customer's cart is bought, the guest cart untouched", async () => {
    const c = customer("cora@example.com", [["lamp", 1]]);
    const guest = guestCart([["chair", 3]]);
    const app = await buildApp();

    const res = await app.inject({
      method: "POST", url: "/orders", headers: { "idempotency-key": newKey() },
      cookies: { session: c.sessionToken, cart_token: guest.cartToken }, payload: { shippingAddress: address },
    });

    expect(res.json().order.items.map((i: { slug: string }) => i.slug)).toEqual(["lamp"]);
    expect(testDb.select().from(schema.cartItems).where(eq(schema.cartItems.cartId, guest.cartId)).all()).toHaveLength(1);
    await app.close();
  });
});

describe("prices come from the CMS, never the client", () => {
  it("ignores price, total and currency fields sent in the body", async () => {
    const { cartToken } = guestCart([["lamp", 1]]);
    const app = await buildApp();

    const res = await app.inject({
      method: "POST", url: "/orders", headers: { "idempotency-key": newKey() },
      cookies: { cart_token: cartToken },
      payload: {
        ...guestBody, totalCents: 1, total: 0.01, currency: "USD",
        items: [{ slug: "lamp", unitPriceCents: 1, quantity: 99 }],
      },
    });

    expect(res.json().order).toMatchObject({ totalCents: 26500, currency: "EUR" });
    expect(res.json().order.items).toHaveLength(1);
    expect(res.json().order.items[0]).toMatchObject({ unitPriceCents: 26500, quantity: 1 });
    await app.close();
  });

  it("snapshots the price: a later CMS price change does not alter the order", async () => {
    const { cartToken } = guestCart([["lamp", 1]]);
    const app = await buildApp();
    await app.inject({
      method: "POST", url: "/orders", headers: { "idempotency-key": newKey() },
      cookies: { cart_token: cartToken }, payload: guestBody,
    });

    getProductsBySlugs.mockResolvedValue(catalog(["lamp", 999]));

    expect(testDb.select().from(schema.orderItems).get()!.unitPriceCents).toBe(26500);
    expect(orders()[0].totalCents).toBe(26500);
    await app.close();
  });

  it("uses the price at submit time when it changed since the preview", async () => {
    const { cartToken } = guestCart([["lamp", 1]]);
    getProductsBySlugs.mockResolvedValue(catalog(["lamp", 300]));
    const app = await buildApp();

    const res = await app.inject({
      method: "POST", url: "/orders", headers: { "idempotency-key": newKey() },
      cookies: { cart_token: cartToken }, payload: guestBody,
    });

    expect(res.json().order.totalCents).toBe(30000);
    await app.close();
  });

  it("snapshots titles in English regardless of anything the client sends", async () => {
    const { cartToken } = guestCart([["lamp", 1]]);
    const app = await buildApp();
    await app.inject({
      method: "POST", url: "/orders?locale=de", headers: { "idempotency-key": newKey(), "accept-language": "de" },
      cookies: { cart_token: cartToken }, payload: { ...guestBody, locale: "de" },
    });
    expect(getProductsBySlugs).toHaveBeenCalledWith(["lamp"], "en");
    await app.close();
  });
});

describe("idempotency", () => {
  it("a retry with the same key returns the same order (200) and reserves nothing more", async () => {
    const { cartToken } = guestCart([["lamp", 2]]);
    const app = await buildApp();
    const key = newKey();
    const first = await app.inject({
      method: "POST", url: "/orders", headers: { "idempotency-key": key },
      cookies: { cart_token: cartToken }, payload: guestBody,
    });
    const orderToken = cookieOf(first, "order_token")!.value;

    const retry = await app.inject({
      method: "POST", url: "/orders", headers: { "idempotency-key": key },
      cookies: { cart_token: cartToken, order_token: orderToken }, payload: guestBody,
    });

    expect(first.statusCode).toBe(201);
    expect(retry.statusCode).toBe(200);
    expect(retry.json().order.publicId).toBe(first.json().order.publicId);
    expect(orders()).toHaveLength(1);
    expect(stock("lamp")).toEqual({ onHand: 10, reserved: 2 });
    await app.close();
  });

  it("a retry whose first response was lost (no cookie came back) is refused, not handed the order", async () => {
    const { cartToken } = guestCart([["lamp", 1]]);
    const app = await buildApp();
    const key = newKey();
    await app.inject({
      method: "POST", url: "/orders", headers: { "idempotency-key": key },
      cookies: { cart_token: cartToken }, payload: guestBody,
    });

    const retry = await app.inject({
      method: "POST", url: "/orders", headers: { "idempotency-key": key },
      cookies: { cart_token: cartToken }, payload: guestBody,
    });

    expect(retry.statusCode).toBe(409);
    expect(retry.json().code).toBe("key_conflict");
    expect(retry.json().order).toBeUndefined();
    expect(cookieOf(retry, "order_token")).toBeUndefined();
    await app.close();
  });

  it("another shopper using a stolen key gets a conflict, not the order", async () => {
    const a = guestCart([["lamp", 1]]);
    const b = guestCart([["chair", 1]]);
    const app = await buildApp();
    const key = newKey();
    await app.inject({
      method: "POST", url: "/orders", headers: { "idempotency-key": key },
      cookies: { cart_token: a.cartToken }, payload: guestBody,
    });

    const res = await app.inject({
      method: "POST", url: "/orders", headers: { "idempotency-key": key },
      cookies: { cart_token: b.cartToken }, payload: guestBody,
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("key_conflict");
    expect(JSON.stringify(res.json())).not.toContain(orders()[0].publicId);
    expect(orders()).toHaveLength(1);
    await app.close();
  });

  it.each([undefined, "", "short", "has spaces in it!", "x".repeat(129)])("rejects Idempotency-Key %j with 400", async (k) => {
    const { cartToken } = guestCart([["lamp", 1]]);
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/orders", headers: k === undefined ? {} : { "idempotency-key": k },
      cookies: { cart_token: cartToken }, payload: guestBody,
    });
    expect(res.statusCode).toBe(400);
    expect(orders()).toHaveLength(0);
    await app.close();
  });
});

describe("refusals leave no trace", () => {
  async function attempt(
    overrides: { cartToken?: string; payload?: Record<string, unknown>; session?: string } = {},
  ) {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/orders", headers: { "idempotency-key": newKey() },
      cookies: {
        ...(overrides.cartToken ? { cart_token: overrides.cartToken } : {}),
        ...(overrides.session ? { session: overrides.session } : {}),
      },
      payload: "payload" in overrides ? overrides.payload : guestBody,
    });
    await app.close();
    return res;
  }

  function expectNoTrace(res: Awaited<ReturnType<typeof attempt>>) {
    expect(orders()).toHaveLength(0);
    expect(testDb.select().from(schema.orderEvents).all()).toHaveLength(0);
    expect(cookieOf(res, "order_token")).toBeUndefined();
  }

  it("empty cart: 409 empty_cart", async () => {
    const res = await attempt();
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("empty_cart");
    expectNoTrace(res);
  });

  it("an empty existing cart: 409 empty_cart", async () => {
    const { cartToken } = guestCart([]);
    const res = await attempt({ cartToken });
    expect(res.json().code).toBe("empty_cart");
    expectNoTrace(res);
  });

  it("a line the CMS no longer knows: 409 unavailable_items, nothing held, cart kept", async () => {
    const { cartToken, cartId } = guestCart([["lamp", 1], ["renamed-away", 1]]);
    const res = await attempt({ cartToken });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: "unavailable_items", items: ["renamed-away"] });
    expect(stock("lamp")).toEqual({ onHand: 10, reserved: 0 });
    expect(testDb.select().from(schema.cartItems).where(eq(schema.cartItems.cartId, cartId)).all()).toHaveLength(2);
    expectNoTrace(res);
  });

  it("not enough stock: 409 insufficient_stock listing the short lines, nothing held", async () => {
    const { cartToken, cartId } = guestCart([["lamp", 3], ["chair", 5]]);
    testDb.update(schema.inventory).set({ onHand: 2 }).where(eq(schema.inventory.productSlug, "chair")).run();

    const res = await attempt({ cartToken });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      code: "insufficient_stock",
      items: [{ slug: "chair", requested: 5, available: 2 }],
    });
    expect(stock("lamp")).toEqual({ onHand: 10, reserved: 0 });
    expect(stock("chair")).toEqual({ onHand: 2, reserved: 0 });
    expect(testDb.select().from(schema.cartItems).where(eq(schema.cartItems.cartId, cartId)).all()).toHaveLength(2);
    expectNoTrace(res);
  });

  it("mixed currencies: 409 mixed_currency", async () => {
    const { cartToken } = guestCart([["lamp", 1], ["chair", 1]]);
    getProductsBySlugs.mockResolvedValue(catalog(["lamp", 10, "EUR"], ["chair", 10, "USD"]));
    const res = await attempt({ cartToken });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("mixed_currency");
    expectNoTrace(res);
  });

  it("CMS down: 502, cart untouched, nothing held", async () => {
    const { cartToken, cartId } = guestCart([["lamp", 2]]);
    getProductsBySlugs.mockRejectedValue(new Error("fetch failed"));

    const res = await attempt({ cartToken });

    expect(res.statusCode).toBe(502);
    expect(stock("lamp")).toEqual({ onHand: 10, reserved: 0 });
    expect(testDb.select().from(schema.cartItems).where(eq(schema.cartItems.cartId, cartId)).all()).toHaveLength(1);
    expectNoTrace(res);
  });

  it("an unpaid order already open: 409 open_order with its public id", async () => {
    const { cartToken, cartId } = guestCart([["lamp", 1]]);
    const app = await buildApp();
    const first = await app.inject({
      method: "POST", url: "/orders", headers: { "idempotency-key": newKey() },
      cookies: { cart_token: cartToken }, payload: guestBody,
    });
    const orderToken = cookieOf(first, "order_token")!.value;
    testDb.insert(schema.cartItems).values({ cartId, productSlug: "chair", quantity: 1 }).run();

    const second = await app.inject({
      method: "POST", url: "/orders", headers: { "idempotency-key": newKey() },
      cookies: { cart_token: cartToken, order_token: orderToken }, payload: guestBody,
    });

    expect(second.statusCode).toBe(409);
    expect(second.json()).toMatchObject({ code: "open_order", orderPublicId: first.json().order.publicId });
    expect(orders()).toHaveLength(1);
    expect(stock("chair")).toEqual({ onHand: 10, reserved: 0 });
    await app.close();
  });

  describe("invalid address", () => {
    const base = { name: "Ada", line1: "1 Main St", city: "Berlin", postalCode: "10115", country: "DE" };
    it.each([
      ["no body", undefined, "shippingAddress.name"],
      ["no address", { email: "a@b.co" }, "shippingAddress.name"],
      ["blank name", { ...base, name: "  " }, "shippingAddress.name"],
      ["missing line1", { ...base, line1: undefined }, "shippingAddress.line1"],
      ["missing city", { ...base, city: "" }, "shippingAddress.city"],
      ["missing postal code", { ...base, postalCode: undefined }, "shippingAddress.postalCode"],
      ["3-letter country", { ...base, country: "DEU" }, "shippingAddress.country"],
      ["numeric country", { ...base, country: "12" }, "shippingAddress.country"],
      ["name too long", { ...base, name: "x".repeat(101) }, "shippingAddress.name"],
      ["line2 not text", { ...base, line2: 5 }, "shippingAddress.line2"],
    ])("%s: 400 with the failing field", async (_label, address, field) => {
      const { cartToken } = guestCart([["lamp", 1]]);
      const res = await attempt({
        cartToken,
        payload: address === undefined ? undefined : { shippingAddress: address, email: "ada@example.com" },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().field).toBe(field);
      expect(stock("lamp")).toEqual({ onHand: 10, reserved: 0 });
      expectNoTrace(res);
    });
  });
});

describe("address handling", () => {
  it("trims fields, uppercases the country and drops a blank line2", async () => {
    const { cartToken } = guestCart([["lamp", 1]]);
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/orders", headers: { "idempotency-key": newKey() },
      cookies: { cart_token: cartToken },
      payload: {
        email: " ada@example.com ",
        shippingAddress: { name: "  Ada ", line1: " 1 Main St ", line2: "   ", city: " Berlin", postalCode: "10115 ", country: " de " },
      },
    });
    expect(res.json().order.shippingAddress).toEqual({
      name: "Ada", line1: "1 Main St", line2: null, city: "Berlin", postalCode: "10115", country: "DE",
    });
    expect(res.json().order.contactEmail).toBe("ada@example.com");
    await app.close();
  });

  it("keeps a real line2", async () => {
    const { cartToken } = guestCart([["lamp", 1]]);
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/orders", headers: { "idempotency-key": newKey() },
      cookies: { cart_token: cartToken },
      payload: { ...guestBody, shippingAddress: { ...address, line2: "Apt 4" } },
    });
    expect(res.json().order.shippingAddress.line2).toBe("Apt 4");
    await app.close();
  });
});

describe("the second shopper loses a race for the last unit", () => {
  it("one order succeeds, the other gets insufficient_stock and keeps their cart", async () => {
    testDb.update(schema.inventory).set({ onHand: 1 }).where(eq(schema.inventory.productSlug, "lamp")).run();
    const a = guestCart([["lamp", 1]]);
    const b = guestCart([["lamp", 1]]);
    const app = await buildApp();

    const [ra, rb] = await Promise.all(
      [a, b].map((g) =>
        app.inject({
          method: "POST", url: "/orders", headers: { "idempotency-key": newKey() },
          cookies: { cart_token: g.cartToken }, payload: guestBody,
        }),
      ),
    );

    expect([ra.statusCode, rb.statusCode].sort()).toEqual([201, 409]);
    expect(orders()).toHaveLength(1);
    expect(stock("lamp")).toEqual({ onHand: 1, reserved: 1 });
    const loser = ra.statusCode === 409 ? a : b;
    expect(testDb.select().from(schema.cartItems).where(eq(schema.cartItems.cartId, loser.cartId)).all()).toHaveLength(1);
    await app.close();
  });
});

describe("CORS", () => {
  it("allows the Idempotency-Key header in the browser preflight", async () => {
    const app = await buildApp(true);
    const res = await app.inject({
      method: "OPTIONS", url: "/orders",
      headers: {
        origin: "http://localhost:3000",
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type,idempotency-key",
      },
    });
    expect(res.statusCode).toBeLessThan(300);
    expect(res.headers["access-control-allow-headers"]).toMatch(/idempotency-key/i);
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
    await app.close();
  });
});
