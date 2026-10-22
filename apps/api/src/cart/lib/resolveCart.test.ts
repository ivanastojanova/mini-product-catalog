import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "../../db/schema.js";
import { generateSessionToken, hashSessionToken } from "../../auth/lib/session.js";
import { GUEST_CART_DURATION_MS } from "./cartConfig.js";

const sqlite = new Database(":memory:");
const testDb = drizzle(sqlite, { schema });
migrate(testDb, { migrationsFolder: "./src/db/migrations" });

vi.mock("../../db/client.js", () => ({ db: testDb }));

const { resolveCart } = await import("./resolveCart.js");

async function createSession(customerId: number, expiresAt = new Date(Date.now() + 60_000)) {
  const token = generateSessionToken();
  await testDb
    .insert(schema.sessions)
    .values({ id: hashSessionToken(token), customerId, expiresAt });
  return token;
}

async function createGuestCart(updatedAt = new Date()) {
  const token = generateSessionToken();
  const [cart] = await testDb
    .insert(schema.carts)
    .values({ guestTokenHash: hashSessionToken(token), updatedAt })
    .returning();
  return { token, cartId: cart.id };
}

describe("resolveCart", () => {
  let customerId: number;

  beforeEach(async () => {
    sqlite.exec("DELETE FROM carts; DELETE FROM sessions; DELETE FROM customers;");

    const [customer] = await testDb
      .insert(schema.customers)
      .values({ email: "shopper@example.com", passwordHash: "irrelevant", name: "Shopper" })
      .returning();
    customerId = customer.id;
  });

  afterAll(() => {
    sqlite.close();
  });

  it("returns none when there is neither a session nor a cart cookie", async () => {
    await expect(
      resolveCart({ sessionToken: undefined, cartToken: undefined }),
    ).resolves.toEqual({ kind: "none" });
  });

  it("returns the guest cart for a valid cart cookie", async () => {
    const { token, cartId } = await createGuestCart();

    await expect(
      resolveCart({ sessionToken: undefined, cartToken: token }),
    ).resolves.toEqual({ kind: "guest", cartId });
  });

  it("returns none for an unknown cart cookie", async () => {
    await expect(
      resolveCart({ sessionToken: undefined, cartToken: generateSessionToken() }),
    ).resolves.toEqual({ kind: "none" });
  });

  it("treats a guest cart idle for 30+ days as absent", async () => {
    const { token } = await createGuestCart(new Date(Date.now() - GUEST_CART_DURATION_MS - 1000));

    await expect(
      resolveCart({ sessionToken: undefined, cartToken: token }),
    ).resolves.toEqual({ kind: "none" });
  });

  it("still returns a guest cart just inside the 30-day window", async () => {
    const { token, cartId } = await createGuestCart(
      new Date(Date.now() - GUEST_CART_DURATION_MS + 60_000),
    );

    await expect(
      resolveCart({ sessionToken: undefined, cartToken: token }),
    ).resolves.toEqual({ kind: "guest", cartId });
  });

  it("returns the customer's cart for a valid session", async () => {
    const sessionToken = await createSession(customerId);
    const [cart] = await testDb.insert(schema.carts).values({ customerId }).returning();

    await expect(
      resolveCart({ sessionToken, cartToken: undefined }),
    ).resolves.toEqual({ kind: "customer", customerId, cartId: cart.id });
  });

  it("returns a customer with cartId null when they have no cart yet (and creates nothing)", async () => {
    const sessionToken = await createSession(customerId);

    await expect(
      resolveCart({ sessionToken, cartToken: undefined }),
    ).resolves.toEqual({ kind: "customer", customerId, cartId: null });

    expect(await testDb.select().from(schema.carts)).toHaveLength(0);
  });

  it("prefers the session over a guest cart cookie", async () => {
    const sessionToken = await createSession(customerId);
    const [customerCart] = await testDb.insert(schema.carts).values({ customerId }).returning();
    const { token: cartToken } = await createGuestCart();

    await expect(resolveCart({ sessionToken, cartToken })).resolves.toEqual({
      kind: "customer",
      customerId,
      cartId: customerCart.id,
    });
  });

  it("falls back to the guest cart when the session is expired", async () => {
    const sessionToken = await createSession(customerId, new Date(Date.now() - 1000));
    const { token: cartToken, cartId } = await createGuestCart();

    await expect(resolveCart({ sessionToken, cartToken })).resolves.toEqual({
      kind: "guest",
      cartId,
    });
  });

  it("never returns another customer's cart", async () => {
    const [other] = await testDb
      .insert(schema.customers)
      .values({ email: "other@example.com", passwordHash: "irrelevant", name: "Other" })
      .returning();
    await testDb.insert(schema.carts).values({ customerId: other.id });
    const sessionToken = await createSession(customerId);

    await expect(
      resolveCart({ sessionToken, cartToken: undefined }),
    ).resolves.toEqual({ kind: "customer", customerId, cartId: null });
  });
});
