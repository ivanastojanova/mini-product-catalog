import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "../../db/schema.js";
import { generateSessionToken, hashSessionToken } from "./session.js";

const sqlite = new Database(":memory:");
const testDb = drizzle(sqlite, { schema });
migrate(testDb, { migrationsFolder: "./src/db/migrations" });

vi.mock("../../db/client.js", () => ({ db: testDb }));

const { getCustomerForSessionToken } = await import("./getSession.js");

describe("getCustomerForSessionToken", () => {
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

  it("returns null when there is no token", async () => {
    await expect(getCustomerForSessionToken(undefined)).resolves.toBeNull();
    await expect(getCustomerForSessionToken("")).resolves.toBeNull();
  });

  it("returns null for a token with no matching session", async () => {
    await expect(getCustomerForSessionToken(generateSessionToken())).resolves.toBeNull();
  });

  it("returns the customer (without the password hash) for a valid session", async () => {
    const token = generateSessionToken();
    await testDb.insert(schema.sessions).values({
      id: hashSessionToken(token),
      customerId,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60),
    });

    const customer = await getCustomerForSessionToken(token);

    expect(customer).toEqual({ id: customerId, email: "shopper@example.com", name: "Shopper" });
    expect(customer).not.toHaveProperty("passwordHash");
  });

  it("returns null for an expired session", async () => {
    const token = generateSessionToken();
    await testDb.insert(schema.sessions).values({
      id: hashSessionToken(token),
      customerId,
      expiresAt: new Date(Date.now() - 1000),
    });

    await expect(getCustomerForSessionToken(token)).resolves.toBeNull();
  });
});
