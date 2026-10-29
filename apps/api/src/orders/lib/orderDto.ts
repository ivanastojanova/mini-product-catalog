import { eq, sql } from "drizzle-orm";

import { orderItems, orders } from "../../db/schema.js";
import type { DbHandle } from "../../inventory/lib/inventoryRepo.js";
import type { OrderStatus } from "./orderStateMachine.js";

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
  };
}
