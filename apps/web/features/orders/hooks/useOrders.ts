"use client";

import { useQuery } from "@tanstack/react-query";

import { listOrders } from "@/features/orders/api/orders";
import { orderKeys } from "@/features/orders/queries/orderKeys";

/**
 * The logged-in customer's orders, newest first. Always refetched on mount: a
 * hold can lapse while the shopper is elsewhere, and the list is the place
 * they'd look to see it.
 */
export function useOrders(enabled: boolean) {
  return useQuery({
    queryKey: orderKeys.list(),
    queryFn: listOrders,
    enabled,
    staleTime: 0,
  });
}
