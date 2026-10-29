"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { CheckoutError, placeOrder } from "@/features/checkout/api/checkout";
import { createKeyHolder } from "@/features/checkout/lib/idempotencyKey";
import { checkoutKeys } from "@/features/checkout/queries/checkoutKeys";
import type { PlaceOrderInput } from "@/features/checkout/types/checkout";
import { cartKeys } from "@/features/cart/queries/cartKeys";
import type { Cart } from "@/features/cart/types/cart";
import { orderKeys } from "@/features/orders/queries/orderKeys";
import type { Order } from "@/features/orders/types/order";
import { productKeys } from "@/features/products/queries/productKeys";

/**
 * Places the order. One Idempotency-Key per checkout attempt: every retry
 * (double click, lost response) reuses it, so the order can only be created
 * once. It is replaced after a success, and after `key_conflict` (the key
 * belongs to someone else, so reusing it could never succeed).
 */
export function usePlaceOrder() {
  const queryClient = useQueryClient();
  const [keyHolder] = useState(() => createKeyHolder(() => crypto.randomUUID()));

  return useMutation<Order, Error, PlaceOrderInput>({
    mutationFn: (input) => placeOrder(input, keyHolder.current()),
    onSuccess: (order) => {
      keyHolder.reset();
      queryClient.setQueryData<Order | null>(orderKeys.detail(order.publicId), order);
      // apps/api emptied the cart and took a hold on stock while placing the order.
      queryClient.setQueryData<Cart>(cartKeys.current(), { items: [] });
      void queryClient.invalidateQueries({ queryKey: checkoutKeys.all });
      void queryClient.invalidateQueries({ queryKey: orderKeys.list() });
      void queryClient.invalidateQueries({ queryKey: productKeys.allStock() });
    },
    onError: (error) => {
      if (error instanceof CheckoutError && error.code === "key_conflict") {
        keyHolder.reset();
      }
      // A refusal usually means prices or stock moved: show the fresh numbers.
      void queryClient.invalidateQueries({ queryKey: checkoutKeys.all });
      void queryClient.invalidateQueries({ queryKey: productKeys.allStock() });
    },
  });
}
