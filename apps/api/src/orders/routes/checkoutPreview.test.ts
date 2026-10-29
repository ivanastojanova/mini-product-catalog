import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "../../db/schema.js";
import { generateSessionToken, hashSessionToken } from "../../auth/lib/session.js";
import type { CmsProduct } from "../../cart/lib/cmsClient.js";

const sqlite = new Database(":memory:");
sqlite.pragma("foreign_keys = ON");
const testDb = drizzle(sqlite, { schema });
migrate(testDb, { migrationsFolder: "./src/db/migrations" });

vi.mock("../../db/client.js", () => ({ db: testDb }));

const getProductsBySlugs = vi.fn<(slugs: string[], locale?: string) => Promise<Map<string, CmsProduct>>>();
vi.mock("../../cart/lib/cmsClient.js", () => ({ getProductsBySlugs }));

const { registerCheckoutRoutes } = await import("./checkoutPreview.js");
const { reserveStock } = await import("../../inventory/lib/inventoryRepo.js");

const catalog = (...items: Array<[string, number, string?]>) =>
  new Map(
    items.map(([slug, price, currency = "EUR"]) => [
      slug,
      { slug, title: `Title ${slug}`, price, currency } satisfies CmsProduct,
    ]),
  );

async function buildApp() {
  const app = Fastify();
  await app.register(cookie);
  registerCheckoutRoutes(app);
  await app.ready();
  return app;
}

function guestCart(lines: Array<[string, number]>) {
  const token = generateSessionToken();
  const [cart] = testDb
    .insert(schema.carts)
    .values({ guestTokenHash: hashSessionToken(token) })
    .returning()
    .all();
  for (const [productSlug, quantity] of lines) {
    testDb.insert(schema.cartItems).values({ cartId: cart.id, productSlug, quantity }).run();
  }
  return token;
}

function customerWithCart(lines: Array<[string, number]>) {
  const [customer] = testDb
    .insert(schema.customers)
    .values({ email: "c@example.com", passwordHash: "x", name: "C" })
    .returning()
    .all();
  const sessionToken = generateSessionToken();
  testDb
    .insert(schema.sessions)
    .values({ id: hashSessionToken(sessionToken), customerId: customer.id, expiresAt: new Date(Date.now() + 60_000) })
    .run();
  const [cart] = testDb.insert(schema.carts).values({ customerId: customer.id }).returning().all();
  for (const [productSlug, quantity] of lines) {
    testDb.insert(schema.cartItems).values({ cartId: cart.id, productSlug, quantity }).run();
  }
  return sessionToken;
}

function stockUp(...rows: Array<[string, number]>) {
  for (const [productSlug, onHand] of rows) {
    testDb.insert(schema.inventory).values({ productSlug, onHand }).run();
  }
}

