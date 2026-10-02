"use client";

import { Button } from "@/components/ui/button";
import {
  useAddToCart,
  useProductCart,
} from "@/features/products/hooks/useAddToCart";
import type { Locale } from "@/shared/i18n/locales";

type AddToCartButtonProps = {
  slug: string;
  locale: Locale;
};

const copy: Record<
  Locale,
  {
    add: string;
    adding: string;
    inCart: (quantity: number) => string;
    errorFallback: string;
  }
> = {
  en: {
    add: "Add to cart",
    adding: "Adding…",
    inCart: (quantity) =>
      quantity === 1 ? "1 in cart" : `${quantity} in cart`,
    errorFallback: "Could not add to cart.",
  },
  de: {
    add: "In den Warenkorb",
    adding: "Wird hinzugefügt…",
    inCart: (quantity) =>
      quantity === 1 ? "1 im Warenkorb" : `${quantity} im Warenkorb`,
    errorFallback: "Konnte nicht hinzugefügt werden.",
  },
};

export function AddToCartButton({ slug, locale }: AddToCartButtonProps) {
  const labels = copy[locale];
  const { data: cart } = useProductCart(slug);
  const { mutate, isPending, isError, error, reset } = useAddToCart(slug);

  const quantity = cart?.quantity ?? 0;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          size="lg"
          disabled={isPending}
          onClick={() => {
            reset();
            mutate();
          }}
        >
          {isPending ? labels.adding : labels.add}
        </Button>
        {quantity > 0 ? (
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {labels.inCart(quantity)}
          </p>
        ) : null}
      </div>
      {isError ? (
        <p className="text-sm text-destructive" role="alert">
          {error instanceof Error ? error.message : labels.errorFallback}
        </p>
      ) : null}
    </div>
  );
}
