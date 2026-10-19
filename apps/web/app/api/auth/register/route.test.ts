import { describe, it, expect, vi, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "@/shared/db/schema";

/** Fresh in-memory DB per test file, migrated with the real schema — no mocking of query logic, only of the module boundary. */
const sqlite = new Database(":memory:");
const testDb = drizzle(sqlite, { schema });
migrate(testDb, { migrationsFolder: "./shared/db/migrations" });

vi.mock("@/shared/db/client", () => ({ db: testDb }));

const cookieStore = new Map<string, { value: string; options?: unknown }>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    set: (name: string, value: string, options?: unknown) => {
      cookieStore.set(name, { value, options });
    },
    get: (name: string) => cookieStore.get(name),
  }),
}));

function registerRequest(body: unknown) {
  return new Request("http://localhost/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json", "user-agent": "vitest" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/register", () => {
  beforeEach(() => {
    sqlite.exec("DELETE FROM sessions; DELETE FROM customers;");
    cookieStore.clear();
  });

  it("registers a new customer, creates a session, and sets a cookie (happy path)", async () => {
    const { POST } = await import("./route");

    const response = await POST(
      registerRequest({
        email: "shopper@example.com",
        password: "correct-horse",
        name: "Shopper",
      }),
    );

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toEqual({ id: expect.any(Number), email: "shopper@example.com", name: "Shopper" });
    expect(body.passwordHash).toBeUndefined();

    const customerRows = await testDb.select().from(schema.customers);
    expect(customerRows).toHaveLength(1);
    expect(customerRows[0].passwordHash).not.toBe("correct-horse");

    const sessionRows = await testDb.select().from(schema.sessions);
    expect(sessionRows).toHaveLength(1);
    expect(sessionRows[0].customerId).toBe(customerRows[0].id);

    const cookie = cookieStore.get("session");
    expect(cookie).toBeDefined();
    expect(cookie?.value).not.toBe(sessionRows[0].id); // cookie holds the raw token, not its hash
  });

  it("rejects a duplicate email (case-insensitively) with 409 and does not create a second row", async () => {
    const { POST } = await import("./route");

    await POST(
      registerRequest({
        email: "shopper@example.com",
        password: "correct-horse",
        name: "Shopper",
      }),
    );

    const response = await POST(
      registerRequest({
        email: "SHOPPER@EXAMPLE.COM",
        password: "another-password",
        name: "Someone Else",
      }),
    );

    expect(response.status).toBe(409);
    const customerRows = await testDb.select().from(schema.customers);
    expect(customerRows).toHaveLength(1);
  });

  it("rejects a password shorter than the minimum with 400 and creates no rows", async () => {
    const { POST } = await import("./route");

    const response = await POST(
      registerRequest({
        email: "shopper@example.com",
        password: "short",
        name: "Shopper",
      }),
    );

    expect(response.status).toBe(400);
    const customerRows = await testDb.select().from(schema.customers);
    expect(customerRows).toHaveLength(0);
  });

  it("rejects an invalid email with 400", async () => {
    const { POST } = await import("./route");

    const response = await POST(
      registerRequest({
        email: "not-an-email",
        password: "correct-horse",
        name: "Shopper",
      }),
    );

    expect(response.status).toBe(400);
  });

  it("rejects malformed JSON with 400", async () => {
    const { POST } = await import("./route");

    const response = await POST(
      new Request("http://localhost/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      }),
    );

    expect(response.status).toBe(400);
  });
});
