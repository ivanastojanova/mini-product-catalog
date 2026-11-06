import type { Product } from "@/features/products/types/product";
import type { ProductFilters } from "@/features/products/lib/productFilters";

/**
 * Applies the live facets (in stock, minimum quantity) to products the CMS
 * already narrowed. `available` is slug → units available from apps/api. A
 * product missing from it counts as 0, the same way apps/api reports a slug
 * with no inventory row, so an unknown product can never pass a stock filter.
 * Order is preserved: the CMS's sort is the user's sort.
 */
export function applyLiveFilters(
  products: Product[],
  available: ReadonlyMap<string, number>,
  filters: ProductFilters,
): Product[] {
  return products.filter((product) => {
    const quantity = available.get(product.slug) ?? 0;

    if (filters.inStock && quantity < 1) {
      return false;
    }
    if (filters.minQty !== undefined && quantity < filters.minQty) {
      return false;
    }
    return true;
  });
}