describe("GET /checkout/preview", () => {
  beforeEach(() => {
    sqlite.exec(
      "DELETE FROM order_events; DELETE FROM order_items; DELETE FROM orders; DELETE FROM inventory; DELETE FROM cart_items; DELETE FROM carts; DELETE FROM sessions; DELETE FROM customers;",
    );
    getProductsBySlugs.mockReset();
    getProductsBySlugs.mockResolvedValue(catalog());
  });

  afterAll(() => {
    sqlite.close();
  });

  it("prices a guest's cart: unit price, line totals and subtotal in cents", async () => {
    const token = guestCart([["lamp", 2], ["chair", 1]]);
    stockUp(["lamp", 10], ["chair", 10]);
    getProductsBySlugs.mockResolvedValue(catalog(["lamp", 265], ["chair", 790.5]));
    const app = await buildApp();

    const response = await app.inject({ method: "GET", url: "/checkout/preview", cookies: { cart_token: token } });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      currency: "EUR",
      subtotalCents: 2 * 26500 + 79050,
      items: [
        { slug: "chair", title: "Title chair", unitPriceCents: 79050, quantity: 1, lineTotalCents: 79050, available: 10 },
        { slug: "lamp", title: "Title lamp", unitPriceCents: 26500, quantity: 2, lineTotalCents: 53000, available: 10 },
      ],
    });
    await app.close();
  });

  it("prices a logged-in customer's cart, and the session wins over a guest cookie", async () => {
    const sessionToken = customerWithCart([["lamp", 3]]);
    const guestToken = guestCart([["chair", 1]]);
    stockUp(["lamp", 10], ["chair", 10]);
    getProductsBySlugs.mockResolvedValue(catalog(["lamp", 10], ["chair", 20]));
    const app = await buildApp();

    const response = await app.inject({
      method: "GET",
      url: "/checkout/preview",
      cookies: { session: sessionToken, cart_token: guestToken },
    });

    expect(response.json().items.map((i: { slug: string }) => i.slug)).toEqual(["lamp"]);
    expect(response.json().subtotalCents).toBe(3000);
    await app.close();
  });

  it("returns an empty preview for a visitor with no cart, creating nothing", async () => {
    const app = await buildApp();

    const response = await app.inject({ method: "GET", url: "/checkout/preview" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ currency: null, items: [], subtotalCents: 0 });
    expect(response.headers["set-cookie"]).toBeUndefined();
    expect(testDb.select().from(schema.carts).all()).toHaveLength(0);
    await app.close();
  });

  it("flags a line the CMS no longer knows (orphaned slug) and leaves it out of the total", async () => {
    const token = guestCart([["lamp", 1], ["renamed-away", 2]]);
    stockUp(["lamp", 5]);
    getProductsBySlugs.mockResolvedValue(catalog(["lamp", 10]));
    const app = await buildApp();

    const response = await app.inject({ method: "GET", url: "/checkout/preview", cookies: { cart_token: token } });

    const body = response.json();
    expect(body.subtotalCents).toBe(1000);
    expect(body.items.find((i: { slug: string }) => i.slug === "renamed-away")).toMatchObject({
      problem: "unknown_product",
      quantity: 2,
      lineTotalCents: 0,
    });
    await app.close();
  });

  it("flags a line asking for more than is available", async () => {
    const token = guestCart([["lamp", 4]]);
    stockUp(["lamp", 3]);
    getProductsBySlugs.mockResolvedValue(catalog(["lamp", 10]));
    const app = await buildApp();

    const response = await app.inject({ method: "GET", url: "/checkout/preview", cookies: { cart_token: token } });

    expect(response.json().items[0]).toMatchObject({ available: 3, problem: "insufficient_stock" });
    await app.close();
  });

  it("subtracts units held by someone else's unpaid order from availability", async () => {
    const token = guestCart([["lamp", 2]]);
    stockUp(["lamp", 5]);
    reserveStock(testDb, [{ slug: "lamp", quantity: 4 }]);
    getProductsBySlugs.mockResolvedValue(catalog(["lamp", 10]));
    const app = await buildApp();

    const response = await app.inject({ method: "GET", url: "/checkout/preview", cookies: { cart_token: token } });

    expect(response.json().items[0]).toMatchObject({ available: 1, problem: "insufficient_stock" });
    await app.close();
  });

  it("sweeps expired reservations before reading availability", async () => {
    const token = guestCart([["lamp", 2]]);
    stockUp(["lamp", 5]);
    reserveStock(testDb, [{ slug: "lamp", quantity: 4 }]);
    const [order] = testDb
      .insert(schema.orders)
      .values({
        publicId: "stale",
        guestTokenHash: "other-browser",
        contactEmail: "o@example.com",
        currency: "EUR",
        totalCents: 100,
        shipName: "O",
        shipLine1: "1 St",
        shipCity: "Berlin",
        shipPostalCode: "10115",
        shipCountry: "DE",
        idempotencyKey: "stale-key",
        reservationExpiresAt: new Date(Date.now() - 60_000),
      })
      .returning()
      .all();
    testDb
      .insert(schema.orderItems)
      .values({ orderId: order.id, productSlug: "lamp", title: "Lamp", unitPriceCents: 100, quantity: 4 })
      .run();
    getProductsBySlugs.mockResolvedValue(catalog(["lamp", 10]));
    const app = await buildApp();

    const response = await app.inject({ method: "GET", url: "/checkout/preview", cookies: { cart_token: token } });

    expect(response.json().items[0]).toMatchObject({ available: 5 });
    expect(response.json().items[0].problem).toBeUndefined();
    await app.close();
  });

  it("rejects a cart that mixes currencies with 409", async () => {
    const token = guestCart([["lamp", 1], ["chair", 1]]);
    stockUp(["lamp", 5], ["chair", 5]);
    getProductsBySlugs.mockResolvedValue(catalog(["lamp", 10, "EUR"], ["chair", 10, "USD"]));
    const app = await buildApp();

    const response = await app.inject({ method: "GET", url: "/checkout/preview", cookies: { cart_token: token } });

    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe("mixed_currency");
    await app.close();
  });

  it("answers 502 when the CMS can't be reached, rather than showing wrong prices", async () => {
    const token = guestCart([["lamp", 1]]);
    getProductsBySlugs.mockRejectedValue(new Error("fetch failed"));
    const app = await buildApp();

    const response = await app.inject({ method: "GET", url: "/checkout/preview", cookies: { cart_token: token } });

    expect(response.statusCode).toBe(502);
    expect(response.json().items).toBeUndefined();
    await app.close();
  });

  describe("locale", () => {
    it("passes a supported locale to the CMS for titles", async () => {
      const token = guestCart([["lamp", 1]]);
      const app = await buildApp();

      await app.inject({ method: "GET", url: "/checkout/preview?locale=de", cookies: { cart_token: token } });

      expect(getProductsBySlugs).toHaveBeenCalledWith(["lamp"], "de");
      await app.close();
    });

    it.each(["fr", "../x", "", "DE"])("falls back to en for %j", async (locale) => {
      const token = guestCart([["lamp", 1]]);
      const app = await buildApp();

      await app.inject({
        method: "GET",
        url: `/checkout/preview?locale=${encodeURIComponent(locale)}`,
        cookies: { cart_token: token },
      });

      expect(getProductsBySlugs).toHaveBeenCalledWith(["lamp"], "en");
      await app.close();
    });
  });

  it("is never cached and never sets a cookie", async () => {
    const token = guestCart([["lamp", 1]]);
    stockUp(["lamp", 5]);
    getProductsBySlugs.mockResolvedValue(catalog(["lamp", 10]));
    const app = await buildApp();

    const response = await app.inject({ method: "GET", url: "/checkout/preview", cookies: { cart_token: token } });

    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["set-cookie"]).toBeUndefined();
    await app.close();
  });
});
