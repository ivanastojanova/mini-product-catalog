import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { SESSION_COOKIE_NAME } from "../../auth/lib/sessionConfig.js";
import { CART_COOKIE_NAME } from "../../cart/lib/cartConfig.js";
import { getProductsBySlugs } from "../../cart/lib/cmsClient.js";
import { getCartLines } from "../../cart/lib/cartRepo.js";
import { resolveCart } from "../../cart/lib/resolveCart.js";
import { db } from "../../db/client.js";
import { getAvailability } from "../../inventory/lib/inventoryRepo.js";
import { sweepExpiredOrders } from "../lib/expireStaleOrders.js";
import { priceCart } from "../lib/priceCart.js";

/** Locales the CMS has titles for. Duplicated from the CMS on purpose (separate deploys, ADR 0001); anything else falls back to English. */
const SUPPORTED_LOCALES = ["en", "de"];
const DEFAULT_LOCALE = "en";

type PreviewQuery = { locale?: string };

/**
 * GET /checkout/preview?locale=en|de
 * The current visitor's cart (guest or customer) priced the way an order would
 * be: live CMS prices in integer cents, per-line availability, and a `problem`
 * on any line that couldn't be bought right now. The checkout page renders this,
 * and `POST /orders` prices with the same `priceCart`, so what the shopper
 * reviews is what gets charged. Read-only: no cart row, hold or cookie is created.
 *
 * `locale` only changes titles (display); it is never stored.
 */
export async function checkoutPreviewHandler(
  request: FastifyRequest<{ Querystring: PreviewQuery }>,
  reply: FastifyReply,
) {
  const locale = SUPPORTED_LOCALES.includes(request.query.locale ?? "")
    ? (request.query.locale as string)
    : DEFAULT_LOCALE;

  sweepExpiredOrders(db, request.log);

  const resolved = await resolveCart({
    sessionToken: request.cookies[SESSION_COOKIE_NAME],
    cartToken: request.cookies[CART_COOKIE_NAME],
  });
  const cartId = resolved.kind === "none" ? null : resolved.cartId;
  const lines = cartId === null ? [] : await getCartLines(cartId);

  let products;
  try {
    products = await getProductsBySlugs(
      lines.map((line) => line.slug),
      locale,
    );
  } catch (error) {
    request.log.error(error, "CMS product lookup failed");
    return reply.code(502).send({ message: "Could not load product prices. Please try again." });
  }

  const priced = priceCart(
    lines,
    products,
    getAvailability(
      db,
      lines.map((line) => line.slug),
    ),
  );

  if (!priced.ok) {
    return reply.code(409).send({
      code: priced.reason,
      message: "Your cart contains items in different currencies and can't be checked out together.",
    });
  }

  return reply
    .code(200)
    .header("Cache-Control", "no-store")
    .send({
      currency: priced.currency,
      items: priced.items,
      subtotalCents: priced.subtotalCents,
    });
}

export function registerCheckoutRoutes(app: FastifyInstance) {
  app.get("/checkout/preview", checkoutPreviewHandler);
}
