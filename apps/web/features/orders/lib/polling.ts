import type { Order } from "@/features/orders/types/order";

/** How often an unpaid order is re-read, so an expired hold shows up without a manual reload. */
export const PENDING_REFETCH_MS = 5_000;

/** Faster while a payment is in flight: the webhook usually lands within a second or two of the return. */
export const PAYMENT_REFETCH_MS = 2_000;

/**
 * How long to wait before re-reading an order, or `false` to stop. The page
 * keeps polling while the order is unpaid (a webhook can mark it paid without
 * this tab doing anything) and while a refund is still going out for a late
 * payment; every other state is final.
 */
export function orderRefetchInterval(order: Order | null | undefined): number | false {
  if (!order) return false;
  if (order.status === "pending_payment") {
    return order.payment?.status === "pending" ? PAYMENT_REFETCH_MS : PENDING_REFETCH_MS;
  }
  if (order.payment?.status === "refunding") return PENDING_REFETCH_MS;
  return false;
}
