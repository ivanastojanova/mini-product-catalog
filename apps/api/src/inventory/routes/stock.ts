import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { db } from "../../db/client.js";
import { MAX_STOCK_BATCH_SLUGS, MAX_STOCK_SLUG_LENGTH } from "../lib/inventoryConfig.js";
import { getAvailability, getStockLevel } from "../lib/inventoryRepo.js";
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

type StockBatchQuery = { slugs?: string };

/**
 * GET /stock?slugs=a,b,c
 * Public batch form of the single-slug read, for the storefront's live filters
 * (in stock, minimum quantity) so it needs one call, not one per product.
 * Same semantics as `GET /stock/:slug`: `quantity` is available units, an
 * unknown slug is 0 rather than an error, expired holds are swept first, and
 * the response is never cached. Duplicates are collapsed; order follows the
 * first appearance in the request. More than MAX_STOCK_BATCH_SLUGS distinct
 * slugs is a 400 rather than a silent truncation, which would look like
 * "out of stock" to the caller.
 */
export async function getStockBatchHandler(
  request: FastifyRequest<{ Querystring: StockBatchQuery }>,
  reply: FastifyReply,
) {
  const raw = request.query.slugs;
  if (typeof raw !== "string") {
    return reply.code(400).send({ message: "slugs must be a comma-separated list" });
  }

  const slugs = [
    ...new Set(
      raw
        .split(",")
        .map((slug) => slug.trim())
        .filter((slug) => slug.length > 0),
    ),
  ];

  if (slugs.length === 0) {
    return reply.code(400).send({ message: "At least one product slug is required" });
  }
  if (slugs.length > MAX_STOCK_BATCH_SLUGS) {
    return reply
      .code(400)
      .send({ message: `At most ${MAX_STOCK_BATCH_SLUGS} slugs per request` });
  }
  if (slugs.some((slug) => slug.length > MAX_STOCK_SLUG_LENGTH)) {
    return reply.code(400).send({ message: "A product slug is too long" });
  }

  sweepExpiredOrders(db, request.log);

  const available = getAvailability(db, slugs);

  return reply
    .code(200)
    .header("Cache-Control", "no-store")
    .send({
      items: slugs.map((slug) => {
        const quantity = available.get(slug) ?? 0;
        return { slug, inStock: quantity > 0, quantity };
      }),
    });
}

export function registerStockRoutes(app: FastifyInstance) {
  app.get("/stock", getStockBatchHandler);
  app.get("/stock/:slug", getStockHandler);
}
