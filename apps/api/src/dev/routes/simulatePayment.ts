import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { db } from "../../db/client.js";
import { applyTransition } from "../../orders/lib/applyTransition.js";
import { sweepExpiredOrders } from "../../orders/lib/expireStaleOrders.js";
import { getOrderDto } from "../../orders/lib/orderDto.js";
import { IllegalTransitionError } from "../../orders/lib/orderStateMachine.js";
import { findOwnedOrderId } from "../../orders/lib/ownedOrder.js";
import { resolveRequester } from "../../orders/lib/resolveRequester.js";

type OrderParams = { publicId: string };

/**
 * POST /dev/orders/:publicId/simulate-payment
 * Dev-only stand-in for a payment provider's "payment succeeded" webhook, so
 * checkout can be clicked through before Phase 5. Same ownership rule as every
 * other order route (404 for a missing or foreign order). Sweeps first, so an
 * order whose hold already lapsed is refused (409) rather than paid with
 * stock someone else may now own. Paying twice is a no-op (200).
 */
export async function simulatePaymentHandler(
  request: FastifyRequest<{ Params: OrderParams }>,
  reply: FastifyReply,
) {
  const requester = await resolveRequester(request);
  sweepExpiredOrders(db, request.log);

  const orderId = requester.owner
    ? findOwnedOrderId(db, request.params.publicId, requester.owner)
    : null;
  if (orderId === null) {
    return reply.code(404).send({ message: "Order not found" });
  }

  try {
    applyTransition(db, orderId, "pay", "simulated payment (dev)");
  } catch (error) {
    if (error instanceof IllegalTransitionError) {
      return reply.code(409).send({
        code: "not_payable",
        message: `An order that is ${error.from.replace("_", " ")} can't be paid.`,
        order: getOrderDto(db, orderId),
      });
    }
    throw error;
  }

  return reply.code(200).send({ order: getOrderDto(db, orderId) });
}

/**
 * Registers nothing in production: a route that marks any order paid must not
 * exist there, not merely be guarded. Phase 5 replaces this with the real
 * payment webhook and deletes this file.
 */
export function registerSimulatePaymentRoute(app: FastifyInstance) {
  if (process.env.NODE_ENV === "production") return;
  app.post("/dev/orders/:publicId/simulate-payment", simulatePaymentHandler);
}
