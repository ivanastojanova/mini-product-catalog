import { eq } from "drizzle-orm";

import { orders, paymentEvents, payments } from "../../db/schema.js";
import type { DbHandle } from "../../inventory/lib/inventoryRepo.js";
import { applyTransition } from "../../orders/lib/applyTransition.js";
import { sweepExpiredOrders } from "../../orders/lib/expireStaleOrders.js";
import type { GatewayEvent } from "./gatewayEvent.js";

type Log = {
  error: (object: unknown, message: string) => void;
  warn: (object: unknown, message: string) => void;
};

export type PaymentEventResult =
  | { status: "duplicate" }
  | {
      status: "processed";
      outcome: "applied" | "ignored" | "refund_requested";
      note: string;
      /** Payments now `refund_pending`; the caller refunds them after the commit. */
      refundPaymentIds: number[];
    };

type IntentData = { intentId: string; amountCents: number; currency: string };

/** Pulls `data.object.{id, amount, currency}` out of an event, or null when any is missing or the wrong type. */
function readIntent(event: GatewayEvent): IntentData | null {
  const data = event.data;
  if (typeof data !== "object" || data === null) return null;
  const object = (data as Record<string, unknown>).object;
  if (typeof object !== "object" || object === null) return null;

  const { id, amount, currency } = object as Record<string, unknown>;
  if (typeof id !== "string" || id === "") return null;
  if (typeof amount !== "number" || !Number.isInteger(amount)) return null;
  if (typeof currency !== "string" || currency === "") return null;

  return { intentId: id, amountCents: amount, currency };
}

/**
 * Applies one verified gateway event, exactly once per event id.
 *
 * 1. Sweeps expired holds first, so an order whose 15 minutes are up counts as
 *    expired even if nobody has looked at it yet.
 * 2. In ONE synchronous transaction: inserts the event id (insert-first, so a
 *    redelivery is recognised by the primary key and changes nothing else),
 *    then applies the rule for the event type. An exception rolls the event row
 *    back too, so a retry is processed rather than mistaken for a duplicate.
 *
 * The order state machine is what protects the order. A success for an order
 * that is no longer `pending_payment` (or for the wrong amount) is NEVER
 * applied to it: the payment is marked `refund_pending` for the caller to send
 * back after the commit.
 */
export function applyPaymentEvent(
  db: DbHandle,
  event: GatewayEvent,
  rawBody: string,
  log: Log,
): PaymentEventResult {
  sweepExpiredOrders(db, log);

  return db.transaction((tx) => {
    const inserted = tx
      .insert(paymentEvents)
      .values({
        gatewayEventId: event.id,
        type: event.type,
        payload: rawBody,
        outcome: "ignored",
      })
      .onConflictDoNothing()
      .run();

    if (inserted.changes === 0) {
      return { status: "duplicate" } as const;
    }

    const result = decide(tx, event, log);

    tx.update(paymentEvents)
      .set({ outcome: result.outcome })
      .where(eq(paymentEvents.gatewayEventId, event.id))
      .run();

    return { status: "processed", ...result } as const;
  });
}

type Decision = {
  outcome: "applied" | "ignored" | "refund_requested";
  note: string;
  refundPaymentIds: number[];
};

const ignored = (note: string): Decision => ({ outcome: "ignored", note, refundPaymentIds: [] });

function decide(tx: DbHandle, event: GatewayEvent, log: Log): Decision {
  if (event.type !== "payment_intent.succeeded" && event.type !== "payment_intent.payment_failed") {
    return ignored(`unhandled event type ${event.type}`);
  }

  const intent = readIntent(event);
  if (intent === null) {
    log.warn({ eventId: event.id }, "payment event has no usable data.object");
    return ignored("event data is missing id, amount or currency");
  }

  const payment = tx
    .select()
    .from(payments)
    .where(eq(payments.gatewayIntentId, intent.intentId))
    .get();

  if (!payment) {
    log.warn({ eventId: event.id, intentId: intent.intentId }, "payment event for an unknown intent");
    return ignored("unknown payment intent");
  }

  if (event.type === "payment_intent.payment_failed") {
    return applyFailure(tx, payment);
  }
  return applySuccess(tx, payment, intent, event, log);
}

type PaymentRow = typeof payments.$inferSelect;

/** A decline only matters while the attempt is still open. After anything else (say, a late failure following a success) it is stale news. */
function applyFailure(tx: DbHandle, payment: PaymentRow): Decision {
  if (payment.status !== "pending") {
    return ignored(`payment already ${payment.status}`);
  }

  setPaymentStatus(tx, payment.id, "failed");
  return { outcome: "applied", note: "payment failed; order stays open", refundPaymentIds: [] };
}

function applySuccess(
  tx: DbHandle,
  payment: PaymentRow,
  intent: IntentData,
  event: GatewayEvent,
  log: Log,
): Decision {
  if (payment.status !== "pending" && payment.status !== "failed") {
    // Already counted (or already being refunded): the same money, not a second charge.
    return ignored(`payment already ${payment.status}`);
  }

  const order = tx
    .select({ id: orders.id, status: orders.status, totalCents: orders.totalCents, currency: orders.currency })
    .from(orders)
    .where(eq(orders.id, payment.orderId))
    .get();

  if (!order) {
    // Foreign keys make this unreachable; refusing to guess is still the safe answer.
    throw new Error(`Payment ${payment.id} points at missing order ${payment.orderId}`);
  }

  if (order.status !== "pending_payment") {
    log.warn(
      { eventId: event.id, orderId: order.id, orderStatus: order.status },
      "payment succeeded for an order that is no longer payable; refunding",
    );
    return refund(tx, payment.id, `order was ${order.status}`);
  }

  if (intent.amountCents !== order.totalCents || intent.currency !== order.currency) {
    log.error(
      { eventId: event.id, orderId: order.id, expected: [order.totalCents, order.currency], got: [intent.amountCents, intent.currency] },
      "payment amount or currency does not match the order; refunding",
    );
    return refund(tx, payment.id, "amount or currency mismatch");
  }

  applyTransition(tx, order.id, "pay", `payment ${intent.intentId}`);
  setPaymentStatus(tx, payment.id, "succeeded");
  return { outcome: "applied", note: "order paid", refundPaymentIds: [] };
}

function refund(tx: DbHandle, paymentId: number, why: string): Decision {
  setPaymentStatus(tx, paymentId, "refund_pending");
  return { outcome: "refund_requested", note: why, refundPaymentIds: [paymentId] };
}

function setPaymentStatus(tx: DbHandle, paymentId: number, status: PaymentRow["status"]) {
  tx.update(payments).set({ status, updatedAt: new Date() }).where(eq(payments.id, paymentId)).run();
}
