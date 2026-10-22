import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { SESSION_COOKIE_NAME, sessionCookieOptions } from "../../auth/lib/sessionConfig.js";
import { MAX_LINE_QUANTITY } from "../../db/schema.js";
import {
  addToLine,
  ensureCart,
  getCartLines,
  removeLine,
  setLineQuantity,
} from "../lib/cartRepo.js";
import { CART_COOKIE_NAME, GUEST_CART_DURATION_MS } from "../lib/cartConfig.js";
import { productExists } from "../lib/cmsClient.js";
import { resolveCart, type ResolvedCart } from "../lib/resolveCart.js";

const MAX_SLUG_LENGTH = 200;

type AddItemBody = { slug?: unknown; quantity?: unknown };
type SetQuantityBody = { quantity?: unknown };
type LineParams = { slug: string };

const QUANTITY_MESSAGE = `Quantity must be a whole number between 1 and ${MAX_LINE_QUANTITY}`;

function isValidQuantity(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= MAX_LINE_QUANTITY
  );
}

function isValidSlug(slug: string): boolean {
  return slug.length > 0 && slug.length <= MAX_SLUG_LENGTH;
}

/** Guests get the cookie on creation and a refreshed maxAge on every later write, so an active cart doesn't expire under the shopper. */
function refreshGuestCookie(
  request: FastifyRequest,
  reply: FastifyReply,
  resolved: ResolvedCart,
  newGuestToken?: string,
) {
  const guestToken =
    newGuestToken ?? (resolved.kind === "guest" ? request.cookies[CART_COOKIE_NAME] : undefined);
  if (guestToken) {
    reply.setCookie(CART_COOKIE_NAME, guestToken, {
      ...sessionCookieOptions,
      maxAge: GUEST_CART_DURATION_MS / 1000,
    });
  }
}

function resolveFromRequest(request: FastifyRequest) {
  return resolveCart({
    sessionToken: request.cookies[SESSION_COOKIE_NAME],
    cartToken: request.cookies[CART_COOKIE_NAME],
  });
}

/**
 * GET /cart
 * The current visitor's cart lines. A visitor with no cart gets an empty list
 * — this never creates a row or sets a cookie.
 */
export async function getCartHandler(request: FastifyRequest, reply: FastifyReply) {
  const resolved = await resolveFromRequest(request);
  const cartId = resolved.kind === "none" ? null : resolved.cartId;

  return reply.code(200).send({ items: cartId === null ? [] : await getCartLines(cartId) });
}

/**
 * POST /cart/items
 * Body: { slug, quantity? = 1 }. Increments the line (clamped at
 * MAX_LINE_QUANTITY). The slug is validated against the CMS *before* any cart
 * row or cookie is created, so a bad slug leaves no trace.
 */
export async function addItemHandler(
  request: FastifyRequest<{ Body: AddItemBody }>,
  reply: FastifyReply,
) {
  const slug = typeof request.body?.slug === "string" ? request.body.slug.trim() : "";
  const quantity = request.body?.quantity === undefined ? 1 : request.body.quantity;

  if (!isValidSlug(slug)) {
    return reply.code(400).send({ message: "A valid product slug is required" });
  }
  if (!isValidQuantity(quantity)) {
    return reply.code(400).send({ message: QUANTITY_MESSAGE });
  }

  let exists: boolean;
  try {
    exists = await productExists(slug);
  } catch (error) {
    request.log.error(error, "CMS product lookup failed");
    return reply.code(502).send({ message: "Could not verify the product. Please try again." });
  }
  if (!exists) {
    return reply.code(404).send({ message: "Product not found" });
  }

  const resolved = await resolveFromRequest(request);
  const { cartId, newGuestToken } = await ensureCart(resolved);
  const newQuantity = await addToLine(cartId, slug, quantity);

  refreshGuestCookie(request, reply, resolved, newGuestToken);

  return reply.code(200).send({ slug, quantity: newQuantity });
}

/**
 * PUT /cart/items/:slug
 * Body: { quantity } (1..MAX_LINE_QUANTITY). Sets the line to an absolute
 * value, so retrying is safe. Only updates lines already in the cart (404
 * otherwise) — creating a line is POST's job, which is also where the CMS
 * slug check lives. Use DELETE to remove a line; 0 is not a valid quantity.
 */
export async function setItemQuantityHandler(
  request: FastifyRequest<{ Params: LineParams; Body: SetQuantityBody }>,
  reply: FastifyReply,
) {
  const slug = request.params.slug.trim();
  const quantity = request.body?.quantity;

  if (!isValidSlug(slug)) {
    return reply.code(400).send({ message: "A valid product slug is required" });
  }
  if (!isValidQuantity(quantity)) {
    return reply.code(400).send({ message: QUANTITY_MESSAGE });
  }

  const resolved = await resolveFromRequest(request);
  const cartId = resolved.kind === "none" ? null : resolved.cartId;
  const updated = cartId !== null && (await setLineQuantity(cartId, slug, quantity));
  if (!updated) {
    return reply.code(404).send({ message: "Item is not in the cart" });
  }

  refreshGuestCookie(request, reply, resolved);

  return reply.code(200).send({ slug, quantity });
}

/**
 * DELETE /cart/items/:slug
 * Removes a line. Idempotent: always 204, whether or not the line (or the
 * whole cart) existed, so a retried or double-clicked remove is harmless.
 */
export async function removeItemHandler(
  request: FastifyRequest<{ Params: LineParams }>,
  reply: FastifyReply,
) {
  const slug = request.params.slug.trim();
  if (!isValidSlug(slug)) {
    return reply.code(400).send({ message: "A valid product slug is required" });
  }

  const resolved = await resolveFromRequest(request);
  if (resolved.kind !== "none" && resolved.cartId !== null) {
    await removeLine(resolved.cartId, slug);
    refreshGuestCookie(request, reply, resolved);
  }

  return reply.code(204).send();
}

export function registerCartRoutes(app: FastifyInstance) {
  app.get("/cart", getCartHandler);
  app.post("/cart/items", addItemHandler);
  app.put("/cart/items/:slug", setItemQuantityHandler);
  app.delete("/cart/items/:slug", removeItemHandler);
}
