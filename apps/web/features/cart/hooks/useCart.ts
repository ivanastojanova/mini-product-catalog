"use client";

import { useQuery } from "@tanstack/react-query";

import { getCart } from "@/features/cart/api/cart";
import { quantityInCart } from "@/features/cart/lib/cartMath";
import { cartKeys } from "@/features/cart/queries/cartKeys";

/** The whole cart. One query for the page: every "N in cart" badge and a future mini-cart read this same cache entry. */
export function useCart() {
  return useQuery({
    queryKey: cartKeys.current(),
    queryFn: getCart,
  });
}

/** Quantity of one product, derived from the shared cart query — no per-product request. */
export function useCartQuantity(slug: string) {
  return useQuery({
    queryKey: cartKeys.current(),
    queryFn: getCart,
    select: (cart) => quantityInCart(cart, slug),
  });
}
