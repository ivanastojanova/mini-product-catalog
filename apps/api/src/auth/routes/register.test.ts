import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "../../db/schema.js";

/** Fresh in-memory DB per test file, migrated with the real schema — no mocking of query logic, only of the module boundary. */
const sqlite = new Database(":memory:");
const testDb = drizzle(sqlite, { schema });
migrate(testDb, { migrationsFolder: "./src/db/migrations" });

vi.mock("../../db/client.js", () => ({ db: testDb }));

const { registerAuthRoutes } = await import("./register.js");

async function buildApp() {
  const app = Fastify();
  await app.register(cookie);
  registerAuthRoutes(app);
  await app.ready();
  return app;
}

describe("POST /auth/register", () => {
  beforeEach(() => {
    sqlite.exec("DELETE FROM sessions; DELETE FROM customers;");
  });

  afterAll(() => {
    sqlite.close();
  });

  it("registers a new customer, creates a session, and sets a cookie (happy path)", async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/auth/register",
      headers: { "user-agent": "vitest" },
      payload: {
        email: "shopper@example.com",
        password: "correct-horse",
        name: "Shopper",
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body).toEqual({ id: expect.any(Number), email: "shopper@example.com", name: "Shopper" });
    expect(body.passwordHash).toBeUndefined();

    const customerRows = await testDb.select().from(schema.customers);
    expect(customerRows).toHaveLength(1);
    expect(customerRows[0].passwordHash).not.toBe("correct-horse");

    const sessionRows = await testDb.select().from(schema.sessions);
    expect(sessionRows).toHaveLength(1);
    expect(sessionRows[0].customerId).toBe(customerRows[0].id);

    const setCookieHeader = response.headers["set-cookie"];
    expect(setCookieHeader).toBeDefined();
    const cookieValue = String(setCookieHeader).split(";")[0].split("=")[1];
    expect(cookieValue).not.toBe(sessionRows[0].id); // cookie holds the raw token, not its hash

    await app.close();
  });

  it("rejects a duplicate email (case-insensitively) with 409 and does not create a second row", async () => {
    const app = await buildApp();

    await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email: "shopper@example.com", password: "correct-horse", name: "Shopper" },
    });

    const response = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email: "SHOPPER@EXAMPLE.COM", password: "another-password", name: "Someone Else" },
    });

    expect(response.statusCode).toBe(409);
    const customerRows = await testDb.select().from(schema.customers);
    expect(customerRows).toHaveLength(1);

    await app.close();
  });

  it("rejects a password shorter than the minimum with 400 and creates no rows", async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email: "shopper@example.com", password: "short", name: "Shopper" },
    });

    expect(response.statusCode).toBe(400);
    const customerRows = await testDb.select().from(schema.customers);
    expect(customerRows).toHaveLength(0);

    await app.close();
  });

  it("rejects an invalid email with 400", async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email: "not-an-email", password: "correct-horse", name: "Shopper" },
    });

    expect(response.statusCode).toBe(400);

    await app.close();
  });

  it("rejects malformed JSON with 400", async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/auth/register",
      headers: { "content-type": "application/json" },
      payload: "not json",
    });

    expect(response.statusCode).toBe(400);

    await app.close();
  });
});
