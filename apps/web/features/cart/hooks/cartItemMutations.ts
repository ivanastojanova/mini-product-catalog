import type { MutationOptions, QueryClient } from "@tanstack/react-query";

import { removeCartItem, setCartItemQuantity } from "@/features/cart/api/cart";
import { cartKeys } from "@/features/cart/queries/cartKeys";
import type { CartLine } from "@/features/cart/types/cart";
import { checkoutKeys } from "@/features/checkout/queries/checkoutKeys";

export type QuantityChange = { slug: string; quantity: number };

/**
 * Both cart writes refresh the cart and the priced preview. `onSettled`, not
 * `onSuccess`: if apps/api applied the write but the response was lost, the
 * cache must still be re-read rather than keep the number we already had.
 * Neither is optimistic — the preview is the priced authority, and it has to
 * be re-fetched for the subtotal and stock flags anyway.
 */
function refreshCartViews(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: cartKeys.current() });
  void queryClient.invalidateQueries({ queryKey: checkoutKeys.all });
}

export function setQuantityMutationOptions(
  queryClient: QueryClient,
): MutationOptions<CartLine, Error, QuantityChange> {
  return {
    mutationFn: ({ slug, quantity }) => setCartItemQuantity(slug, quantity),
    onSettled: () => refreshCartViews(queryClient),
  };
}

export function removeItemMutationOptions(
  queryClient: QueryClient,
): MutationOptions<void, Error, string> {
  return {
    mutationFn: (slug) => removeCartItem(slug),
    onSettled: () => refreshCartViews(queryClient),
  };
}
