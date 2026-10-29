import type { ShippingAddress } from "@/features/orders/types/order";

export type PricingProblem = "unknown_product" | "insufficient_stock";

export type PreviewLine = {
  slug: string;
  title: string;
  unitPriceCents: number;
  quantity: number;
  lineTotalCents: number;
  available: number;
  problem?: PricingProblem;
};

/** The cart priced the way an order would be (apps/api `GET /checkout/preview`). Money is integer cents. */
export type CheckoutPreview = {
  currency: string | null;
  items: PreviewLine[];
  subtotalCents: number;
};

/** What the form submits. `email` is only sent by guests; apps/api uses the account email for customers. */
export type PlaceOrderInput = {
  shippingAddress: Omit<ShippingAddress, "line2"> & { line2?: string };
  email?: string;
};

/** The reasons apps/api refuses an order (HTTP 409), plus our own for everything else. */
export type CheckoutErrorCode =
  | "empty_cart"
  | "unavailable_items"
  | "insufficient_stock"
  | "mixed_currency"
  | "open_order"
  | "key_conflict"
  | "cart_changed"
  | "invalid_field"
  | "unknown";

export type ShortLine = { slug: string; requested: number; available: number };
