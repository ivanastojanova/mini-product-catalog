import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "../../db/schema.js";
import { hashPassword } from "../lib/password.js";

/** Fresh in-memory DB per test file, migrated with the real schema — no mocking of query logic, only of the module boundary. */
const sqlite = new Database(":memory:");
const testDb = drizzle(sqlite, { schema });
migrate(testDb, { migrationsFolder: "./src/db/migrations" });

vi.mock("../../db/client.js", () => ({ db: testDb }));

const { registerLoginRoute } = await import("./login.js");

async function buildApp() {
  const app = Fastify();
  await app.register(cookie);
  registerLoginRoute(app);
  await app.ready();
  return app;
}

const EXISTING_EMAIL = "shopper@example.com";
const EXISTING_PASSWORD = "correct-horse";

describe("POST /auth/login", () => {
  beforeEach(async () => {
    sqlite.exec("DELETE FROM sessions; DELETE FROM customers;");

    await testDb.insert(schema.customers).values({
      email: EXISTING_EMAIL,
      passwordHash: await hashPassword(EXISTING_PASSWORD),
      name: "Shopper",
    });
  });

  afterAll(() => {
    sqlite.close();
  });

  it("logs in with correct credentials, creates a session, and sets a cookie (happy path)", async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/auth/login",
      headers: { "user-agent": "vitest" },
      payload: { email: EXISTING_EMAIL, password: EXISTING_PASSWORD },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toEqual({ id: expect.any(Number), email: EXISTING_EMAIL, name: "Shopper" });

    const sessionRows = await testDb.select().from(schema.sessions);
    expect(sessionRows).toHaveLength(1);
    expect(sessionRows[0].customerId).toBe(body.id);

    const setCookieHeader = response.headers["set-cookie"];
    expect(setCookieHeader).toBeDefined();
    const cookieValue = String(setCookieHeader).split(";")[0].split("=")[1];
    expect(cookieValue).not.toBe(sessionRows[0].id); // cookie holds the raw token, not its hash

    await app.close();
  });

  it("is case-insensitive on email", async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "SHOPPER@EXAMPLE.COM", password: EXISTING_PASSWORD },
    });

    expect(response.statusCode).toBe(200);

    await app.close();
  });

  it("rejects a wrong password with a generic 401 and creates no session", async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: EXISTING_EMAIL, password: "wrong-password" },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().message).toBe("Invalid email or password");

    const sessionRows = await testDb.select().from(schema.sessions);
    expect(sessionRows).toHaveLength(0);

    await app.close();
  });

  it("rejects an unknown email with the same generic 401 message as a wrong password", async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "nobody@example.com", password: EXISTING_PASSWORD },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().message).toBe("Invalid email or password");

    await app.close();
  });

  it("rejects a malformed email with 400", async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "not-an-email", password: EXISTING_PASSWORD },
    });

    expect(response.statusCode).toBe(400);

    await app.close();
  });

  it("rejects an empty password with 400", async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: EXISTING_EMAIL, password: "" },
    });

    expect(response.statusCode).toBe(400);

    await app.close();
  });

  it("rejects malformed JSON with 400", async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/auth/login",
      headers: { "content-type": "application/json" },
      payload: "not json",
    });

    expect(response.statusCode).toBe(400);

    await app.close();
  });
});
