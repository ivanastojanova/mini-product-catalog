"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { login, logout, register } from "@/features/auth/api/auth";
import { authKeys } from "@/features/auth/queries/authKeys";
import type { AuthenticatedCustomer } from "@/features/auth/types/auth";

export function useRegister() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: register,
    onSuccess: (customer) => {
      queryClient.setQueryData<AuthenticatedCustomer | null>(
        authKeys.session(),
        customer,
      );
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
    },
  });
}
