import { formatPrice } from "@/features/products/lib/formatters";
import type { Locale } from "@/shared/i18n/locales";

type ProductPriceProps = {
  amount: number;
  currency: string;
  locale: Locale;
  className?: string;
};

/** CMS catalog price — baked into the statically rendered page. */
export function ProductPrice({
  amount,
  currency,
  locale,
  className,
}: ProductPriceProps) {
  return (
    <p className={className ?? "text-xl font-medium tracking-tight text-foreground"}>
      {formatPrice(amount, currency, locale)}
    </p>
  );
}
