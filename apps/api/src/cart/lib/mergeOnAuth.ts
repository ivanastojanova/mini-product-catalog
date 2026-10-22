import type { FastifyReply, FastifyRequest } from "fastify";

import { sessionCookieOptions } from "../../auth/lib/sessionConfig.js";
import { CART_COOKIE_NAME } from "./cartConfig.js";
import { mergeGuestCart } from "./mergeGuestCart.js";

/**
 * Login/register hook: folds the browser's guest cart into the customer's and
 * clears the now-meaningless `cart_token` cookie. Shared so both handlers
 * behave identically.
 *
 * A cart problem must never block signing in: if the merge throws, it is
 * logged, the transaction has rolled back (guest cart intact), and the cookie
 * is left in place so the next login can retry.
 */
export function mergeCartOnAuth(
  request: FastifyRequest,
  reply: FastifyReply,
  customerId: number,
): void {
  const guestToken = request.cookies[CART_COOKIE_NAME];
  if (!guestToken) {
    return;
  }

  try {
    mergeGuestCart(guestToken, customerId);
  } catch (error) {
    request.log.error(error, "Guest cart merge failed; leaving guest cart untouched");
    return;
  }

  // Cleared even when the cookie pointed at nothing (unknown/expired) — a dead cookie is just noise.
  reply.clearCookie(CART_COOKIE_NAME, sessionCookieOptions);
}
