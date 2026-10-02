import type { ProductStock } from "@/features/products/types/product";

export async function getStockBySlug(slug: string): Promise<ProductStock> {
  const response = await fetch(`/api/stock/${encodeURIComponent(slug)}`);

  if (!response.ok) {
    throw new Error("Failed to load stock");
  }

  return response.json() as Promise<ProductStock>;
}
