import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { getCustomerForSessionToken } from "../../auth/lib/getSession.js";
import { generateSessionToken, hashSessionToken } from "../../auth/lib/session.js";
import { SESSION_COOKIE_NAME, sessionCookieOptions } from "../../auth/lib/sessionConfig.js";
import { CART_COOKIE_NAME } from "../../cart/lib/cartConfig.js";
import { getCartLines } from "../../cart/lib/cartRepo.js";
import { getProductsBySlugs } from "../../cart/lib/cmsClient.js";
import { resolveCart } from "../../cart/lib/resolveCart.js";
import { db } from "../../db/client.js";
import { getAvailability } from "../../inventory/lib/inventoryRepo.js";
import { createOrder, findOrderByIdempotencyKey } from "../lib/createOrder.js";
import { sweepExpiredOrders } from "../lib/expireStaleOrders.js";
import { getOrderDto } from "../lib/orderDto.js";
import {
  ORDER_COOKIE_DURATION_MS,
  ORDER_COOKIE_NAME,
  reservationTtlMs,
} from "../lib/orderConfig.js";
import { orderBelongsTo, type OrderOwner } from "../lib/orderOwner.js";
import { priceCart } from "../lib/priceCart.js";
import { validateOrderInput } from "../lib/validateOrderInput.js";

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

/** Orders are priced in the CMS default locale: the title is snapshotted, so it must not depend on the shopper's UI language. */
const SNAPSHOT_LOCALE = "en";

function setOrderCookie(reply: FastifyReply, rawToken: string) {
  reply.setCookie(ORDER_COOKIE_NAME, rawToken, {
    ...sessionCookieOptions,
    maxAge: ORDER_COOKIE_DURATION_MS / 1000,
  });
}

/**
 * POST /orders
 * Header: Idempotency-Key (8-128 chars of [A-Za-z0-9_-], e.g. a UUID).
 * Body: { shippingAddress: { name, line1, line2?, city, postalCode, country }, email? }
 * `email` is required for guests and ignored for customers (their account
 * email is used). Prices, titles, totals and currency are NEVER read from the
 * body: they come from the CMS, via the same `priceCart` the preview uses.
 *
 * Who is ordering: a valid session wins (the order belongs to the customer,
 * and any order_token cookie is ignored). Otherwise the browser is a guest
 * identified by the `order_token` cookie, minted here on first use and only
 * ever set on success, so a rejected request leaves no trace.
 *
 * 201 `{ order }` on creation, 200 `{ order }` for an idempotent replay.
 * 409 codes: empty_cart, unavailable_items, insufficient_stock, mixed_currency,
 * open_order (+ orderPublicId), key_conflict, cart_changed (retry).
 */
export async function createOrderHandler(request: FastifyRequest, reply: FastifyReply) {
  const key = request.headers["idempotency-key"];
  if (typeof key !== "string" || !IDEMPOTENCY_KEY_PATTERN.test(key)) {
    return reply.code(400).send({
      message: "An Idempotency-Key header of 8-128 letters, digits, '-' or '_' is required",
    });
  }

  const customer = await getCustomerForSessionToken(request.cookies[SESSION_COOKIE_NAME]);

  const existingGuestToken = customer ? undefined : request.cookies[ORDER_COOKIE_NAME];
  const guestToken = customer ? undefined : (existingGuestToken ?? generateSessionToken());
  const owner: OrderOwner = customer
    ? { kind: "customer", customerId: customer.id }
    : { kind: "guest", tokenHash: hashSessionToken(guestToken!) };

  const validated = validateOrderInput(request.body, !customer);
  if (!validated.ok) {
    return reply.code(400).send({ message: validated.error.message, field: validated.error.field });
  }

  const replayed = findOrderByIdempotencyKey(db, key);
  if (replayed) {
    if (!orderBelongsTo(replayed, owner)) {
      return reply.code(409).send({ code: "key_conflict", message: "This Idempotency-Key was already used." });
    }
    if (guestToken) setOrderCookie(reply, guestToken);
    return reply.code(200).send({ order: getOrderDto(db, replayed.id) });
  }

  sweepExpiredOrders(db, request.log);

  const resolved = await resolveCart({
    sessionToken: request.cookies[SESSION_COOKIE_NAME],
    cartToken: request.cookies[CART_COOKIE_NAME],
  });
  const cartId = resolved.kind === "none" ? null : resolved.cartId;
  const lines = cartId === null ? [] : await getCartLines(cartId);

  if (cartId === null || lines.length === 0) {
    return reply.code(409).send({ code: "empty_cart", message: "Your cart is empty." });
  }

  let products;
  try {
    products = await getProductsBySlugs(
      lines.map((line) => line.slug),
      SNAPSHOT_LOCALE,
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

  const unavailable = priced.items.filter((item) => item.problem === "unknown_product");
  if (unavailable.length > 0) {
    return reply.code(409).send({
      code: "unavailable_items",
      message: "Some items in your cart are no longer available.",
      items: unavailable.map((item) => item.slug),
    });
  }

  const result = createOrder(db, {
    owner,
    cartId,
    idempotencyKey: key,
    contactEmail: customer ? customer.email : validated.value.email!,
    shippingAddress: validated.value.shippingAddress,
    currency: priced.currency!,
    lines: priced.items,
    reservationTtlMs: reservationTtlMs(),
  });

  if (!result.ok) {
    switch (result.code) {
      case "insufficient_stock":
        return reply.code(409).send({
          code: "insufficient_stock",
          message: "Some items are no longer available in the quantity you asked for.",
          items: result.items,
        });
      case "open_order":
        return reply.code(409).send({
          code: "open_order",
          message: "You already have an unpaid order. Pay for or cancel it first.",
          orderPublicId: result.orderPublicId,
        });
      case "key_conflict":
        return reply.code(409).send({ code: "key_conflict", message: "This Idempotency-Key was already used." });
      case "cart_changed":
        return reply.code(409).send({
          code: "cart_changed",
          message: "Your cart changed while ordering. Please review it and try again.",
        });
    }
  }

  if (guestToken) setOrderCookie(reply, guestToken);

  return reply.code(result.replay ? 200 : 201).send({ order: getOrderDto(db, result.orderId) });
}

export function registerCreateOrderRoute(app: FastifyInstance) {
  app.post("/orders", createOrderHandler);
}
