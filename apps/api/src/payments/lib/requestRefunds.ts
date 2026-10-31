import { and, eq, inArray } from "drizzle-orm";

import { payments } from "../../db/schema.js";
import type { DbHandle } from "../../inventory/lib/inventoryRepo.js";
import type { PaymentGateway } from "./gatewayClient.js";

type Log = {
  error: (object: unknown, message: string) => void;
};

/**
 * Asks the gateway to refund each payment that is `refund_pending`, then marks
 * it `refunded`. Runs after the event's transaction has committed, because the
 * gateway call is an `await` and a SQLite transaction must not span one.
 *
 * Never throws: the event that led here was handled correctly, and a gateway
 * outage must not turn that into a failed webhook. A payment whose refund
 * fails simply stays `refund_pending` (logged). The idempotency key means a
 * later retry can't refund twice. There is no retry job yet (spec: known gap).
 */
export async function requestRefunds(
  db: DbHandle,
  gateway: PaymentGateway,
  paymentIds: number[],
  log: Log,
): Promise<void> {
  if (paymentIds.length === 0) return;

  const rows = db
    .select({ id: payments.id, intentId: payments.gatewayIntentId })
    .from(payments)
    .where(and(inArray(payments.id, paymentIds), eq(payments.status, "refund_pending")))
    .all();

  for (const row of rows) {
    try {
      if (row.intentId === null) {
        throw new Error(`Payment ${row.id} has no gateway intent id`);
      }

      const refund = await gateway.refund({
        paymentIntentId: row.intentId,
        idempotencyKey: `refund-${row.id}`,
      });

      db.update(payments)
        .set({ status: "refunded", refundId: refund.id, updatedAt: new Date() })
        .where(and(eq(payments.id, row.id), eq(payments.status, "refund_pending")))
        .run();
    } catch (error) {
      log.error(error, `Refund for payment ${row.id} failed; it stays refund_pending`);
    }
  }
}
