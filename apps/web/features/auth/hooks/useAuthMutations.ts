"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { login, logout, register } from "@/features/auth/api/auth";
import { authKeys } from "@/features/auth/queries/authKeys";
import type { AuthenticatedCustomer } from "@/features/auth/types/auth";
import { cartKeys } from "@/features/cart/queries/cartKeys";
import type { Cart } from "@/features/cart/types/cart";

export function useRegister() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: register,
    onSuccess: (customer) => {
      queryClient.setQueryData<AuthenticatedCustomer | null>(
        authKeys.session(),
        customer,
      );
      // apps/api merged the guest cart into the customer's during this
      // request, so whatever is cached is stale.
      void queryClient.invalidateQueries({ queryKey: cartKeys.all });
    },
  });
}

export function useLogin() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: login,
    onSuccess: (customer) => {
      queryClient.setQueryData<AuthenticatedCustomer | null>(
        authKeys.session(),
        customer,
      );
      // apps/api merged the guest cart into the customer's during this
      // request, so whatever is cached is stale.
      void queryClient.invalidateQueries({ queryKey: cartKeys.all });
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: logout,
    onSuccess: () => {
      queryClient.setQueryData<AuthenticatedCustomer | null>(
        authKeys.session(),
        null,
      );
      // Logout leaves the customer's cart on the server and the browser
      // with an empty one — no need to refetch to know that.
      queryClient.setQueryData<Cart>(cartKeys.current(), { items: [] });
    },
  });
}
