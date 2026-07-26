import Image from "next/image";
import Link from "next/link";

import type { Product } from "@/features/products/types/product";
import { formatPrice } from "@/features/products/lib/formatters";
import type { Locale } from "@/shared/i18n/locales";
import { localizedPath } from "@/shared/i18n/routing";

type ProductCardProps = {
  product: Product;
  locale: Locale;
};

export function ProductCard({ product, locale }: ProductCardProps) {
  const href = localizedPath(locale, `/products/${product.slug}`);
  const thumbnail = product.images?.[0];
  const priceLabel = formatPrice(product.price, product.currency, locale);

  return (
    <article className="group flex h-full flex-col overflow-hidden rounded-xl bg-card text-card-foreground ring-1 ring-foreground/10 transition-shadow hover:shadow-md">
      <Link href={href} className="flex h-full flex-col outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <div className="relative aspect-4/5 w-full overflow-hidden bg-muted">
          {thumbnail?.url ? (
            <Image
              src={thumbnail.url}
              alt={thumbnail.alt || product.title}
              fill
              sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
              className="object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            />
          ) : (
            <div
              className="flex h-full w-full items-center justify-center text-sm text-muted-foreground"
              aria-hidden
            >
              No image
            </div>
          )}
        </div>

        <div className="flex flex-1 flex-col gap-1 p-4">
          <h2 className="text-base font-medium leading-snug tracking-tight text-foreground">
            {product.title}
          </h2>
          <p className="mt-auto text-sm text-muted-foreground">{priceLabel}</p>
        </div>
      </Link>
    </article>
  );
}
