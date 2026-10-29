import { apiFetch } from "@/shared/api/client";
import type { ProductStock } from "@/features/products/types/product";

/** Available units for a product, from apps/api's inventory (on hand minus units held by unpaid orders). */
export async function getStockBySlug(slug: string): Promise<ProductStock> {
  const response = await apiFetch(`/stock/${encodeURIComponent(slug)}`);

  if (!response.ok) {
    throw new Error("Failed to load stock");
  }

  return response.json() as Promise<ProductStock>;
}
