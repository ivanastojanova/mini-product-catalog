import type { Product } from "@/features/products/types/product";
import type { Locale } from "@/shared/i18n/locales";

import { AddToCartButton } from "./AddToCartButton";
import { ProductPrice } from "./ProductPrice";
import { ProductStock } from "./ProductStock";

type ProductHeaderProps = {
  product: Product;
  locale: Locale;
};

export function ProductHeader({ product, locale }: ProductHeaderProps) {
  return (
    <header className="flex flex-col gap-3">
      <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
        {product.title}
      </h1>
      <div className="flex flex-wrap items-center gap-3">
        <ProductPrice
          amount={product.price}
          currency={product.currency}
          locale={locale}
        />
        <ProductStock slug={product.slug} locale={locale} />
      </div>
      {product.description ? (
        <p className="max-w-prose text-base leading-relaxed text-muted-foreground">
          {product.description}
        </p>
      ) : null}
      <AddToCartButton slug={product.slug} locale={locale} />
    </header>
  );
}
