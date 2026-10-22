import { and, eq, sql } from "drizzle-orm";

import { generateSessionToken, hashSessionToken } from "../../auth/lib/session.js";
import { db } from "../../db/client.js";
import { MAX_LINE_QUANTITY, cartItems, carts } from "../../db/schema.js";
import type { ResolvedCart } from "./resolveCart.js";

export type CartLine = { slug: string; quantity: number };

export async function getCartLines(cartId: number): Promise<CartLine[]> {
  const rows = await db
    .select({ slug: cartItems.productSlug, quantity: cartItems.quantity })
    .from(cartItems)
    .where(eq(cartItems.cartId, cartId))
    .orderBy(cartItems.addedAt, cartItems.productSlug);

  return rows;
}

/**
 * Returns the id of the cart a write should go to, creating it if the owner
 * doesn't have one yet. `newGuestToken` is set only when a brand-new guest
 * cart was created — the caller must put it in the cookie.
 */
export async function ensureCart(
  resolved: ResolvedCart,
): Promise<{ cartId: number; newGuestToken?: string }> {
  if (resolved.kind === "guest") {
    return { cartId: resolved.cartId };
  }

  if (resolved.kind === "customer") {
    if (resolved.cartId !== null) {
      return { cartId: resolved.cartId };
    }

    // Two tabs adding at once: the unique index makes the loser a no-op, so re-select.
    await db.insert(carts).values({ customerId: resolved.customerId }).onConflictDoNothing();
    const [cart] = await db
      .select({ id: carts.id })
      .from(carts)
      .where(eq(carts.customerId, resolved.customerId))
      .limit(1);

    return { cartId: cart.id };
  }

  const token = generateSessionToken();
  const [cart] = await db
    .insert(carts)
    .values({ guestTokenHash: hashSessionToken(token) })
    .returning({ id: carts.id });

  return { cartId: cart.id, newGuestToken: token };
}

/**
 * Adds `quantity` to a line (creating it if needed), clamped to
 * MAX_LINE_QUANTITY in a single statement so concurrent adds can't exceed the
 * cap. Also bumps the cart's `updated_at`, which drives guest-cart expiry.
 * Returns the line's resulting quantity.
 */
export async function addToLine(cartId: number, slug: string, quantity: number): Promise<number> {
  const [row] = await db
    .insert(cartItems)
    .values({ cartId, productSlug: slug, quantity })
    .onConflictDoUpdate({
      target: [cartItems.cartId, cartItems.productSlug],
      set: { quantity: sql`min(${MAX_LINE_QUANTITY}, ${cartItems.quantity} + ${quantity})` },
    })
    .returning({ quantity: cartItems.quantity });

  await touchCart(cartId);

  return row.quantity;
}

/** Bumps `updated_at`, which drives guest-cart expiry. */
async function touchCart(cartId: number): Promise<void> {
  await db.update(carts).set({ updatedAt: new Date() }).where(eq(carts.id, cartId));
}

/**
 * Sets an existing line to an absolute quantity (idempotent — repeating it
 * changes nothing). Returns false if the cart has no such line; adding a new
 * line is `addToLine`'s job.
 */
export async function setLineQuantity(
  cartId: number,
  slug: string,
  quantity: number,
): Promise<boolean> {
  const updated = await db
    .update(cartItems)
    .set({ quantity })
    .where(and(eq(cartItems.cartId, cartId), eq(cartItems.productSlug, slug)))
    .returning({ slug: cartItems.productSlug });

  if (updated.length === 0) {
    return false;
  }

  await touchCart(cartId);
  return true;
}

/** Removes a line. Idempotent — removing a line that isn't there is not an error. */
export async function removeLine(cartId: number, slug: string): Promise<void> {
  const removed = await db
    .delete(cartItems)
    .where(and(eq(cartItems.cartId, cartId), eq(cartItems.productSlug, slug)))
    .returning({ slug: cartItems.productSlug });

  if (removed.length > 0) {
    await touchCart(cartId);
  }
}
