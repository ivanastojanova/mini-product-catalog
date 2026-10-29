"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { cancelOrder, simulatePayment } from "@/features/orders/api/orders";
import { orderKeys } from "@/features/orders/queries/orderKeys";
import type { Order } from "@/features/orders/types/order";
import { productKeys } from "@/features/products/queries/productKeys";

/**
 * Both mutations move the order and its stock, so on success (and on failure,
 * where the server's view may differ from ours, e.g. the hold just expired)
 * they refresh the order, the order list and every product's stock.
 */
function useOrderMutation(mutationFn: (publicId: string) => Promise<Order>) {
  const queryClient = useQueryClient();

  const refresh = (publicId: string) => {
    void queryClient.invalidateQueries({ queryKey: orderKeys.detail(publicId) });
    void queryClient.invalidateQueries({ queryKey: orderKeys.list() });
    void queryClient.invalidateQueries({ queryKey: productKeys.allStock() });
  };

  return useMutation({
    mutationFn,
    onSuccess: (order) => {
      queryClient.setQueryData<Order | null>(orderKeys.detail(order.publicId), order);
      refresh(order.publicId);
    },
    onError: (_error, publicId) => refresh(publicId),
  });
}

export function useCancelOrder() {
  return useOrderMutation(cancelOrder);
}

/** Dev-only payment. Phase 5 replaces this with the real payment flow. */
export function useSimulatePayment() {
  return useOrderMutation(simulatePayment);
}
