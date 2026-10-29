import { and, eq, lte } from "drizzle-orm";

import { orders } from "../../db/schema.js";
import type { DbHandle } from "../../inventory/lib/inventoryRepo.js";
import { applyTransition } from "./applyTransition.js";

export type ExpireSweepResult = {
  expired: number[];
  failed: Array<{ orderId: number; error: unknown }>;
};

/**
 * Lazy expiry (no background job): expires every `pending_payment` order whose
 * reservation deadline has passed, releasing its stock. Called at the start of
 * every request that reads availability or orders, so a stale hold never counts
 * against stock.
 *
 * Each order is its own transaction, so one order that can't be expired (say,
 * a missing inventory row) is reported in `failed` and skipped instead of
 * blocking every stock read behind it. Sweeping twice releases once: the
 * second pass finds nothing pending.
 */
export function expireStaleOrders(db: DbHandle, now: Date = new Date()): ExpireSweepResult {
  const stale = db
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.status, "pending_payment"), lte(orders.reservationExpiresAt, now)))
    .orderBy(orders.id)
    .all();

  const result: ExpireSweepResult = { expired: [], failed: [] };

  for (const { id } of stale) {
    try {
      const outcome = applyTransition(db, id, "expire", "reservation expired");
      if (outcome.outcome === "applied") {
        result.expired.push(id);
      }
    } catch (error) {
      result.failed.push({ orderId: id, error });
    }
  }

  return result;
}

/**
 * `expireStaleOrders` for request handlers: a sweep problem is logged, never
 * thrown. Stock and orders can still be answered, just possibly with a stale
 * hold still counted, which is better than failing the whole request.
 */
export function sweepExpiredOrders(
  db: DbHandle,
  log: { error: (error: unknown, message: string) => void },
): void {
  try {
    for (const failure of expireStaleOrders(db).failed) {
      log.error(failure.error, `Could not expire order ${failure.orderId}`);
    }
  } catch (error) {
    log.error(error, "Expired-order sweep failed");
  }
}
