"use client";

import { useQuery } from "@tanstack/react-query";

import { getStockBySlug } from "@/features/products/api/stock";
import { productKeys } from "@/features/products/queries/productKeys";

export function useProductStock(slug: string) {
  return useQuery({
    queryKey: productKeys.stock(slug),
    queryFn: () => getStockBySlug(slug),
    enabled: Boolean(slug),
  });
}
