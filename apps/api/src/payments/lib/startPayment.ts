import { and, desc, eq, isNull } from "drizzle-orm";

import { orders, payments } from "../../db/schema.js";
import type { DbHandle } from "../../inventory/lib/inventoryRepo.js";
import type { PaymentGateway } from "./gatewayClient.js";

export type StartPaymentResult =
  | { outcome: "started"; payUrl: string }
  | { outcome: "not_payable"; status: string }
  | { outcome: "gateway_error" };

type Log = { error: (object: unknown, message: string) => void };

type StartPaymentInput = {
  orderId: number;
  /** Where the gateway sends the shopper back to. */
  returnUrl: string;
  /** Part of the gateway idempotency key: the same attempt in another language is a different request. */
  lang: string;
  /** Base of the pay page as the BROWSER reaches it (not necessarily the URL apps/api calls). */
  gatewayPublicUrl: string;
};

const payUrlFor = (base: string, intentId: string) => `${base.replace(/\/+$/, "")}/pay/${intentId}`;

/**
 * Begins (or resumes) a payment attempt for an unpaid order.
 *
 * - The amount and currency come from the ORDER row, never from the request.
 * - Only a `pending_payment` order can start one.
 * - A `pending` attempt that already has an intent is reused, so a double click
 *   or a refresh shows the same pay page instead of opening a second charge.
 * - Otherwise a `pending` row is inserted first (the partial unique index
 *   allows one per order), THEN the gateway is called. That call is an `await`,
 *   so it happens outside any transaction. The gateway idempotency key is
 *   derived from the row, so retrying after a lost response finds the same
 *   intent instead of creating another.
 * - If the gateway call fails, a row this call created is deleted; the shopper
 *   can simply press Pay again.
 * - After a `failed` attempt this creates a fresh one.
 */
export async function startPayment(
  db: DbHandle,
  gateway: PaymentGateway,
  input: StartPaymentInput,
  log: Log,
): Promise<StartPaymentResult> {
  const order = db
    .select({
      id: orders.id,
      publicId: orders.publicId,
      status: orders.status,
      totalCents: orders.totalCents,
      currency: orders.currency,
    })
    .from(orders)
    .where(eq(orders.id, input.orderId))
    .get();

  if (!order) throw new Error(`Order ${input.orderId} not found`);
  if (order.status !== "pending_payment") return { outcome: "not_payable", status: order.status };

  let attempt = db
    .select({ id: payments.id, intentId: payments.gatewayIntentId })
    .from(payments)
    .where(and(eq(payments.orderId, order.id), eq(payments.status, "pending")))
    .get();

  if (attempt?.intentId) {
    return { outcome: "started", payUrl: payUrlFor(input.gatewayPublicUrl, attempt.intentId) };
  }

  let createdHere = false;
  if (!attempt) {
    const [row] = db
      .insert(payments)
      .values({ orderId: order.id, amountCents: order.totalCents, currency: order.currency, status: "pending" })
      .returning({ id: payments.id })
      .all();
    attempt = { id: row.id, intentId: null };
    createdHere = true;
  }

  const attemptId = attempt.id;
  const discardIfCreatedHere = () => {
    if (createdHere) {
      db.delete(payments)
        .where(and(eq(payments.id, attemptId), isNull(payments.gatewayIntentId)))
        .run();
    }
  };

  let intentId: string;
  try {
    ({ id: intentId } = await gateway.createPaymentIntent({
      amountCents: order.totalCents,
      currency: order.currency,
      orderId: order.publicId,
      returnUrl: input.returnUrl,
      idempotencyKey: `payment-${attemptId}-${input.lang}`,
    }));
  } catch (error) {
    log.error(error, `Could not create a gateway payment intent for order ${order.publicId}`);
    discardIfCreatedHere();
    return { outcome: "gateway_error" };
  }

  // Only if the row still exists and has no intent yet. If it vanished (a concurrent
  // request failed and cleaned up) the shopper must not be sent to pay an
  // intent no payment row knows about: the webhook would ignore the money.
  const { changes } = db
    .update(payments)
    .set({ gatewayIntentId: intentId, updatedAt: new Date() })
    .where(and(eq(payments.id, attemptId), isNull(payments.gatewayIntentId)))
    .run();

  if (changes === 0) {
    const current = db
      .select({ intentId: payments.gatewayIntentId })
      .from(payments)
      .where(and(eq(payments.id, attemptId), eq(payments.status, "pending")))
      .get();
    if (current?.intentId) {
      return { outcome: "started", payUrl: payUrlFor(input.gatewayPublicUrl, current.intentId) };
    }
    log.error({ attemptId }, "payment row disappeared while its intent was being created");
    return { outcome: "gateway_error" };
  }

  return { outcome: "started", payUrl: payUrlFor(input.gatewayPublicUrl, intentId) };
}

/** The most recent attempt for an order, or null. Used by the order DTO. */
export function latestPaymentStatus(db: DbHandle, orderId: number): string | null {
  const row = db
    .select({ status: payments.status })
    .from(payments)
    .where(eq(payments.orderId, orderId))
    .orderBy(desc(payments.id))
    .limit(1)
    .get();
  return row?.status ?? null;
}
