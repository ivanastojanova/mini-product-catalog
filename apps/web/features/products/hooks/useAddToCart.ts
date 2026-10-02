"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { addToCart, getCartItem } from "@/features/products/api/cart";
import { productKeys } from "@/features/products/queries/productKeys";
import type { CartItem } from "@/features/products/types/cart";

export function useProductCart(slug: string) {
  return useQuery({
    queryKey: productKeys.cart(slug),
    queryFn: () => getCartItem(slug),
    enabled: Boolean(slug),
  });
}

export function useAddToCart(slug: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => addToCart(slug),
    onMutate: async () => {
      const queryKey = productKeys.cart(slug);
      await queryClient.cancelQueries({ queryKey });

      const previous = queryClient.getQueryData<CartItem>(queryKey);

      queryClient.setQueryData<CartItem>(queryKey, (current) => ({
        slug,
        quantity: (current?.quantity ?? previous?.quantity ?? 0) + 1,
      }));

      return { previous };
    },
    onError: (_error, _variables, context) => {
      const queryKey = productKeys.cart(slug);
      if (context?.previous !== undefined) {
        queryClient.setQueryData(queryKey, context.previous);
      } else {
        queryClient.setQueryData<CartItem>(queryKey, { slug, quantity: 0 });
      }
    },
    onSuccess: (data) => {
      queryClient.setQueryData<CartItem>(productKeys.cart(slug), {
        slug: data.slug,
        quantity: data.quantity,
      });
    },
  });
}
