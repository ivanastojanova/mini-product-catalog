import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "../../db/schema.js";
import { generateSessionToken, hashSessionToken } from "../../auth/lib/session.js";
import { GUEST_CART_DURATION_MS } from "./cartConfig.js";

const sqlite = new Database(":memory:");
sqlite.pragma("foreign_keys = ON");
const testDb = drizzle(sqlite, { schema });
migrate(testDb, { migrationsFolder: "./src/db/migrations" });

vi.mock("../../db/client.js", () => ({ db: testDb }));

const { mergeGuestCart } = await import("./mergeGuestCart.js");

type Line = [slug: string, quantity: number];

async function makeCustomer(email = "shopper@example.com") {
  const [customer] = await testDb
    .insert(schema.customers)
    .values({ email, passwordHash: "irrelevant", name: "Shopper" })
    .returning();
  return customer.id;
}

async function makeGuestCart(lines: Line[], updatedAt = new Date()) {
  const token = generateSessionToken();
  const [cart] = await testDb
    .insert(schema.carts)
    .values({ guestTokenHash: hashSessionToken(token), updatedAt })
    .returning();
  for (const [slug, quantity] of lines) {
    await testDb.insert(schema.cartItems).values({ cartId: cart.id, productSlug: slug, quantity });
  }
  return { token, cartId: cart.id };
}

async function makeCustomerCart(customerId: number, lines: Line[]) {
  const [cart] = await testDb.insert(schema.carts).values({ customerId }).returning();
  for (const [slug, quantity] of lines) {
    await testDb.insert(schema.cartItems).values({ cartId: cart.id, productSlug: slug, quantity });
  }
  return cart.id;
}

function linesOf(cartId: number): Line[] {
  const rows = sqlite
    .prepare("SELECT product_slug, quantity FROM cart_items WHERE cart_id = ? ORDER BY product_slug")
    .all(cartId) as { product_slug: string; quantity: number }[];
  return rows.map((r) => [r.product_slug, r.quantity]);
}

function cartCount() {
  return (sqlite.prepare("SELECT count(*) AS n FROM carts").get() as { n: number }).n;
}

