import type { FastifyRequest } from "fastify";

import { getCustomerForSessionToken } from "../../auth/lib/getSession.js";
import { hashSessionToken } from "../../auth/lib/session.js";
import { SESSION_COOKIE_NAME } from "../../auth/lib/sessionConfig.js";
import type { AuthenticatedCustomer } from "../../auth/types.js";
import { ORDER_COOKIE_NAME } from "./orderConfig.js";
import type { OrderOwner } from "./orderOwner.js";

export type Requester = {
  customer: AuthenticatedCustomer | null;
  /** Null when the browser is anonymous and has no order_token cookie. */
  owner: OrderOwner | null;
  /** The raw cookie value, if the request carried one (not a freshly minted one). */
  guestToken: string | undefined;
};

/**
 * Who is asking about orders. A valid session always wins: the requester is
 * that customer and any `order_token` cookie is ignored (same rule as
 * `cart_token`, ADR 0006). Otherwise a browser with an `order_token` cookie is
 * a guest identified by its hash, and a browser with neither has no owner, so
 * it can't see anything. Never mints a token: reads must leave no trace.
 */
export async function resolveRequester(request: FastifyRequest): Promise<Requester> {
  const customer = await getCustomerForSessionToken(request.cookies[SESSION_COOKIE_NAME]);
  if (customer) {
    return { customer, owner: { kind: "customer", customerId: customer.id }, guestToken: undefined };
  }

  const guestToken = request.cookies[ORDER_COOKIE_NAME];
  return {
    customer: null,
    owner: guestToken ? { kind: "guest", tokenHash: hashSessionToken(guestToken) } : null,
    guestToken,
  };
}
