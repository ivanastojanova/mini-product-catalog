import { describe, expect, it } from "vitest";

import type { Order, OrderStatus, PaymentStatus } from "@/features/orders/types/order";

import { orderRefetchInterval, PAYMENT_REFETCH_MS, PENDING_REFETCH_MS } from "./polling";

function order(status: OrderStatus, payment: PaymentStatus | null): Order {
  return { publicId: "abc", status, payment: payment ? { status: payment } : null } as Order;
}

describe("orderRefetchInterval", () => {
  it("does not poll for a missing order or while nothing is loaded", () => {
    expect(orderRefetchInterval(null)).toBe(false);
    expect(orderRefetchInterval(undefined)).toBe(false);
  });

  it("polls an unpaid order slowly", () => {
    expect(orderRefetchInterval(order("pending_payment", null))).toBe(PENDING_REFETCH_MS);
    expect(orderRefetchInterval(order("pending_payment", "failed"))).toBe(PENDING_REFETCH_MS);
  });

  it("polls faster while a payment is in flight", () => {
    expect(orderRefetchInterval(order("pending_payment", "pending"))).toBe(PAYMENT_REFETCH_MS);
    expect(PAYMENT_REFETCH_MS).toBeLessThan(PENDING_REFETCH_MS);
  });

  it("keeps polling an expired order until its late payment has been refunded", () => {
    expect(orderRefetchInterval(order("expired", "refunding"))).toBe(PENDING_REFETCH_MS);
    expect(orderRefetchInterval(order("cancelled", "refunding"))).toBe(PENDING_REFETCH_MS);
  });

  it.each([
    ["paid", "succeeded"],
    ["paid", null],
    ["fulfilled", "succeeded"],
    ["cancelled", null],
    ["expired", null],
    ["expired", "refunded"],
    ["cancelled", "failed"],
  ] as const)("stops for a %s order with payment %s", (status, payment) => {
    expect(orderRefetchInterval(order(status, payment))).toBe(false);
  });
});
