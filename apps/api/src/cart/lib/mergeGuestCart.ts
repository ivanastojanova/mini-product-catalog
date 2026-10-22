import { eq, sql } from "drizzle-orm";

import { hashSessionToken } from "../../auth/lib/session.js";
import { db } from "../../db/client.js";
import { MAX_LINE_QUANTITY, cartItems, carts } from "../../db/schema.js";
import { GUEST_CART_DURATION_MS } from "./cartConfig.js";

export type MergeOutcome = "none" | "adopted" | "merged";

/**
 * Folds the browser's guest cart into a customer's cart. Called by login and
 * register *after* credentials are verified, so a failed login never touches
 * the guest cart.
 *
 * - No guest cart (no/unknown/expired token): nothing happens.
 * - Customer has no cart yet (always true for register): the guest cart is
 *   adopted in place — one UPDATE, no item copying.
 * - Otherwise lines are summed per slug, capped at MAX_LINE_QUANTITY, and the
 *   guest cart is deleted (its items cascade).
 *
 * Runs in one transaction, so a failure leaves both carts as they were.
 * better-sqlite3 transactions are synchronous, so two logins in one process
 * can't interleave; if one wins the guest cart, the other finds it gone and
 * is a no-op. Replaying a merge is therefore harmless.
 */
export function mergeGuestCart(
  guestToken: string | undefined,
  customerId: number,
): MergeOutcome {
  if (!guestToken) {
    return "none";
  }

  return db.transaction((tx) => {
    const guestCart = tx
      .select({ id: carts.id, updatedAt: carts.updatedAt })
      .from(carts)
      .where(eq(carts.guestTokenHash, hashSessionToken(guestToken)))
      .get();

    // Same expiry rule as resolveCart: an idle-30-days guest cart no longer exists.
    if (!guestCart || guestCart.updatedAt.getTime() + GUEST_CART_DURATION_MS <= Date.now()) {
      return "none";
    }

    const customerCart = tx
      .select({ id: carts.id })
      .from(carts)
      .where(eq(carts.customerId, customerId))
      .get();

    if (!customerCart) {
      tx.update(carts)
        .set({ customerId, guestTokenHash: null, updatedAt: new Date() })
        .where(eq(carts.id, guestCart.id))
        .run();
      return "adopted";
    }

    const guestLines = tx
      .select({ slug: cartItems.productSlug, quantity: cartItems.quantity })
      .from(cartItems)
      .where(eq(cartItems.cartId, guestCart.id))
      .orderBy(cartItems.productSlug)
      .all();

    for (const line of guestLines) {
      tx.insert(cartItems)
        .values({ cartId: customerCart.id, productSlug: line.slug, quantity: line.quantity })
        .onConflictDoUpdate({
          target: [cartItems.cartId, cartItems.productSlug],
          set: {
            quantity: sql`min(${MAX_LINE_QUANTITY}, ${cartItems.quantity} + ${line.quantity})`,
          },
        })
        .run();
    }

    tx.update(carts).set({ updatedAt: new Date() }).where(eq(carts.id, customerCart.id)).run();
    tx.delete(carts).where(eq(carts.id, guestCart.id)).run();

    return "merged";
  });
}
