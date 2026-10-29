import { and, eq } from "drizzle-orm";

import { orderEvents, orderItems, orders } from "../../db/schema.js";
import { commitStock, releaseStock, type DbHandle } from "../../inventory/lib/inventoryRepo.js";
import {
  transition,
  targetOf,
  type OrderEvent,
  type OrderStatus,
} from "./orderStateMachine.js";

export class OrderNotFoundError extends Error {
  constructor(readonly orderId: number) {
    super(`Order ${orderId} not found`);
    this.name = "OrderNotFoundError";
  }
}

export type TransitionOutcome =
  | { outcome: "applied"; from: OrderStatus; to: OrderStatus }
  | { outcome: "already"; status: OrderStatus };

/**
 * The only code allowed to write `orders.status`. In one transaction (a
 * savepoint when the caller already has one) it:
 *
 * 1. reads the order's current status;
 * 2. if the order is already in the event's target state, does nothing and
 *    reports `already` - so a retried webhook or a double click is safe;
 * 3. otherwise asks the pure state machine (throws `IllegalTransitionError`
 *    for a move it doesn't allow, leaving everything untouched);
 * 4. flips the status with `WHERE status = <the one we read>`, so a competing
 *    change can't be overwritten;
 * 5. moves stock for that edge: pay commits the hold into a sale,
 *    cancel/expire release it, fulfil touches nothing;
 * 6. appends the `order_events` audit row.
 *
 * Stock only moves if the status change did, and both roll back together, so
 * a hold is released or committed at most once however often this is called.
 */
export function applyTransition(
  db: DbHandle,
  orderId: number,
  event: OrderEvent,
  reason?: string,
): TransitionOutcome {
  return db.transaction((tx) => {
    const order = tx
      .select({ status: orders.status })
      .from(orders)
      .where(eq(orders.id, orderId))
      .get();

    if (!order) {
      throw new OrderNotFoundError(orderId);
    }

    const from = order.status as OrderStatus;

    if (from === targetOf(event)) {
      return { outcome: "already", status: from } as const;
    }

    const to = transition(from, event);
    const now = new Date();

    const { changes } = tx
      .update(orders)
      .set({ status: to, updatedAt: now, ...(to === "paid" ? { paidAt: now } : {}) })
      .where(and(eq(orders.id, orderId), eq(orders.status, from)))
      .run();

    if (changes === 0) {
      throw new Error(`Order ${orderId} changed state while applying "${event}"; retry`);
    }

    const lines = tx
      .select({ slug: orderItems.productSlug, quantity: orderItems.quantity })
      .from(orderItems)
      .where(eq(orderItems.orderId, orderId))
      .all();

    if (from === "pending_payment") {
      if (to === "paid") {
        commitStock(tx, lines);
      } else {
        releaseStock(tx, lines);
      }
    }

    tx.insert(orderEvents)
      .values({ orderId, fromStatus: from, toStatus: to, reason: reason ?? null })
      .run();

    return { outcome: "applied", from, to } as const;
  });
}
