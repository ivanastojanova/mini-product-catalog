import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { sessionCookieOptions } from "../../auth/lib/sessionConfig.js";
import { db } from "../../db/client.js";
import { orders } from "../../db/schema.js";
import { desc, eq } from "drizzle-orm";
import { applyTransition } from "../lib/applyTransition.js";
import { sweepExpiredOrders } from "../lib/expireStaleOrders.js";
import { ORDER_COOKIE_DURATION_MS, ORDER_COOKIE_NAME } from "../lib/orderConfig.js";
import { getOrderDto } from "../lib/orderDto.js";
import { findOwnedOrderId } from "../lib/ownedOrder.js";
import { resolveRequester } from "../lib/resolveRequester.js";

type OrderParams = { publicId: string };

const NOT_FOUND = { message: "Order not found" };

/** A guest's cookie lives on while they keep looking at their orders, same as the cart cookie. */
function refreshGuestCookie(reply: FastifyReply, guestToken: string | undefined) {
  if (guestToken) {
    reply.setCookie(ORDER_COOKIE_NAME, guestToken, {
      ...sessionCookieOptions,
      maxAge: ORDER_COOKIE_DURATION_MS / 1000,
    });
  }
}

/**
 * GET /orders
 * The logged-in customer's orders, newest first. Customer-only: guests have no
 * list (they reach an order through its page in the browser that placed it),
 * so anyone without a valid session gets 401.
 */
export async function listOrdersHandler(request: FastifyRequest, reply: FastifyReply) {
  const { customer } = await resolveRequester(request);
  if (!customer) {
    return reply.code(401).send({ message: "Log in to see your orders" });
  }

  sweepExpiredOrders(db, request.log);

  const rows = db
    .select({ id: orders.id })
    .from(orders)
    .where(eq(orders.customerId, customer.id))
    .orderBy(desc(orders.createdAt), desc(orders.id))
    .all();

  return reply
    .code(200)
    .header("Cache-Control", "no-store")
    .send({ orders: rows.map((row) => getOrderDto(db, row.id)) });
}

/**
 * GET /orders/:publicId
 * One order, for its owner only. Not found and not yours are both 404 so the
 * response never reveals whether a public id exists. For a guest, the matching
 * `order_token` cookie is required: the id in the URL is only a lookup key.
 */
export async function getOrderHandler(
  request: FastifyRequest<{ Params: OrderParams }>,
  reply: FastifyReply,
) {
  const requester = await resolveRequester(request);
  sweepExpiredOrders(db, request.log);

  const orderId = requester.owner
    ? findOwnedOrderId(db, request.params.publicId, requester.owner)
    : null;
  if (orderId === null) {
    return reply.code(404).send(NOT_FOUND);
  }

  refreshGuestCookie(reply, requester.guestToken);

  return reply.code(200).header("Cache-Control", "no-store").send({ order: getOrderDto(db, orderId) });
}

/**
 * POST /orders/:publicId/cancel
 * Releases the reservation and moves `pending_payment -> cancelled`. Bodiless
 * (no JSON content-type), like the cart's DELETE. Idempotent: cancelling an
 * already-cancelled order returns it again. A paid, fulfilled or expired order
 * can't be cancelled (409), and the cart is not restored.
 */
export async function cancelOrderHandler(
  request: FastifyRequest<{ Params: OrderParams }>,
  reply: FastifyReply,
) {
  const requester = await resolveRequester(request);
  sweepExpiredOrders(db, request.log);

  const orderId = requester.owner
    ? findOwnedOrderId(db, request.params.publicId, requester.owner)
    : null;
  if (orderId === null) {
    return reply.code(404).send(NOT_FOUND);
  }

  const before = getOrderDto(db, orderId).status;
  if (before !== "pending_payment" && before !== "cancelled") {
    return reply.code(409).send({
      code: "not_cancellable",
      message: `An order that is ${before.replace("_", " ")} can't be cancelled.`,
      order: getOrderDto(db, orderId),
    });
  }

  applyTransition(db, orderId, "cancel", "cancelled by shopper");
  refreshGuestCookie(reply, requester.guestToken);

  return reply.code(200).send({ order: getOrderDto(db, orderId) });
}

export function registerOrderRoutes(app: FastifyInstance) {
  app.get("/orders", listOrdersHandler);
  app.get("/orders/:publicId", getOrderHandler);
  app.post("/orders/:publicId/cancel", cancelOrderHandler);
}
