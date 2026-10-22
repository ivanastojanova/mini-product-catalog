import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "../../db/schema.js";
import { corsOptions } from "../../corsConfig.js";
import { generateSessionToken, hashSessionToken } from "../../auth/lib/session.js";

const sqlite = new Database(":memory:");
const testDb = drizzle(sqlite, { schema });
migrate(testDb, { migrationsFolder: "./src/db/migrations" });

vi.mock("../../db/client.js", () => ({ db: testDb }));

const productExists = vi.fn<(slug: string) => Promise<boolean>>();
vi.mock("../lib/cmsClient.js", () => ({ productExists }));

const { registerCartRoutes } = await import("./cart.js");

async function buildApp() {
  const app = Fastify();
  await app.register(cookie);
  registerCartRoutes(app);
  await app.ready();
  return app;
}

function setCookieFor(response: Awaited<ReturnType<FastifyInstance["inject"]>>, name: string) {
  return response.cookies.find((c) => c.name === name);
}

describe("cart routes", () => {
  beforeEach(() => {
    sqlite.exec("DELETE FROM cart_items; DELETE FROM carts; DELETE FROM sessions; DELETE FROM customers;");
    productExists.mockReset();
    productExists.mockResolvedValue(true);
  });

  afterAll(() => {
    sqlite.close();
  });

  describe("GET /cart", () => {
    it("returns an empty cart for a fresh visitor without creating a row or cookie", async () => {
      const app = await buildApp();

      const response = await app.inject({ method: "GET", url: "/cart" });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ items: [] });
      expect(response.headers["set-cookie"]).toBeUndefined();
      expect(await testDb.select().from(schema.carts)).toHaveLength(0);
      await app.close();
    });

    it("returns the guest's lines for their cart cookie", async () => {
      const app = await buildApp();
      const add = await app.inject({
        method: "POST",
        url: "/cart/items",
        payload: { slug: "lamp" },
      });
      const token = setCookieFor(add, "cart_token")!.value;

      const response = await app.inject({
        method: "GET",
        url: "/cart",
        headers: { cookie: `cart_token=${token}` },
      });

      expect(response.json()).toEqual({ items: [{ slug: "lamp", quantity: 1 }] });
      await app.close();
    });
  });

  describe("POST /cart/items", () => {
    it("creates a guest cart on first add, stores only the token hash, and sets an httpOnly cookie", async () => {
      const app = await buildApp();

      const response = await app.inject({
        method: "POST",
        url: "/cart/items",
        payload: { slug: "lamp" },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ slug: "lamp", quantity: 1 });

      const cartCookie = setCookieFor(response, "cart_token")!;
      expect(cartCookie.httpOnly).toBe(true);
      expect(cartCookie.sameSite).toBe("Lax");
      expect(cartCookie.maxAge).toBe(30 * 24 * 60 * 60);

      const [cart] = await testDb.select().from(schema.carts);
      expect(cart.customerId).toBeNull();
      expect(cart.guestTokenHash).toBe(hashSessionToken(cartCookie.value));
      expect(cart.guestTokenHash).not.toBe(cartCookie.value);
      await app.close();
    });

    it("increments an existing line and reuses the same cart on later adds", async () => {
      const app = await buildApp();
      const first = await app.inject({ method: "POST", url: "/cart/items", payload: { slug: "lamp" } });
      const token = setCookieFor(first, "cart_token")!.value;

      const second = await app.inject({
        method: "POST",
        url: "/cart/items",
        headers: { cookie: `cart_token=${token}` },
        payload: { slug: "lamp", quantity: 2 },
      });

      expect(second.json()).toEqual({ slug: "lamp", quantity: 3 });
      expect(setCookieFor(second, "cart_token")?.value).toBe(token);
      expect(await testDb.select().from(schema.carts)).toHaveLength(1);
      await app.close();
    });

    it("clamps a line at the per-line maximum", async () => {
      const app = await buildApp();
      const first = await app.inject({
        method: "POST",
        url: "/cart/items",
        payload: { slug: "lamp", quantity: 8 },
      });
      const token = setCookieFor(first, "cart_token")!.value;

      const second = await app.inject({
        method: "POST",
        url: "/cart/items",
        headers: { cookie: `cart_token=${token}` },
        payload: { slug: "lamp", quantity: 5 },
      });

      expect(second.statusCode).toBe(200);
      expect(second.json()).toEqual({ slug: "lamp", quantity: 10 });
      await app.close();
    });

    it("adds to the customer's cart (not a guest cart) for a logged-in visitor", async () => {
      const app = await buildApp();
      const [customer] = await testDb
        .insert(schema.customers)
        .values({ email: "shopper@example.com", passwordHash: "irrelevant", name: "Shopper" })
        .returning();
      const sessionToken = generateSessionToken();
      await testDb.insert(schema.sessions).values({
        id: hashSessionToken(sessionToken),
        customerId: customer.id,
        expiresAt: new Date(Date.now() + 60_000),
      });

      const response = await app.inject({
        method: "POST",
        url: "/cart/items",
        headers: { cookie: `session=${sessionToken}` },
        payload: { slug: "lamp" },
      });

      expect(response.statusCode).toBe(200);
      expect(setCookieFor(response, "cart_token")).toBeUndefined();
      const [cart] = await testDb.select().from(schema.carts);
      expect(cart.customerId).toBe(customer.id);
      expect(cart.guestTokenHash).toBeNull();
      await app.close();
    });

    it.each([
      ["missing slug", {}],
      ["blank slug", { slug: "   " }],
      ["non-string slug", { slug: 5 }],
      ["overlong slug", { slug: "a".repeat(201) }],
      ["zero quantity", { slug: "lamp", quantity: 0 }],
      ["negative quantity", { slug: "lamp", quantity: -1 }],
      ["fractional quantity", { slug: "lamp", quantity: 1.5 }],
      ["quantity over the cap", { slug: "lamp", quantity: 11 }],
      ["string quantity", { slug: "lamp", quantity: "2" }],
    ])("rejects %s with 400 and leaves no cart or cookie", async (_label, payload) => {
      const app = await buildApp();

      const response = await app.inject({ method: "POST", url: "/cart/items", payload });

      expect(response.statusCode).toBe(400);
      expect(response.headers["set-cookie"]).toBeUndefined();
      expect(await testDb.select().from(schema.carts)).toHaveLength(0);
      await app.close();
    });

    it("rejects malformed JSON with 400", async () => {
      const app = await buildApp();

      const response = await app.inject({
        method: "POST",
        url: "/cart/items",
        headers: { "content-type": "application/json" },
        payload: "{not json",
      });

      expect(response.statusCode).toBe(400);
      await app.close();
    });

    it("returns 404 for a slug the CMS doesn't know, creating nothing", async () => {
      productExists.mockResolvedValue(false);
      const app = await buildApp();

      const response = await app.inject({ method: "POST", url: "/cart/items", payload: { slug: "ghost" } });

      expect(response.statusCode).toBe(404);
      expect(response.headers["set-cookie"]).toBeUndefined();
      expect(await testDb.select().from(schema.carts)).toHaveLength(0);
      await app.close();
    });

    it("returns 502 (not 404) when the CMS can't be reached, creating nothing", async () => {
      productExists.mockRejectedValue(new Error("ECONNREFUSED"));
      const app = await buildApp();

      const response = await app.inject({ method: "POST", url: "/cart/items", payload: { slug: "lamp" } });

      expect(response.statusCode).toBe(502);
      expect(await testDb.select().from(schema.carts)).toHaveLength(0);
      await app.close();
    });

    it("never lets one guest see or change another guest's cart", async () => {
      const app = await buildApp();
      const a = await app.inject({ method: "POST", url: "/cart/items", payload: { slug: "lamp" } });
      const tokenA = setCookieFor(a, "cart_token")!.value;
      const b = await app.inject({ method: "POST", url: "/cart/items", payload: { slug: "desk" } });
      const tokenB = setCookieFor(b, "cart_token")!.value;

      const viewA = await app.inject({ method: "GET", url: "/cart", headers: { cookie: `cart_token=${tokenA}` } });
      const viewB = await app.inject({ method: "GET", url: "/cart", headers: { cookie: `cart_token=${tokenB}` } });

      expect(tokenA).not.toBe(tokenB);
      expect(viewA.json()).toEqual({ items: [{ slug: "lamp", quantity: 1 }] });
      expect(viewB.json()).toEqual({ items: [{ slug: "desk", quantity: 1 }] });
      await app.close();
    });
  });

  describe("PUT /cart/items/:slug", () => {
    async function guestWithLine(app: FastifyInstance, slug: string, quantity = 1) {
      const add = await app.inject({ method: "POST", url: "/cart/items", payload: { slug, quantity } });
      return setCookieFor(add, "cart_token")!.value;
    }

    it("sets the line to an absolute quantity", async () => {
      const app = await buildApp();
      const token = await guestWithLine(app, "lamp", 2);

      const response = await app.inject({
        method: "PUT",
        url: "/cart/items/lamp",
        headers: { cookie: `cart_token=${token}` },
        payload: { quantity: 7 },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ slug: "lamp", quantity: 7 });
      await app.close();
    });

    it("is idempotent: repeating the same PUT leaves the same state", async () => {
      const app = await buildApp();
      const token = await guestWithLine(app, "lamp");
      const request = {
        method: "PUT" as const,
        url: "/cart/items/lamp",
        headers: { cookie: `cart_token=${token}` },
        payload: { quantity: 4 },
      };

      const first = await app.inject(request);
      const second = await app.inject(request);

      expect(first.json()).toEqual(second.json());
      const view = await app.inject({ method: "GET", url: "/cart", headers: request.headers });
      expect(view.json()).toEqual({ items: [{ slug: "lamp", quantity: 4 }] });
      await app.close();
    });

    it("only changes the named line", async () => {
      const app = await buildApp();
      const token = await guestWithLine(app, "lamp", 2);
      await app.inject({
        method: "POST",
        url: "/cart/items",
        headers: { cookie: `cart_token=${token}` },
        payload: { slug: "desk", quantity: 3 },
      });

      await app.inject({
        method: "PUT",
        url: "/cart/items/lamp",
        headers: { cookie: `cart_token=${token}` },
        payload: { quantity: 5 },
      });

      const view = await app.inject({ method: "GET", url: "/cart", headers: { cookie: `cart_token=${token}` } });
      expect(view.json().items).toEqual(
        expect.arrayContaining([
          { slug: "lamp", quantity: 5 },
          { slug: "desk", quantity: 3 },
        ]),
      );
      await app.close();
    });

    it("returns 404 for a line that isn't in the cart, and does not create it", async () => {
      const app = await buildApp();
      const token = await guestWithLine(app, "lamp");

      const response = await app.inject({
        method: "PUT",
        url: "/cart/items/desk",
        headers: { cookie: `cart_token=${token}` },
        payload: { quantity: 2 },
      });

      expect(response.statusCode).toBe(404);
      expect(await testDb.select().from(schema.cartItems)).toHaveLength(1);
      await app.close();
    });

    it("returns 404 for a visitor with no cart, creating nothing", async () => {
      const app = await buildApp();

      const response = await app.inject({
        method: "PUT",
        url: "/cart/items/lamp",
        payload: { quantity: 2 },
      });

      expect(response.statusCode).toBe(404);
      expect(response.headers["set-cookie"]).toBeUndefined();
      expect(await testDb.select().from(schema.carts)).toHaveLength(0);
      await app.close();
    });

    it.each([
      ["zero (use DELETE to remove)", { quantity: 0 }],
      ["negative", { quantity: -3 }],
      ["fractional", { quantity: 2.5 }],
      ["over the cap", { quantity: 11 }],
      ["string", { quantity: "3" }],
      ["missing", {}],
    ])("rejects a %s quantity with 400 and leaves the line untouched", async (_label, payload) => {
      const app = await buildApp();
      const token = await guestWithLine(app, "lamp", 2);

      const response = await app.inject({
        method: "PUT",
        url: "/cart/items/lamp",
        headers: { cookie: `cart_token=${token}` },
        payload,
      });

      expect(response.statusCode).toBe(400);
      const [line] = await testDb.select().from(schema.cartItems);
      expect(line.quantity).toBe(2);
      await app.close();
    });

    it("does not call the CMS (the line already passed that check when it was added)", async () => {
      const app = await buildApp();
      const token = await guestWithLine(app, "lamp");
      productExists.mockClear();

      await app.inject({
        method: "PUT",
        url: "/cart/items/lamp",
        headers: { cookie: `cart_token=${token}` },
        payload: { quantity: 3 },
      });

      expect(productExists).not.toHaveBeenCalled();
      await app.close();
    });

    it("cannot touch another guest's cart", async () => {
      const app = await buildApp();
      await guestWithLine(app, "lamp", 2);
      const tokenB = await guestWithLine(app, "desk", 1);

      const response = await app.inject({
        method: "PUT",
        url: "/cart/items/lamp",
        headers: { cookie: `cart_token=${tokenB}` },
        payload: { quantity: 9 },
      });

      expect(response.statusCode).toBe(404);
      const lines = await testDb.select().from(schema.cartItems);
      expect(lines.find((l) => l.productSlug === "lamp")?.quantity).toBe(2);
      await app.close();
    });

    it("refreshes the guest cookie and the cart's updated_at", async () => {
      const app = await buildApp();
      const token = await guestWithLine(app, "lamp");
      const old = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
      await testDb.update(schema.carts).set({ updatedAt: old });

      const response = await app.inject({
        method: "PUT",
        url: "/cart/items/lamp",
        headers: { cookie: `cart_token=${token}` },
        payload: { quantity: 2 },
      });

      expect(setCookieFor(response, "cart_token")?.value).toBe(token);
      const [cart] = await testDb.select().from(schema.carts);
      expect(cart.updatedAt.getTime()).toBeGreaterThan(old.getTime() + 24 * 60 * 60 * 1000);
      await app.close();
    });

    it("updates a logged-in customer's cart", async () => {
      const app = await buildApp();
      const [customer] = await testDb
        .insert(schema.customers)
        .values({ email: "shopper@example.com", passwordHash: "irrelevant", name: "Shopper" })
        .returning();
      const sessionToken = generateSessionToken();
      await testDb.insert(schema.sessions).values({
        id: hashSessionToken(sessionToken),
        customerId: customer.id,
        expiresAt: new Date(Date.now() + 60_000),
      });
      const headers = { cookie: `session=${sessionToken}` };
      await app.inject({ method: "POST", url: "/cart/items", headers, payload: { slug: "lamp" } });

      const response = await app.inject({
        method: "PUT",
        url: "/cart/items/lamp",
        headers,
        payload: { quantity: 6 },
      });

      expect(response.json()).toEqual({ slug: "lamp", quantity: 6 });
      expect(setCookieFor(response, "cart_token")).toBeUndefined();
      await app.close();
    });
  });

  describe("DELETE /cart/items/:slug", () => {
    it("removes the line and returns 204", async () => {
      const app = await buildApp();
      const add = await app.inject({ method: "POST", url: "/cart/items", payload: { slug: "lamp" } });
      const headers = { cookie: `cart_token=${setCookieFor(add, "cart_token")!.value}` };

      const response = await app.inject({ method: "DELETE", url: "/cart/items/lamp", headers });

      expect(response.statusCode).toBe(204);
      expect(response.body).toBe("");
      const view = await app.inject({ method: "GET", url: "/cart", headers });
      expect(view.json()).toEqual({ items: [] });
      await app.close();
    });

    it("is idempotent: deleting the same line twice is not an error", async () => {
      const app = await buildApp();
      const add = await app.inject({ method: "POST", url: "/cart/items", payload: { slug: "lamp" } });
      const headers = { cookie: `cart_token=${setCookieFor(add, "cart_token")!.value}` };

      const first = await app.inject({ method: "DELETE", url: "/cart/items/lamp", headers });
      const second = await app.inject({ method: "DELETE", url: "/cart/items/lamp", headers });

      expect(first.statusCode).toBe(204);
      expect(second.statusCode).toBe(204);
      await app.close();
    });

    it("only removes the named line", async () => {
      const app = await buildApp();
      const add = await app.inject({ method: "POST", url: "/cart/items", payload: { slug: "lamp" } });
      const headers = { cookie: `cart_token=${setCookieFor(add, "cart_token")!.value}` };
      await app.inject({ method: "POST", url: "/cart/items", headers, payload: { slug: "desk" } });

      await app.inject({ method: "DELETE", url: "/cart/items/lamp", headers });

      const view = await app.inject({ method: "GET", url: "/cart", headers });
      expect(view.json()).toEqual({ items: [{ slug: "desk", quantity: 1 }] });
      await app.close();
    });

    it("returns 204 for a visitor with no cart, creating nothing", async () => {
      const app = await buildApp();

      const response = await app.inject({ method: "DELETE", url: "/cart/items/lamp" });

      expect(response.statusCode).toBe(204);
      expect(response.headers["set-cookie"]).toBeUndefined();
      expect(await testDb.select().from(schema.carts)).toHaveLength(0);
      await app.close();
    });

    it("cannot remove a line from another guest's cart", async () => {
      const app = await buildApp();
      await app.inject({ method: "POST", url: "/cart/items", payload: { slug: "lamp" } });
      const b = await app.inject({ method: "POST", url: "/cart/items", payload: { slug: "desk" } });
      const headersB = { cookie: `cart_token=${setCookieFor(b, "cart_token")!.value}` };

      await app.inject({ method: "DELETE", url: "/cart/items/lamp", headers: headersB });

      const lines = await testDb.select().from(schema.cartItems);
      expect(lines.map((l) => l.productSlug).sort()).toEqual(["desk", "lamp"]);
      await app.close();
    });

    it("keeps the (now empty) cart so the guest cookie stays valid", async () => {
      const app = await buildApp();
      const add = await app.inject({ method: "POST", url: "/cart/items", payload: { slug: "lamp" } });
      const token = setCookieFor(add, "cart_token")!.value;

      const response = await app.inject({
        method: "DELETE",
        url: "/cart/items/lamp",
        headers: { cookie: `cart_token=${token}` },
      });

      expect(setCookieFor(response, "cart_token")?.value).toBe(token);
      expect(await testDb.select().from(schema.carts)).toHaveLength(1);
      await app.close();
    });

    it("rejects a JSON content-type with an empty body (Fastify's strict rule), so clients must only set Content-Type when sending a body", async () => {
      const app = await buildApp();
      const add = await app.inject({ method: "POST", url: "/cart/items", payload: { slug: "lamp" } });
      const cookieHeader = `cart_token=${setCookieFor(add, "cart_token")!.value}`;

      const withHeader = await app.inject({
        method: "DELETE",
        url: "/cart/items/lamp",
        headers: { cookie: cookieHeader, "content-type": "application/json" },
      });
      const withoutHeader = await app.inject({
        method: "DELETE",
        url: "/cart/items/lamp",
        headers: { cookie: cookieHeader },
      });

      expect(withHeader.statusCode).toBe(400);
      expect(withoutHeader.statusCode).toBe(204);
      await app.close();
    });
  });

  describe("CORS preflight", () => {
    it("allows PUT and DELETE from the web origin with the server's real CORS options", async () => {
      const app = Fastify();
      await app.register(cors, corsOptions);
      await app.ready();

      const response = await app.inject({
        method: "OPTIONS",
        url: "/cart/items/lamp",
        headers: {
          origin: corsOptions.origin,
          "access-control-request-method": "PUT",
        },
      });

      expect(response.headers["access-control-allow-methods"]).toContain("PUT");
      expect(response.headers["access-control-allow-methods"]).toContain("DELETE");
      expect(response.headers["access-control-allow-credentials"]).toBe("true");
      await app.close();
    });
  });
});
