import type { Cart } from "@/features/cart/types/cart";

/**
 * Mirrors apps/api's per-line cap (`MAX_LINE_QUANTITY`). Duplicated on
 * purpose, like the locale list — the apps are separate deploys. apps/api
 * stays the authority; this only keeps the optimistic UI from briefly
 * showing a number the server would clamp.
 */
export const MAX_LINE_QUANTITY = 10;

/** Optimistic equivalent of apps/api's `POST /cart/items` (increment, clamped). Pure — returns a new cart. */
export function addOptimistically(cart: Cart | undefined, slug: string): Cart {
  const items = cart?.items ?? [];
  const existing = items.find((line) => line.slug === slug);

  if (!existing) {
    return { items: [...items, { slug, quantity: 1 }] };
  }

  return {
    items: items.map((line) =>
      line.slug === slug
        ? { ...line, quantity: Math.min(MAX_LINE_QUANTITY, line.quantity + 1) }
        : line,
    ),
  };
}

/** Writes the server-confirmed quantity for one line into a cart snapshot, leaving other lines alone. */
export function withConfirmedQuantity(
  cart: Cart | undefined,
  slug: string,
  quantity: number,
): Cart {
  const items = cart?.items ?? [];

  if (!items.some((line) => line.slug === slug)) {
    return { items: [...items, { slug, quantity }] };
  }

  return {
    items: items.map((line) => (line.slug === slug ? { ...line, quantity } : line)),
  };
}

export function quantityInCart(cart: Cart | undefined, slug: string): number {
  return cart?.items.find((line) => line.slug === slug)?.quantity ?? 0;
}
