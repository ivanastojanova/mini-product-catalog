"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { addToCartMutationOptions } from "@/features/cart/hooks/addToCartMutation";

export function useAddToCart(slug: string) {
  const queryClient = useQueryClient();

  return useMutation(addToCartMutationOptions(queryClient, slug));
}
