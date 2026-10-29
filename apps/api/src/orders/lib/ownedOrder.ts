import { eq } from "drizzle-orm";

import { orders } from "../../db/schema.js";
import type { DbHandle } from "../../inventory/lib/inventoryRepo.js";
import { orderBelongsTo, type OrderOwner } from "./orderOwner.js";

/**
 * The internal id of the order with this public id, but only if `owner` owns
 * it. An order that doesn't exist and an order that belongs to someone else
 * both return null, so callers answer 404 for both and never reveal which.
 */
export function findOwnedOrderId(db: DbHandle, publicId: string, owner: OrderOwner): number | null {
  const order = db
    .select({ id: orders.id, customerId: orders.customerId, guestTokenHash: orders.guestTokenHash })
    .from(orders)
    .where(eq(orders.publicId, publicId))
    .get();

  return order && orderBelongsTo(order, owner) ? order.id : null;
}
