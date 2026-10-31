"use client";

import { useQuery } from "@tanstack/react-query";

import { getOrder } from "@/features/orders/api/orders";
import { orderRefetchInterval } from "@/features/orders/lib/polling";
import { orderKeys } from "@/features/orders/queries/orderKeys";

/**
 * One order. `data` is `null` when it doesn't exist or isn't yours (apps/api
 * answers 404 for both). While the order is unpaid it polls, because its
 * status can change without this tab doing anything (the hold lapses, or the
 * payment webhook arrives).
 */
export function useOrder(publicId: string) {
  return useQuery({
    queryKey: orderKeys.detail(publicId),
    queryFn: () => getOrder(publicId),
    refetchInterval: (query) => orderRefetchInterval(query.state.data),
  });
}