describe("mergeGuestCart", () => {
  let customerId: number;

  beforeEach(async () => {
    sqlite.exec("DELETE FROM cart_items; DELETE FROM carts; DELETE FROM sessions; DELETE FROM customers;");
    customerId = await makeCustomer();
  });

  afterAll(() => {
    sqlite.close();
  });

  it("is a no-op without a cart token", () => {
    expect(mergeGuestCart(undefined, customerId)).toBe("none");
  });

  it("is a no-op for an unknown token and leaves other carts alone", async () => {
    const { cartId } = await makeGuestCart([["lamp", 1]]);

    expect(mergeGuestCart(generateSessionToken(), customerId)).toBe("none");
    expect(linesOf(cartId)).toEqual([["lamp", 1]]);
    expect(cartCount()).toBe(1);
  });

  it("adopts the guest cart in place when the customer has no cart", async () => {
    const { token, cartId } = await makeGuestCart([["lamp", 2], ["desk", 1]]);

    expect(mergeGuestCart(token, customerId)).toBe("adopted");

    const [cart] = await testDb.select().from(schema.carts);
    expect(cart.id).toBe(cartId);
    expect(cart.customerId).toBe(customerId);
    expect(cart.guestTokenHash).toBeNull();
    expect(linesOf(cartId)).toEqual([["desk", 1], ["lamp", 2]]);
  });

  it("carries over disjoint slugs from both sides", async () => {
    const { token } = await makeGuestCart([["lamp", 2]]);
    const customerCartId = await makeCustomerCart(customerId, [["desk", 3]]);

    expect(mergeGuestCart(token, customerId)).toBe("merged");

    expect(linesOf(customerCartId)).toEqual([["desk", 3], ["lamp", 2]]);
  });

  it("sums quantities for overlapping slugs", async () => {
    const { token } = await makeGuestCart([["lamp", 2], ["desk", 1]]);
    const customerCartId = await makeCustomerCart(customerId, [["lamp", 3]]);

    mergeGuestCart(token, customerId);

    expect(linesOf(customerCartId)).toEqual([["desk", 1], ["lamp", 5]]);
  });

  it("caps a summed line at the per-line maximum", async () => {
    const { token } = await makeGuestCart([["lamp", 8]]);
    const customerCartId = await makeCustomerCart(customerId, [["lamp", 7]]);

    mergeGuestCart(token, customerId);

    expect(linesOf(customerCartId)).toEqual([["lamp", schema.MAX_LINE_QUANTITY]]);
  });

  it("deletes the guest cart and its items after a merge", async () => {
    const { token, cartId } = await makeGuestCart([["lamp", 1]]);
    await makeCustomerCart(customerId, []);

    mergeGuestCart(token, customerId);

    expect(cartCount()).toBe(1);
    expect(linesOf(cartId)).toEqual([]);
    expect(await testDb.select().from(schema.carts)).toEqual([
      expect.objectContaining({ customerId, guestTokenHash: null }),
    ]);
  });

  it("merges an empty guest cart into an existing customer cart without changing it", async () => {
    const { token } = await makeGuestCart([]);
    const customerCartId = await makeCustomerCart(customerId, [["desk", 3]]);

    expect(mergeGuestCart(token, customerId)).toBe("merged");

    expect(linesOf(customerCartId)).toEqual([["desk", 3]]);
    expect(cartCount()).toBe(1);
  });

  it("merges into an existing but empty customer cart", async () => {
    const { token } = await makeGuestCart([["lamp", 4]]);
    const customerCartId = await makeCustomerCart(customerId, []);

    mergeGuestCart(token, customerId);

    expect(linesOf(customerCartId)).toEqual([["lamp", 4]]);
  });

  it("is replay-safe: a second merge with the same token changes nothing", async () => {
    const { token } = await makeGuestCart([["lamp", 2]]);
    const customerCartId = await makeCustomerCart(customerId, [["lamp", 1]]);

    expect(mergeGuestCart(token, customerId)).toBe("merged");
    expect(mergeGuestCart(token, customerId)).toBe("none");

    expect(linesOf(customerCartId)).toEqual([["lamp", 3]]);
  });

  it("ignores a guest cart idle for 30+ days and leaves it in place", async () => {
    const { token, cartId } = await makeGuestCart(
      [["lamp", 2]],
      new Date(Date.now() - GUEST_CART_DURATION_MS - 1000),
    );
    const customerCartId = await makeCustomerCart(customerId, [["desk", 1]]);

    expect(mergeGuestCart(token, customerId)).toBe("none");

    expect(linesOf(customerCartId)).toEqual([["desk", 1]]);
    expect(linesOf(cartId)).toEqual([["lamp", 2]]);
  });

  it("never touches another customer's cart", async () => {
    const otherId = await makeCustomer("other@example.com");
    const otherCartId = await makeCustomerCart(otherId, [["lamp", 9]]);
    const { token } = await makeGuestCart([["lamp", 1]]);

    mergeGuestCart(token, customerId);

    expect(linesOf(otherCartId)).toEqual([["lamp", 9]]);
  });

  it("rolls back completely if the merge fails midway (both carts untouched)", async () => {
    const { token, cartId } = await makeGuestCart([["lamp", 2], ["desk", 1]]);
    const customerCartId = await makeCustomerCart(customerId, [["lamp", 1]]);
    // Lines merge in slug order: "desk" is written first (a new row), then "lamp"
    // blows up — so the rollback has real partial work to undo.
    sqlite.exec(`
      CREATE TRIGGER fail_on_lamp BEFORE INSERT ON cart_items
      WHEN NEW.product_slug = 'lamp' AND NEW.cart_id = ${customerCartId}
      BEGIN SELECT RAISE(ABORT, 'boom'); END;
    `);

    expect(() => mergeGuestCart(token, customerId)).toThrow(/boom/);
    sqlite.exec("DROP TRIGGER fail_on_lamp");

    expect(linesOf(customerCartId)).toEqual([["lamp", 1]]);
    expect(linesOf(cartId)).toEqual([["desk", 1], ["lamp", 2]]);
    expect(cartCount()).toBe(2);
  });
});
