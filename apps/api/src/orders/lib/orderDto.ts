import { eq, sql } from "drizzle-orm";

import { orderItems, orders } from "../../db/schema.js";
import type { DbHandle } from "../../inventory/lib/inventoryRepo.js";
import { latestPaymentStatus } from "../../payments/lib/startPayment.js";
import type { OrderStatus } from "./orderStateMachine.js";

/** What the shopper may know about the latest payment attempt. No intent ids or gateway data. */
export type PaymentDtoStatus = "pending" | "failed" | "succeeded" | "refunding" | "refunded";

const PAYMENT_DTO_STATUS: Record<string, PaymentDtoStatus> = {
  pending: "pending",
  failed: "failed",
  succeeded: "succeeded",
  refund_pending: "refunding",
  refunded: "refunded",
};

export type OrderDto = {
  publicId: string;
  status: OrderStatus;
  currency: string;
  totalCents: number;
  contactEmail: string;
  shippingAddress: {
    name: string;
    line1: string;
    line2: string | null;
    city: string;
    postalCode: string;
    country: string;
  };
  items: Array<{
    slug: string;
    title: string;
    unitPriceCents: number;
    quantity: number;
    lineTotalCents: number;
  }>;
  reservationExpiresAt: string;
  createdAt: string;
  paidAt: string | null;
  /** The most recent payment attempt, or null if none was ever started. */
  payment: { status: PaymentDtoStatus } | null;
};

/**
 * The client-facing shape of an order. The integer id, owner columns and
 * idempotency key never leave the server: `publicId` is the only identifier
 * the API exposes. Lines keep their insertion order.
 */
export function getOrderDto(db: DbHandle, orderId: number): OrderDto {
  const order = db.select().from(orders).where(eq(orders.id, orderId)).get();
  if (!order) {
    throw new Error(`Order ${orderId} not found`);
  }

  const items = db
    .select()
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId))
    .orderBy(sql`rowid`)
    .all();

  const paymentStatus = latestPaymentStatus(db, orderId);

  return {
    publicId: order.publicId,
    status: order.status as OrderStatus,
    currency: order.currency,
    totalCents: order.totalCents,
    contactEmail: order.contactEmail,
    shippingAddress: {
      name: order.shipName,
      line1: order.shipLine1,
      line2: order.shipLine2,
      city: order.shipCity,
      postalCode: order.shipPostalCode,
      country: order.shipCountry,
    },
    items: items.map((item) => ({
      slug: item.productSlug,
      title: item.title,
      unitPriceCents: item.unitPriceCents,
      quantity: item.quantity,
      lineTotalCents: item.unitPriceCents * item.quantity,
    })),
    reservationExpiresAt: order.reservationExpiresAt.toISOString(),
    createdAt: order.createdAt.toISOString(),
    paidAt: order.paidAt ? order.paidAt.toISOString() : null,
    payment:
      paymentStatus !== null && PAYMENT_DTO_STATUS[paymentStatus]
        ? { status: PAYMENT_DTO_STATUS[paymentStatus] }
        : null,
  };
}
