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
const { MAX_STOCK_BATCH_SLUGS, MAX_STOCK_SLUG_LENGTH } = await import("../lib/inventoryConfig.js");

async function buildApp() {
  const app = Fastify();
  registerStockRoutes(app);
  await app.ready();
  return app;
}

afterAll(() => {
  sqlite.close();
});

describe("GET /stock/:slug", () => {
  beforeEach(() => {
    sqlite.exec("DELETE FROM order_events; DELETE FROM order_items; DELETE FROM orders; DELETE FROM inventory;");
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

function insertOrderHolding(slug: string, quantity: number, expiresAt: Date, key: string) {
  const [order] = testDb
    .insert(schema.orders)
    .values({
      publicId: key,
      guestTokenHash: "g",
      contactEmail: "g@example.com",
      currency: "EUR",
      totalCents: 100,
      shipName: "A",
      shipLine1: "1 St",
      shipCity: "Berlin",
      shipPostalCode: "10115",
      shipCountry: "DE",
      idempotencyKey: key,
      reservationExpiresAt: expiresAt,
    })
    .returning()
    .all();
  testDb
    .insert(schema.orderItems)
    .values({ orderId: order.id, productSlug: slug, title: slug, unitPriceCents: 100, quantity })
    .run();
}

describe("GET /stock?slugs=", () => {
  beforeEach(() => {
    sqlite.exec("DELETE FROM order_events; DELETE FROM order_items; DELETE FROM orders; DELETE FROM inventory;");
  });

  it("answers for every requested slug in one call, in request order", async () => {
    testDb
      .insert(schema.inventory)
      .values([
        { productSlug: "lamp", onHand: 7 },
        { productSlug: "chair", onHand: 2 },
      ])
      .run();
    const app = await buildApp();

    const response = await app.inject({ method: "GET", url: "/stock?slugs=chair,lamp" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      items: [
        { slug: "chair", inStock: true, quantity: 2 },
        { slug: "lamp", inStock: true, quantity: 7 },
      ],
    });
    await app.close();
  });

  it("subtracts units held by unpaid orders: quantity is available, not on hand", async () => {
    testDb.insert(schema.inventory).values({ productSlug: "lamp", onHand: 5 }).run();
    reserveStock(testDb, [{ slug: "lamp", quantity: 5 }]);
    const app = await buildApp();

    const response = await app.inject({ method: "GET", url: "/stock?slugs=lamp" });

    expect(response.json().items).toEqual([{ slug: "lamp", inStock: false, quantity: 0 }]);
    await app.close();
  });

  it("reports a slug with no inventory row as out of stock, not an error", async () => {
    testDb.insert(schema.inventory).values({ productSlug: "lamp", onHand: 1 }).run();
    const app = await buildApp();

    const response = await app.inject({ method: "GET", url: "/stock?slugs=lamp,ghost" });

    expect(response.statusCode).toBe(200);
    expect(response.json().items).toEqual([
      { slug: "lamp", inStock: true, quantity: 1 },
      { slug: "ghost", inStock: false, quantity: 0 },
    ]);
    await app.close();
  });

  it("trims whitespace, drops empty entries and collapses duplicates", async () => {
    testDb.insert(schema.inventory).values({ productSlug: "lamp", onHand: 3 }).run();
    const app = await buildApp();

    const response = await app.inject({ method: "GET", url: "/stock?slugs=%20lamp%20,,lamp,%20" });

    expect(response.json().items).toEqual([{ slug: "lamp", inStock: true, quantity: 3 }]);
    await app.close();
  });

  it("never counts a hold past its deadline: the sweep runs before the read", async () => {
    testDb.insert(schema.inventory).values({ productSlug: "lamp", onHand: 5 }).run();
    reserveStock(testDb, [{ slug: "lamp", quantity: 4 }]);
    insertOrderHolding("lamp", 4, new Date(Date.now() - 60_000), "batch-stale");
    const app = await buildApp();

    const response = await app.inject({ method: "GET", url: "/stock?slugs=lamp" });

    expect(response.json().items).toEqual([{ slug: "lamp", inStock: true, quantity: 5 }]);
    expect(testDb.select().from(schema.orders).all()[0].status).toBe("expired");
    await app.close();
  });

  it("does not count a hold that has not expired yet", async () => {
    testDb.insert(schema.inventory).values({ productSlug: "lamp", onHand: 5 }).run();
    reserveStock(testDb, [{ slug: "lamp", quantity: 4 }]);
    insertOrderHolding("lamp", 4, new Date(Date.now() + 10 * 60_000), "batch-live");
    const app = await buildApp();

    const response = await app.inject({ method: "GET", url: "/stock?slugs=lamp" });

    expect(response.json().items).toEqual([{ slug: "lamp", inStock: true, quantity: 1 }]);
    await app.close();
  });

  it("is never cached", async () => {
    const app = await buildApp();

    const response = await app.inject({ method: "GET", url: "/stock?slugs=lamp" });

    expect(response.headers["cache-control"]).toBe("no-store");
    await app.close();
  });

  it("does not require a session or any cookie", async () => {
    const app = await buildApp();

    const response = await app.inject({ method: "GET", url: "/stock?slugs=lamp" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["set-cookie"]).toBeUndefined();
    await app.close();
  });

  it("rejects a missing, empty, all-blank or repeated slugs param with 400", async () => {
    const app = await buildApp();

    const missing = await app.inject({ method: "GET", url: "/stock" });
    const empty = await app.inject({ method: "GET", url: "/stock?slugs=" });
    const blank = await app.inject({ method: "GET", url: "/stock?slugs=%20,,%20" });
    const repeated = await app.inject({ method: "GET", url: "/stock?slugs=a&slugs=b" });

    expect(missing.statusCode).toBe(400);
    expect(empty.statusCode).toBe(400);
    expect(blank.statusCode).toBe(400);
    expect(repeated.statusCode).toBe(400);
    await app.close();
  });

  it("accepts exactly the cap and rejects one more with 400, never truncating", async () => {
    const app = await buildApp();
    const slugs = (n: number) => Array.from({ length: n }, (_, i) => `p${i}`).join(",");

    const atCap = await app.inject({ method: "GET", url: `/stock?slugs=${slugs(MAX_STOCK_BATCH_SLUGS)}` });
    const overCap = await app.inject({ method: "GET", url: `/stock?slugs=${slugs(MAX_STOCK_BATCH_SLUGS + 1)}` });

    expect(atCap.statusCode).toBe(200);
    expect(atCap.json().items).toHaveLength(MAX_STOCK_BATCH_SLUGS);
    expect(overCap.statusCode).toBe(400);
    await app.close();
  });

  it("counts the cap after de-duplication, so repeats cannot trip it", async () => {
    const app = await buildApp();
    const repeated = Array.from({ length: MAX_STOCK_BATCH_SLUGS * 2 }, () => "lamp").join(",");

    const response = await app.inject({ method: "GET", url: `/stock?slugs=${repeated}` });

    expect(response.statusCode).toBe(200);
    expect(response.json().items).toHaveLength(1);
    await app.close();
  });

  it("rejects an over-long slug with 400", async () => {
    const app = await buildApp();

    const ok = await app.inject({ method: "GET", url: `/stock?slugs=${"a".repeat(MAX_STOCK_SLUG_LENGTH)}` });
    const tooLong = await app.inject({ method: "GET", url: `/stock?slugs=${"a".repeat(MAX_STOCK_SLUG_LENGTH + 1)}` });

    expect(ok.statusCode).toBe(200);
    expect(tooLong.statusCode).toBe(400);
    await app.close();
  });

  it("does not shadow the single-slug route", async () => {
    testDb.insert(schema.inventory).values({ productSlug: "lamp", onHand: 4 }).run();
    const app = await buildApp();

    const response = await app.inject({ method: "GET", url: "/stock/lamp" });

    expect(response.json()).toMatchObject({ slug: "lamp", quantity: 4 });
    await app.close();
  });
});
