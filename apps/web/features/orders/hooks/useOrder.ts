"use client";

import { useQuery } from "@tanstack/react-query";

import { getOrder } from "@/features/orders/api/orders";
import { orderKeys } from "@/features/orders/queries/orderKeys";

/** How often an unpaid order is re-read, so an expired hold shows up without a manual reload. */
const PENDING_REFETCH_MS = 5_000;

/**
 * One order. `data` is `null` when it doesn't exist or isn't yours (apps/api
 * answers 404 for both). While the order is unpaid it polls, because its
 * status can change without this tab doing anything (the hold lapses).
 */
export function useOrder(publicId: string) {
  return useQuery({
    queryKey: orderKeys.detail(publicId),
    queryFn: () => getOrder(publicId),
    refetchInterval: (query) =>
      query.state.data?.status === "pending_payment" ? PENDING_REFETCH_MS : false,
  });
}
