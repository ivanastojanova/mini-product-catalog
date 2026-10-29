import type {
  CheckoutErrorCode,
  CheckoutPreview,
  PlaceOrderInput,
  ShortLine,
} from "@/features/checkout/types/checkout";
import type { Order } from "@/features/orders/types/order";
import type { Locale } from "@/shared/i18n/locales";
import { apiFetch, extractErrorMessage } from "@/shared/api/client";

const KNOWN_CODES: CheckoutErrorCode[] = [
  "empty_cart",
  "unavailable_items",
  "insufficient_stock",
  "mixed_currency",
  "open_order",
  "key_conflict",
  "cart_changed",
];

/**
 * A refused or failed order, with the machine-readable `code` the UI branches
 * on (which message to show, whether to link to the open order) and the extra
 * details apps/api sends with some of them.
 */
export class CheckoutError extends Error {
  constructor(
    readonly code: CheckoutErrorCode,
    message: string,
    readonly details: {
      /** `insufficient_stock`: the lines that are short. */
      shortItems?: ShortLine[];
      /** `unavailable_items`: slugs the catalogue no longer has. */
      unavailableSlugs?: string[];
      /** `open_order`: the unpaid order already waiting. */
      orderPublicId?: string;
      /** `invalid_field`: which form field the server rejected, e.g. "shippingAddress.city". */
      field?: string;
    } = {},
  ) {
    super(message);
    this.name = "CheckoutError";
  }
}

type ErrorBody = {
  code?: string;
  message?: string;
  field?: string;
  items?: unknown;
  orderPublicId?: string;
};

/** The visitor's cart priced as an order would be, in cents. Never cached: stock and prices move. */
export async function getCheckoutPreview(locale: Locale): Promise<CheckoutPreview> {
  const response = await apiFetch(
    `/checkout/preview?locale=${encodeURIComponent(locale)}`,
  );

  if (!response.ok) {
    throw new Error(
      await extractErrorMessage(response, "Could not load your checkout."),
    );
  }

  return response.json() as Promise<CheckoutPreview>;
}

/**
 * Places the order. `idempotencyKey` must be generated once per checkout
 * attempt and reused for every retry of it, so a double click or a retry after
 * a lost response returns the same order instead of holding stock twice.
 * Prices are not sent: apps/api prices from the CMS.
 */
export async function placeOrder(
  input: PlaceOrderInput,
  idempotencyKey: string,
): Promise<Order> {
  let response: Response;
  try {
    response = await apiFetch("/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(input),
    });
  } catch {
    throw new CheckoutError("unknown", "Could not reach the shop. Please try again.");
  }

  if (response.ok) {
    return ((await response.json()) as { order: Order }).order;
  }

  let body: ErrorBody = {};
  try {
    body = (await response.json()) as ErrorBody;
  } catch {
    // keep the empty body: fall through to the generic error
  }
  const message = body.message ?? "Could not place your order.";

  if (response.status === 400 && body.field) {
    throw new CheckoutError("invalid_field", message, { field: body.field });
  }

  const code = KNOWN_CODES.find((known) => known === body.code);
  if (response.status === 409 && code) {
    throw new CheckoutError(code, message, {
      shortItems: code === "insufficient_stock" ? (body.items as ShortLine[]) : undefined,
      unavailableSlugs: code === "unavailable_items" ? (body.items as string[]) : undefined,
      orderPublicId: body.orderPublicId,
    });
  }

  throw new CheckoutError("unknown", message);
}
