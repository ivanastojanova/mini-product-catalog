"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useProductStock } from "@/features/products/hooks/useProductStock";
import type { Locale } from "@/shared/i18n/locales";

type ProductStockProps = {
  slug: string;
  locale: Locale;
};

const copy: Record<
  Locale,
  {
    loading: string;
    error: string;
    retry: string;
    inStock: (quantity: number) => string;
    outOfStock: string;
  }
> = {
  en: {
    loading: "Checking availability…",
    error: "Could not load availability.",
    retry: "Retry",
    inStock: (quantity) =>
      quantity === 1 ? "1 in stock" : `${quantity} in stock`,
    outOfStock: "Out of stock",
  },
  de: {
    loading: "Verfügbarkeit wird geprüft…",
    error: "Verfügbarkeit konnte nicht geladen werden.",
    retry: "Erneut versuchen",
    inStock: (quantity) =>
      quantity === 1 ? "1 auf Lager" : `${quantity} auf Lager`,
    outOfStock: "Nicht vorrätig",
  },
};

export function ProductStock({ slug, locale }: ProductStockProps) {
  const { data, isPending, isError, refetch, isFetching } = useProductStock(slug);
  const labels = copy[locale];

  if (isPending) {
    return (
      <div className="flex flex-col gap-2" aria-busy="true" aria-live="polite">
        <Skeleton className="h-5 w-28" />
        <p className="sr-only">{labels.loading}</p>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="flex flex-wrap items-center gap-2" role="alert">
        <p className="text-sm text-destructive">{labels.error}</p>
        <Button
          type="button"
          variant="outline"
          size="xs"
          onClick={() => void refetch()}
          disabled={isFetching}
        >
          {labels.retry}
        </Button>
      </div>
    );
  }

  if (!data.inStock) {
    return (
      <Badge variant="secondary" aria-live="polite">
        {labels.outOfStock}
      </Badge>
    );
  }

  return (
    <Badge variant="outline" aria-live="polite">
      {labels.inStock(data.quantity)}
    </Badge>
  );
}
