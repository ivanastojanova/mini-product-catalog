import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "../../db/schema.js";

const sqlite = new Database(":memory:");
const testDb = drizzle(sqlite, { schema });
migrate(testDb, { migrationsFolder: "./src/db/migrations" });

vi.mock("../../db/client.js", () => ({ db: testDb }));

const { registerStockRoutes } = await import("./stock.js");
const { reserveStock } = await import("../lib/inventoryRepo.js");

async function buildApp() {
  const app = Fastify();
  registerStockRoutes(app);
  await app.ready();
  return app;
}

describe("GET /stock/:slug", () => {
  beforeEach(() => {
    sqlite.exec("DELETE FROM order_events; DELETE FROM order_items; DELETE FROM orders; DELETE FROM inventory;");
  });

  afterAll(() => {
    sqlite.close();
  });

  it("reports available units for a stocked product", async () => {
    testDb.insert(schema.inventory).values({ productSlug: "lamp", onHand: 7 }).run();
    const app = await buildApp();

    const response = await app.inject({ method: "GET", url: "/stock/lamp" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ slug: "lamp", inStock: true, quantity: 7 });
    expect(Number.isNaN(Date.parse(response.json().updatedAt))).toBe(false);
    await app.close();
  });

  it("subtracts units held by unpaid orders: quantity is available, not on hand", async () => {
    testDb.insert(schema.inventory).values({ productSlug: "lamp", onHand: 5 }).run();
    reserveStock(testDb, [{ slug: "lamp", quantity: 3 }]);
    const app = await buildApp();

    const response = await app.inject({ method: "GET", url: "/stock/lamp" });

    expect(response.json()).toMatchObject({ inStock: true, quantity: 2 });
    await app.close();
  });

  it("reports out of stock once everything is held", async () => {
    testDb.insert(schema.inventory).values({ productSlug: "lamp", onHand: 2 }).run();
    reserveStock(testDb, [{ slug: "lamp", quantity: 2 }]);
    const app = await buildApp();

    const response = await app.inject({ method: "GET", url: "/stock/lamp" });

    expect(response.json()).toMatchObject({ inStock: false, quantity: 0 });
    await app.close();
  });

  it("reports out of stock (not 404) for a slug with no inventory row", async () => {
    const app = await buildApp();

    const response = await app.inject({ method: "GET", url: "/stock/ghost" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ slug: "ghost", inStock: false, quantity: 0 });
    await app.close();
  });

  it("never counts a hold past its deadline: the sweep runs before the read", async () => {
    testDb.insert(schema.inventory).values({ productSlug: "lamp", onHand: 5 }).run();
    reserveStock(testDb, [{ slug: "lamp", quantity: 4 }]);
    const [order] = testDb
      .insert(schema.orders)
      .values({
        publicId: "stale-1",
        guestTokenHash: "g",
        contactEmail: "g@example.com",
        currency: "EUR",
        totalCents: 100,
        shipName: "A",
        shipLine1: "1 St",
        shipCity: "Berlin",
        shipPostalCode: "10115",
        shipCountry: "DE",
        idempotencyKey: "stale-key-1",
        reservationExpiresAt: new Date(Date.now() - 60_000),
      })
      .returning()
      .all();
    testDb
      .insert(schema.orderItems)
      .values({ orderId: order.id, productSlug: "lamp", title: "Lamp", unitPriceCents: 100, quantity: 4 })
      .run();
    const app = await buildApp();

    const response = await app.inject({ method: "GET", url: "/stock/lamp" });

    expect(response.json()).toMatchObject({ inStock: true, quantity: 5 });
    const stored = testDb.select().from(schema.orders).all();
    expect(stored[0].status).toBe("expired");
    await app.close();
  });

  it("does not count a hold that has not expired yet", async () => {
    testDb.insert(schema.inventory).values({ productSlug: "lamp", onHand: 5 }).run();
    reserveStock(testDb, [{ slug: "lamp", quantity: 4 }]);
    const [order] = testDb
      .insert(schema.orders)
      .values({
        publicId: "live-1",
        guestTokenHash: "g",
        contactEmail: "g@example.com",
        currency: "EUR",
        totalCents: 100,
        shipName: "A",
        shipLine1: "1 St",
        shipCity: "Berlin",
        shipPostalCode: "10115",
        shipCountry: "DE",
        idempotencyKey: "live-key-1",
        reservationExpiresAt: new Date(Date.now() + 10 * 60_000),
      })
      .returning()
      .all();
    testDb
      .insert(schema.orderItems)
      .values({ orderId: order.id, productSlug: "lamp", title: "Lamp", unitPriceCents: 100, quantity: 4 })
      .run();
    const app = await buildApp();

    const response = await app.inject({ method: "GET", url: "/stock/lamp" });

    expect(response.json()).toMatchObject({ inStock: true, quantity: 1 });
    await app.close();
  });

  it("is never cached", async () => {
    const app = await buildApp();

    const response = await app.inject({ method: "GET", url: "/stock/lamp" });

    expect(response.headers["cache-control"]).toBe("no-store");
    await app.close();
  });

  it("does not require a session or any cookie", async () => {
    testDb.insert(schema.inventory).values({ productSlug: "lamp", onHand: 1 }).run();
    const app = await buildApp();

    const response = await app.inject({ method: "GET", url: "/stock/lamp" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["set-cookie"]).toBeUndefined();
    await app.close();
  });

  it("rejects a blank slug with 400, and Fastify itself refuses an oversized one (414)", async () => {
    const app = await buildApp();

    const blank = await app.inject({ method: "GET", url: "/stock/%20" });
    const huge = await app.inject({ method: "GET", url: `/stock/${"a".repeat(101)}` });

    expect(blank.statusCode).toBe(400);
    expect(huge.statusCode).toBe(414);
    await app.close();
  });
});
