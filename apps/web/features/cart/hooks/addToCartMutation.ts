import type { MutationOptions, QueryClient } from "@tanstack/react-query";

import { addToCart } from "@/features/cart/api/cart";
import {
  addOptimistically,
  withConfirmedQuantity,
} from "@/features/cart/lib/cartMath";
import { cartKeys } from "@/features/cart/queries/cartKeys";
import type { Cart, CartLine } from "@/features/cart/types/cart";

type AddContext = { previous: Cart | undefined };

/**
 * Optimistic "add one" for a single product. Kept as a plain options factory
 * (not inside the hook) so the optimistic/rollback behavior can be tested
 * against a real QueryClient without rendering React.
 *
 * - onMutate: bump the cached cart immediately, remember the snapshot.
 * - onSuccess: write the server's (possibly clamped) quantity for this line.
 * - onError: restore the snapshot; if the cart was never loaded there is
 *   nothing to restore, so refetch to learn the truth instead of guessing.
 */
export function addToCartMutationOptions(
  queryClient: QueryClient,
  slug: string,
): MutationOptions<CartLine, Error, void, AddContext> {
  const queryKey = cartKeys.current();

  return {
    mutationFn: () => addToCart(slug),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey });

      const previous = queryClient.getQueryData<Cart>(queryKey);
      queryClient.setQueryData<Cart>(queryKey, addOptimistically(previous, slug));

      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData<Cart>(queryKey, context.previous);
      } else {
        void queryClient.invalidateQueries({ queryKey });
      }
    },
    onSuccess: (line) => {
      queryClient.setQueryData<Cart>(queryKey, (current) =>
        withConfirmedQuantity(current, line.slug, line.quantity),
      );
    },
  };
}
