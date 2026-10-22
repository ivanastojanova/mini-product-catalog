import { eq } from "drizzle-orm";

import { getCustomerForSessionToken } from "../../auth/lib/getSession.js";
import { hashSessionToken } from "../../auth/lib/session.js";
import { db } from "../../db/client.js";
import { carts } from "../../db/schema.js";
import { GUEST_CART_DURATION_MS } from "./cartConfig.js";

/**
 * Who a cart request belongs to. `cartId` is null when that owner has no cart
 * row yet — reads treat that as empty, and the first add creates the row.
 */
export type ResolvedCart =
  | { kind: "customer"; customerId: number; cartId: number | null }
  | { kind: "guest"; cartId: number }
  | { kind: "none" };

/**
 * Decides which cart a request operates on. A valid session always wins over
 * a `cart_token` cookie (the cookie is only consumed by the login merge).
 * Pure lookup — never creates rows, so a bare `GET /cart` leaves no trace.
 * Takes the raw cookie values (not the Fastify request) so it's testable
 * without a server; the route layer reads the cookies.
 */
export async function resolveCart(tokens: {
  sessionToken: string | undefined;
  cartToken: string | undefined;
}): Promise<ResolvedCart> {
  const customer = await getCustomerForSessionToken(tokens.sessionToken);

  if (customer) {
    const [cart] = await db
      .select({ id: carts.id })
      .from(carts)
      .where(eq(carts.customerId, customer.id))
      .limit(1);

    return { kind: "customer", customerId: customer.id, cartId: cart?.id ?? null };
  }

  if (!tokens.cartToken) {
    return { kind: "none" };
  }

  const [guestCart] = await db
    .select({ id: carts.id, updatedAt: carts.updatedAt })
    .from(carts)
    .where(eq(carts.guestTokenHash, hashSessionToken(tokens.cartToken)))
    .limit(1);

  if (!guestCart || guestCart.updatedAt.getTime() + GUEST_CART_DURATION_MS <= Date.now()) {
    return { kind: "none" };
  }

  return { kind: "guest", cartId: guestCart.id };
}
