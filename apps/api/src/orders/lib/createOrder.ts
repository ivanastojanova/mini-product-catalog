import { and, eq, inArray } from "drizzle-orm";
import { randomBytes } from "node:crypto";

import { cartItems, carts, orderEvents, orderItems, orders } from "../../db/schema.js";
import { reserveStock, type DbHandle, type ShortLine } from "../../inventory/lib/inventoryRepo.js";
import { expireStaleOrders } from "./expireStaleOrders.js";
import { orderBelongsTo, type OrderOwner } from "./orderOwner.js";
import type { PricedLine } from "./priceCart.js";
import type { ShippingAddress } from "./validateOrderInput.js";

export type CreateOrderInput = {
  owner: OrderOwner;
  /** The cart whose lines are bought and then cleared. */
  cartId: number;
  idempotencyKey: string;
  contactEmail: string;
  shippingAddress: ShippingAddress;
  currency: string;
  /** Already priced from the CMS (never from the client). Every line must be free of problems except stock, which is re-checked here atomically. */
  lines: PricedLine[];
  reservationTtlMs: number;
  now?: Date;
};

export type CreateOrderResult =
  | { ok: true; orderId: number; replay: boolean }
  | { ok: false; code: "key_conflict" }
  | { ok: false; code: "open_order"; orderPublicId: string }
  | { ok: false; code: "insufficient_stock"; items: ShortLine[] }
  | { ok: false; code: "cart_changed" };

/** 16 random bytes, base64url: a lookup key in URLs, never a credential for guest orders. */
export function generatePublicOrderId(): string {
  return randomBytes(16).toString("base64url");
}

/**
 * Creates an order from an already-priced cart, in ONE synchronous
 * transaction, so the stock hold, the order rows and the cart clearing succeed
 * or fail together (better-sqlite3 transactions can't span an `await`, which is
 * why pricing and the CMS call happen before this).
 *
 * Inside the transaction, in order:
 * 1. sweep expired holds, so they don't count against this order;
 * 2. idempotency: the same key + same owner returns the existing order and
 *    reserves nothing; the same key from a different owner is a conflict (and
 *    is never answered with that order);
 * 3. one-open-order guard: an owner with an unpaid order can't create another;
 * 4. re-read the cart and require it to still match what was priced, so lines
 *    edited between pricing and now can't be bought at a stale price;
 * 5. reserve all lines or none (`insufficient_stock` lists the short ones);
 * 6. insert the order (snapshotting prices and address), its lines and the
 *    creation event, then delete the cart's lines. The cart row stays, so a
 *    guest's cart cookie remains valid.
 */
export function createOrder(db: DbHandle, input: CreateOrderInput): CreateOrderResult {
  const now = input.now ?? new Date();

  return db.transaction((tx) => {
    expireStaleOrders(tx, now);

    const existing = tx
      .select({
        id: orders.id,
        customerId: orders.customerId,
        guestTokenHash: orders.guestTokenHash,
      })
      .from(orders)
      .where(eq(orders.idempotencyKey, input.idempotencyKey))
      .get();

    if (existing) {
      return orderBelongsTo(existing, input.owner)
        ? { ok: true, orderId: existing.id, replay: true }
        : { ok: false, code: "key_conflict" };
    }

    const open = tx
      .select({ publicId: orders.publicId })
      .from(orders)
      .where(
        and(
          eq(orders.status, "pending_payment"),
          input.owner.kind === "customer"
            ? eq(orders.customerId, input.owner.customerId)
            : eq(orders.guestTokenHash, input.owner.tokenHash),
        ),
      )
      .get();

    if (open) {
      return { ok: false, code: "open_order", orderPublicId: open.publicId };
    }

    const cartNow = tx
      .select({ slug: cartItems.productSlug, quantity: cartItems.quantity })
      .from(cartItems)
      .where(eq(cartItems.cartId, input.cartId))
      .all();

    const priced = new Map(input.lines.map((line) => [line.slug, line.quantity]));
    const unchanged =
      cartNow.length === priced.size &&
      cartNow.every((line) => priced.get(line.slug) === line.quantity);

    if (!unchanged || input.lines.length === 0) {
      return { ok: false, code: "cart_changed" };
    }

    const reservation = reserveStock(
      tx,
      input.lines.map((line) => ({ slug: line.slug, quantity: line.quantity })),
    );
    if (!reservation.ok) {
      return { ok: false, code: "insufficient_stock", items: reservation.short };
    }

    const ship = input.shippingAddress;
    const order = tx
      .insert(orders)
      .values({
        publicId: generatePublicOrderId(),
        customerId: input.owner.kind === "customer" ? input.owner.customerId : null,
        guestTokenHash: input.owner.kind === "guest" ? input.owner.tokenHash : null,
        contactEmail: input.contactEmail,
        status: "pending_payment",
        currency: input.currency,
        totalCents: input.lines.reduce((sum, line) => sum + line.lineTotalCents, 0),
        shipName: ship.name,
        shipLine1: ship.line1,
        shipLine2: ship.line2,
        shipCity: ship.city,
        shipPostalCode: ship.postalCode,
        shipCountry: ship.country,
        idempotencyKey: input.idempotencyKey,
        reservationExpiresAt: new Date(now.getTime() + input.reservationTtlMs),
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: orders.id })
      .get();

    for (const line of input.lines) {
      tx.insert(orderItems)
        .values({
          orderId: order.id,
          productSlug: line.slug,
          title: line.title,
          unitPriceCents: line.unitPriceCents,
          quantity: line.quantity,
        })
        .run();
    }

    tx.insert(orderEvents)
      .values({ orderId: order.id, fromStatus: null, toStatus: "pending_payment", reason: "order created" })
      .run();

    tx.delete(cartItems)
      .where(
        and(
          eq(cartItems.cartId, input.cartId),
          inArray(
            cartItems.productSlug,
            input.lines.map((line) => line.slug),
          ),
        ),
      )
      .run();
    tx.update(carts).set({ updatedAt: now }).where(eq(carts.id, input.cartId)).run();

    return { ok: true, orderId: order.id, replay: false };
  });
}

/**
 * The order already created for this idempotency key, if any, with its owner
 * columns. The route checks this BEFORE looking at the cart: a successful
 * order empties the cart, so a retry would otherwise look like an empty cart.
 */
export function findOrderByIdempotencyKey(db: DbHandle, key: string) {
  return db
    .select({
      id: orders.id,
      customerId: orders.customerId,
      guestTokenHash: orders.guestTokenHash,
    })
    .from(orders)
    .where(eq(orders.idempotencyKey, key))
    .get();
}
