"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  removeItemMutationOptions,
  setQuantityMutationOptions,
} from "@/features/cart/hooks/cartItemMutations";

/** Sets one cart line to an absolute quantity. The server validates the range; the UI keeps it within the same bounds. */
export function useUpdateCartItem() {
  const queryClient = useQueryClient();

  return useMutation(setQuantityMutationOptions(queryClient));
}

/** Removes one cart line (idempotent server-side). */
export function useRemoveCartItem() {
  const queryClient = useQueryClient();

  return useMutation(removeItemMutationOptions(queryClient));
}
