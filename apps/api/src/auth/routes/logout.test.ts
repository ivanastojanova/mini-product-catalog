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

const { registerLogoutRoute } = await import("./logout.js");

async function buildApp() {
  const app = Fastify();
  await app.register(cookie);
  registerLogoutRoute(app);
  await app.ready();
  return app;
}

function withSessionCookie(token: string) {
  return { cookie: `session=${token}` };
}

describe("POST /auth/logout", () => {
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

  it("deletes the matching session row and clears the cookie", async () => {
    const app = await buildApp();
    const token = generateSessionToken();
    await testDb.insert(schema.sessions).values({
      id: hashSessionToken(token),
      customerId,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60),
    });

    const response = await app.inject({
      method: "POST",
      url: "/auth/logout",
      headers: withSessionCookie(token),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ loggedOut: true });

    const sessionRows = await testDb.select().from(schema.sessions);
    expect(sessionRows).toHaveLength(0);

    const setCookieHeader = String(response.headers["set-cookie"]);
    expect(setCookieHeader).toContain("session=;"); // cleared

    await app.close();
  });

  it("does not delete other customers' sessions", async () => {
    const app = await buildApp();
    const [otherCustomer] = await testDb
      .insert(schema.customers)
      .values({ email: "other@example.com", passwordHash: "irrelevant", name: "Other" })
      .returning();

    const myToken = generateSessionToken();
    const otherToken = generateSessionToken();
    await testDb.insert(schema.sessions).values([
      {
        id: hashSessionToken(myToken),
        customerId,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      },
      {
        id: hashSessionToken(otherToken),
        customerId: otherCustomer.id,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      },
    ]);

    await app.inject({
      method: "POST",
      url: "/auth/logout",
      headers: withSessionCookie(myToken),
    });

    const sessionRows = await testDb.select().from(schema.sessions);
    expect(sessionRows).toHaveLength(1);
    expect(sessionRows[0].customerId).toBe(otherCustomer.id);

    await app.close();
  });

  it("succeeds even when there is no session cookie (already logged out)", async () => {
    const app = await buildApp();

    const response = await app.inject({ method: "POST", url: "/auth/logout" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ loggedOut: true });

    await app.close();
  });

  it("succeeds even when the cookie's session no longer exists in the DB", async () => {
    const app = await buildApp();
    const staleToken = generateSessionToken();

    const response = await app.inject({
      method: "POST",
      url: "/auth/logout",
      headers: withSessionCookie(staleToken),
    });

    expect(response.statusCode).toBe(200);
    const setCookieHeader = String(response.headers["set-cookie"]);
    expect(setCookieHeader).toContain("session=;");

    await app.close();
  });
});
