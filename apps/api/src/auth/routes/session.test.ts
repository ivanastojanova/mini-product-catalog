import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "../../db/schema.js";
import { generateSessionToken, hashSessionToken } from "../lib/session.js";

const sqlite = new Database(":memory:");
const testDb = drizzle(sqlite, { schema });
migrate(testDb, { migrationsFolder: "./src/db/migrations" });

vi.mock("../../db/client.js", () => ({ db: testDb }));

const { registerSessionRoute } = await import("./session.js");

async function buildApp() {
  const app = Fastify();
  await app.register(cookie);
  registerSessionRoute(app);
  await app.ready();
  return app;
}

function withSessionCookie(token: string) {
  return { cookie: `session=${token}` };
}

describe("GET /auth/session", () => {
  let customerId: number;

  beforeEach(async () => {
    sqlite.exec("DELETE FROM sessions; DELETE FROM customers;");

    const [customer] = await testDb
      .insert(schema.customers)
      .values({ email: "shopper@example.com", passwordHash: "irrelevant", name: "Shopper" })
      .returning();
    customerId = customer.id;
  });

  afterAll(() => {
    sqlite.close();
  });

  it("returns { customer: null } when there is no session cookie", async () => {
    const app = await buildApp();

    const response = await app.inject({ method: "GET", url: "/auth/session" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ customer: null });

    await app.close();
  });

  it("returns the customer for a valid session cookie", async () => {
    const app = await buildApp();
    const token = generateSessionToken();
    await testDb.insert(schema.sessions).values({
      id: hashSessionToken(token),
      customerId,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60),
    });

    const response = await app.inject({
      method: "GET",
      url: "/auth/session",
      headers: withSessionCookie(token),
    });

    expect(response.json()).toEqual({
      customer: { id: customerId, email: "shopper@example.com", name: "Shopper" },
    });

    await app.close();
  });

  it("returns { customer: null } for an expired session cookie", async () => {
    const app = await buildApp();
    const token = generateSessionToken();
    await testDb.insert(schema.sessions).values({
      id: hashSessionToken(token),
      customerId,
      expiresAt: new Date(Date.now() - 1000),
    });

    const response = await app.inject({
      method: "GET",
      url: "/auth/session",
      headers: withSessionCookie(token),
    });

    expect(response.json()).toEqual({ customer: null });

    await app.close();
  });
});
