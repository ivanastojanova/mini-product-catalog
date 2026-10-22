import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "../../db/schema.js";
import { hashPassword } from "../../auth/lib/password.js";
import { hashSessionToken } from "../../auth/lib/session.js";

const sqlite = new Database(":memory:");
sqlite.pragma("foreign_keys = ON");
const testDb = drizzle(sqlite, { schema });
migrate(testDb, { migrationsFolder: "./src/db/migrations" });

vi.mock("../../db/client.js", () => ({ db: testDb }));
vi.mock("../lib/cmsClient.js", () => ({ productExists: async () => true }));

const { registerCartRoutes } = await import("./cart.js");
const { registerLoginRoute } = await import("../../auth/routes/login.js");
const { registerAuthRoutes } = await import("../../auth/routes/register.js");

const EMAIL = "shopper@example.com";
const PASSWORD = "correct-horse";

async function buildApp() {
  const app = Fastify();
  await app.register(cookie);
  registerCartRoutes(app);
  registerLoginRoute(app);
  registerAuthRoutes(app);
  await app.ready();
  return app;
}

type Res = Awaited<ReturnType<FastifyInstance["inject"]>>;

function cookieOf(response: Res, name: string) {
  return response.cookies.find((c) => c.name === name);
}

async function guestAdds(app: FastifyInstance, lines: [string, number][]) {
  let token: string | undefined;
  for (const [slug, quantity] of lines) {
    const response = await app.inject({
      method: "POST",
      url: "/cart/items",
      headers: token ? { cookie: `cart_token=${token}` } : {},
      payload: { slug, quantity },
    });
    token ??= cookieOf(response, "cart_token")!.value;
  }
  return token!;
}

function login(app: FastifyInstance, guestToken?: string, password = PASSWORD, email = EMAIL) {
  return app.inject({
    method: "POST",
    url: "/auth/login",
    headers: guestToken ? { cookie: `cart_token=${guestToken}` } : {},
    payload: { email, password },
  });
}

async function cartFor(app: FastifyInstance, response: Res) {
  const sessionToken = cookieOf(response, "session")!.value;
  const view = await app.inject({
    method: "GET",
    url: "/cart",
    headers: { cookie: `session=${sessionToken}` },
  });
  return view.json().items as { slug: string; quantity: number }[];
}

async function guestCartCount() {
  const rows = await testDb.select().from(schema.carts);
  return rows.filter((c) => c.guestTokenHash !== null).length;
}

