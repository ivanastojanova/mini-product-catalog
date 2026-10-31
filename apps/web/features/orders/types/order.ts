export type OrderStatus =
  | "pending_payment"
  | "paid"
  | "fulfilled"
  | "cancelled"
  | "expired";

export type ShippingAddress = {
  name: string;
  line1: string;
  line2: string | null;
  city: string;
  postalCode: string;
  country: string;
};

export type OrderLine = {
  slug: string;
  title: string;
  unitPriceCents: number;
  quantity: number;
  lineTotalCents: number;
};

/** The shopper-visible state of the latest payment attempt. No gateway ids reach the browser. */
export type PaymentStatus = "pending" | "failed" | "succeeded" | "refunding" | "refunded";

/** Mirrors apps/api's order DTO. Money is integer cents; timestamps are ISO strings. */
export type Order = {
  publicId: string;
  status: OrderStatus;
  currency: string;
  totalCents: number;
  contactEmail: string;
  shippingAddress: ShippingAddress;
  items: OrderLine[];
  reservationExpiresAt: string;
  createdAt: string;
  paidAt: string | null;
  payment: { status: PaymentStatus } | null;
};
