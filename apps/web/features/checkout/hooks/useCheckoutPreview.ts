"use client";

import { useQuery } from "@tanstack/react-query";

import { getCheckoutPreview } from "@/features/checkout/api/checkout";
import { checkoutKeys } from "@/features/checkout/queries/checkoutKeys";
import type { Locale } from "@/shared/i18n/locales";

/** The cart priced as an order would be. Always re-read on mount: prices and stock move, and a stale review is what checkout must not show. */
export function useCheckoutPreview(locale: Locale) {
  return useQuery({
    queryKey: checkoutKeys.preview(locale),
    queryFn: () => getCheckoutPreview(locale),
    staleTime: 0,
    gcTime: 0,
  });
}
