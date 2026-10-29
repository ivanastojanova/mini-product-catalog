import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { db } from "../../db/client.js";
import { getStockLevel } from "../lib/inventoryRepo.js";
import { sweepExpiredOrders } from "../../orders/lib/expireStaleOrders.js";

type StockParams = { slug: string };

/**
 * GET /stock/:slug
 * Public. `quantity` is *available* units (on hand minus held by unpaid
 * orders). A slug with no inventory row is reported as out of stock rather
 * than 404, so the product page never has a third state to render. Never
 * cached: a stale "3 in stock" is exactly the bug reservation exists to prevent.
 * Expired reservations are swept first, so a hold past its deadline never
 * counts against availability. A sweep failure is logged and the read goes on:
 * stock is still answerable, just possibly lower than it should be.
 */
export async function getStockHandler(
  request: FastifyRequest<{ Params: StockParams }>,
  reply: FastifyReply,
) {
  const slug = request.params.slug.trim();
  if (slug.length === 0) {
    return reply.code(400).send({ message: "A valid product slug is required" });
  }

  sweepExpiredOrders(db, request.log);

  const level = getStockLevel(db, slug);
  const quantity = level?.available ?? 0;

  return reply
    .code(200)
    .header("Cache-Control", "no-store")
    .send({
      slug,
      inStock: quantity > 0,
      quantity,
      updatedAt: (level?.updatedAt ?? new Date()).toISOString(),
    });
}

export function registerStockRoutes(app: FastifyInstance) {
  app.get("/stock/:slug", getStockHandler);
}
