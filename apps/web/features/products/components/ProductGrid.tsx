import type { Product } from "@/features/products/types/product";
import type { Locale } from "@/shared/i18n/locales";

import { ProductCard } from "./ProductCard";

type ProductGridProps = {
  products: Product[];
  locale: Locale;
  /** Shown when the list is empty; the caller knows whether a filter caused it. */
  emptyMessage?: string;
};

export function ProductGrid({
  products,
  locale,
  emptyMessage = "No products yet.",
}: ProductGridProps) {
  if (products.length === 0) {
    return (
      <p className="text-muted-foreground" role="status">
        {emptyMessage}
      </p>
    );
  }

  return (
    <ul className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {products.map((product) => (
        <li key={product.id} className="min-w-0">
          <ProductCard product={product} locale={locale} />
        </li>
      ))}
    </ul>
  );
}
