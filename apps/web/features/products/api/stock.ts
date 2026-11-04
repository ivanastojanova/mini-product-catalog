import { apiFetch } from "@/shared/api/client";
import type { ProductStock } from "@/features/products/types/product";

/**
 * Most slugs apps/api's `GET /stock?slugs=` accepts per call. A copy of its
 * `MAX_STOCK_BATCH_SLUGS` (separate deploys, see ADR 0001); a bigger catalog is
 * split into several calls rather than hitting its 400.
 */
export const MAX_STOCK_BATCH_SLUGS = 100;

/** Available units for a product, from apps/api's inventory (on hand minus units held by unpaid orders). */
export async function getStockBySlug(slug: string): Promise<ProductStock> {
  const response = await apiFetch(`/stock/${encodeURIComponent(slug)}`);

  if (!response.ok) {
    throw new Error("Failed to load stock");
  }

  return response.json() as Promise<ProductStock>;
}

type StockBatchResponse = {
  items: { slug: string; inStock: boolean; quantity: number }[];
};

async function fetchStockChunk(slugs: string[]): Promise<StockBatchResponse> {
  const response = await apiFetch(
    `/stock?slugs=${slugs.map(encodeURIComponent).join(",")}`,
    { cache: "no-store" },
  );

  if (!response.ok) {
    throw new Error("Failed to load stock");
  }

  return response.json() as Promise<StockBatchResponse>;
}

/**
 * Available units for many products at once, as slug → quantity. For the live
 * stock filters, which need every listed product's stock in one go. Any failed
 * chunk rejects the whole call: a partial answer would silently drop products
 * from the list, so the caller decides how to show the failure.
 */
export async function getStockBatch(
  slugs: string[],
): Promise<Map<string, number>> {
  const unique = [...new Set(slugs)];
  const available = new Map<string, number>();

  const chunks: string[][] = [];
  for (let i = 0; i < unique.length; i += MAX_STOCK_BATCH_SLUGS) {
    chunks.push(unique.slice(i, i + MAX_STOCK_BATCH_SLUGS));
  }

  const responses = await Promise.all(chunks.map(fetchStockChunk));

  for (const { items } of responses) {
    for (const item of items) {
      available.set(item.slug, item.quantity);
    }
  }
  return available;
}
