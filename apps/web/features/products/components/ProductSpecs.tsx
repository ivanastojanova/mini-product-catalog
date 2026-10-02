import type { ProductSpecification } from "@/features/products/types/product";
import type { Locale } from "@/shared/i18n/locales";

type ProductSpecsProps = {
  specifications?: ProductSpecification[];
  locale: Locale;
};

const headings: Record<Locale, string> = {
  en: "Specifications",
  de: "Technische Daten",
};

export function ProductSpecs({ specifications, locale }: ProductSpecsProps) {
  if (!specifications?.length) {
    return null;
  }

  return (
    <section aria-labelledby="product-specs-heading" className="flex flex-col gap-4">
      <h2
        id="product-specs-heading"
        className="text-lg font-medium tracking-tight text-foreground"
      >
        {headings[locale]}
      </h2>
      <dl className="divide-y divide-border border-y border-border">
        {specifications.map((spec) => (
          <div
            key={`${spec.label}-${spec.value}`}
            className="grid grid-cols-1 gap-1 py-3 sm:grid-cols-[12rem_1fr] sm:gap-6"
          >
            <dt className="text-sm text-muted-foreground">{spec.label}</dt>
            <dd className="text-sm text-foreground">{spec.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