describe("guest cart merge on login / register", () => {
  let customerId: number;

  beforeEach(async () => {
    sqlite.exec("DELETE FROM cart_items; DELETE FROM carts; DELETE FROM sessions; DELETE FROM customers;");
    const [customer] = await testDb
      .insert(schema.customers)
      .values({ email: EMAIL, passwordHash: await hashPassword(PASSWORD), name: "Shopper" })
      .returning();
    customerId = customer.id;
  });

  afterAll(() => {
    sqlite.close();
  });

  describe("login", () => {
    it("adopts the guest cart when the customer has none, and clears the cart cookie", async () => {
      const app = await buildApp();
      const token = await guestAdds(app, [["lamp", 2], ["desk", 1]]);

      const response = await login(app, token);

      expect(response.statusCode).toBe(200);
      expect(cookieOf(response, "cart_token")).toEqual(
        expect.objectContaining({ value: "", expires: expect.any(Date) }),
      );
      expect(cookieOf(response, "cart_token")!.expires!.getTime()).toBeLessThan(Date.now());
      expect(await cartFor(app, response)).toEqual(
        expect.arrayContaining([
          { slug: "lamp", quantity: 2 },
          { slug: "desk", quantity: 1 },
        ]),
      );
      expect(await guestCartCount()).toBe(0);
      await app.close();
    });

    it("sums overlapping lines into the customer's saved cart (capped) and deletes the guest cart", async () => {
      const [saved] = await testDb.insert(schema.carts).values({ customerId }).returning();
      await testDb.insert(schema.cartItems).values([
        { cartId: saved.id, productSlug: "lamp", quantity: 7 },
        { cartId: saved.id, productSlug: "rug", quantity: 1 },
      ]);
      const app = await buildApp();
      const token = await guestAdds(app, [["lamp", 5], ["desk", 2]]);

      const response = await login(app, token);

      const items = await cartFor(app, response);
      expect(items).toHaveLength(3);
      expect(items).toEqual(
        expect.arrayContaining([
          { slug: "lamp", quantity: 10 },
          { slug: "rug", quantity: 1 },
          { slug: "desk", quantity: 2 },
        ]),
      );
      expect(await testDb.select().from(schema.carts)).toHaveLength(1);
      await app.close();
    });

    it("the old guest cookie no longer resolves to anything after login", async () => {
      const app = await buildApp();
      const token = await guestAdds(app, [["lamp", 1]]);
      await login(app, token);

      const view = await app.inject({
        method: "GET",
        url: "/cart",
        headers: { cookie: `cart_token=${token}` },
      });

      expect(view.json()).toEqual({ items: [] });
      await app.close();
    });

    it("a wrong password leaves the guest cart and its cookie untouched", async () => {
      const app = await buildApp();
      const token = await guestAdds(app, [["lamp", 2]]);

      const response = await login(app, token, "wrong-password");

      expect(response.statusCode).toBe(401);
      expect(cookieOf(response, "cart_token")).toBeUndefined();
      expect(response.headers["set-cookie"]).toBeUndefined();
      expect(await guestCartCount()).toBe(1);
      const view = await app.inject({
        method: "GET",
        url: "/cart",
        headers: { cookie: `cart_token=${token}` },
      });
      expect(view.json()).toEqual({ items: [{ slug: "lamp", quantity: 2 }] });
      await app.close();
    });

    it("an unknown email leaves the guest cart untouched", async () => {
      const app = await buildApp();
      const token = await guestAdds(app, [["lamp", 2]]);

      const response = await login(app, token, PASSWORD, "nobody@example.com");

      expect(response.statusCode).toBe(401);
      expect(await guestCartCount()).toBe(1);
      await app.close();
    });

    it("a guest cart can't be merged into a customer who didn't authenticate (invalid input)", async () => {
      const app = await buildApp();
      const token = await guestAdds(app, [["lamp", 2]]);

      const response = await login(app, token, "");

      expect(response.statusCode).toBe(400);
      expect(await guestCartCount()).toBe(1);
      await app.close();
    });

    it("works with no cart cookie: nothing to merge, no cart cookie header, customer cart untouched", async () => {
      const [saved] = await testDb.insert(schema.carts).values({ customerId }).returning();
      await testDb.insert(schema.cartItems).values({ cartId: saved.id, productSlug: "rug", quantity: 3 });
      const app = await buildApp();

      const response = await login(app);

      expect(response.statusCode).toBe(200);
      expect(cookieOf(response, "cart_token")).toBeUndefined();
      expect(await cartFor(app, response)).toEqual([{ slug: "rug", quantity: 3 }]);
      await app.close();
    });

    it("a dead/unknown cart cookie doesn't break login and is cleared", async () => {
      const app = await buildApp();

      const response = await login(app, "stale-token-that-matches-nothing");

      expect(response.statusCode).toBe(200);
      expect(cookieOf(response, "cart_token")?.value).toBe("");
      expect(cookieOf(response, "session")).toBeDefined();
      await app.close();
    });

    it("never blocks login if the merge fails: signs in, keeps the guest cart and cookie for a retry", async () => {
      const [saved] = await testDb.insert(schema.carts).values({ customerId }).returning();
      await testDb.insert(schema.cartItems).values({ cartId: saved.id, productSlug: "lamp", quantity: 1 });
      const app = await buildApp();
      const token = await guestAdds(app, [["lamp", 2]]);
      sqlite.exec(`
        CREATE TRIGGER fail_merge BEFORE UPDATE ON cart_items
        BEGIN SELECT RAISE(ABORT, 'boom'); END;
      `);

      const response = await login(app, token);
      sqlite.exec("DROP TRIGGER fail_merge");

      expect(response.statusCode).toBe(200);
      expect(cookieOf(response, "session")).toBeDefined();
      expect(cookieOf(response, "cart_token")).toBeUndefined();
      expect(await guestCartCount()).toBe(1);

      const retry = await login(app, token);
      expect(await cartFor(app, retry)).toEqual([{ slug: "lamp", quantity: 3 }]);
      await app.close();
    });

    it("two tabs logging in with the same guest cookie merge it exactly once", async () => {
      const app = await buildApp();
      const token = await guestAdds(app, [["lamp", 2]]);

      const [a, b] = await Promise.all([login(app, token), login(app, token)]);

      expect(a.statusCode).toBe(200);
      expect(b.statusCode).toBe(200);
      const items = await cartFor(app, a);
      expect(items).toEqual([{ slug: "lamp", quantity: 2 }]);
      expect(await testDb.select().from(schema.carts)).toHaveLength(1);
      await app.close();
    });
  });

  describe("register", () => {
    const newShopper = { email: "new@example.com", password: "correct-horse", name: "New" };

    function register(app: FastifyInstance, guestToken?: string, payload = newShopper) {
      return app.inject({
        method: "POST",
        url: "/auth/register",
        headers: guestToken ? { cookie: `cart_token=${guestToken}` } : {},
        payload,
      });
    }

    it("adopts the guest cart for the new customer and clears the cart cookie", async () => {
      const app = await buildApp();
      const token = await guestAdds(app, [["lamp", 2]]);

      const response = await register(app, token);

      expect(response.statusCode).toBe(201);
      expect(cookieOf(response, "cart_token")?.value).toBe("");
      expect(await cartFor(app, response)).toEqual([{ slug: "lamp", quantity: 2 }]);

      const newId = response.json().id as number;
      const [cart] = await testDb.select().from(schema.carts);
      expect(cart.customerId).toBe(newId);
      expect(cart.guestTokenHash).toBeNull();
      expect(cart.guestTokenHash).not.toBe(hashSessionToken(token));
      await app.close();
    });

    it("a rejected registration (duplicate email) leaves the guest cart untouched", async () => {
      const app = await buildApp();
      const token = await guestAdds(app, [["lamp", 2]]);

      const response = await register(app, token, { ...newShopper, email: EMAIL });

      expect(response.statusCode).toBe(409);
      expect(response.headers["set-cookie"]).toBeUndefined();
      expect(await guestCartCount()).toBe(1);
      await app.close();
    });

    it("a rejected registration (weak password) leaves the guest cart untouched", async () => {
      const app = await buildApp();
      const token = await guestAdds(app, [["lamp", 2]]);

      const response = await register(app, token, { ...newShopper, password: "short" });

      expect(response.statusCode).toBe(400);
      expect(await guestCartCount()).toBe(1);
      await app.close();
    });

    it("registers fine with no cart cookie", async () => {
      const app = await buildApp();

      const response = await register(app);

      expect(response.statusCode).toBe(201);
      expect(cookieOf(response, "cart_token")).toBeUndefined();
      expect(await cartFor(app, response)).toEqual([]);
      await app.close();
    });
  });
});
