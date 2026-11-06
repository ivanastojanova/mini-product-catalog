"use client";

import Link from "next/link";

import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CartLineItem } from "@/features/cart/components/CartLineItem";
import {
  useRemoveCartItem,
  useUpdateCartItem,
} from "@/features/cart/hooks/useCartItemMutations";
import { CheckoutError } from "@/features/checkout/api/checkout";
import { useCheckoutPreview } from "@/features/checkout/hooks/useCheckoutPreview";
import { formatMoney } from "@/features/products/lib/formatters";
import type { Locale } from "@/shared/i18n/locales";
import { localizedPath } from "@/shared/i18n/routing";

type CartCopy = {
  emptyTitle: string;
  emptyBody: string;
  browse: string;
  loadError: string;
  mixedCurrency: string;
  retry: string;
  subtotal: string;
  shippingNote: string;
  fixCart: string;
  updateError: string;
  checkout: string;
  continueShopping: string;
};

const copy: Record<Locale, CartCopy> = {
  en: {
    emptyTitle: "Your cart is empty",
    emptyBody: "Add something to your cart to check out.",
    browse: "Browse products",
    loadError: "Could not load your cart.",
    mixedCurrency:
      "Your cart has items in different currencies and can't be checked out together.",
    retry: "Retry",
    subtotal: "Subtotal",
    shippingNote: "Shipping and tax are not charged yet.",
    fixCart:
      "Some items can't be ordered right now. Remove them or lower the quantity before checking out.",
    updateError: "Your cart could not be updated. Please try again.",
    checkout: "Checkout",
    continueShopping: "Continue shopping",
  },
  de: {
    emptyTitle: "Dein Warenkorb ist leer",
    emptyBody: "Lege etwas in den Warenkorb, um zu bestellen.",
    browse: "Produkte ansehen",
    loadError: "Dein Warenkorb konnte nicht geladen werden.",
    mixedCurrency:
      "Dein Warenkorb enthält Artikel in verschiedenen Währungen und kann nicht gemeinsam bestellt werden.",
    retry: "Erneut versuchen",
    subtotal: "Zwischensumme",
    shippingNote: "Versand und Steuern werden noch nicht berechnet.",
    fixCart:
      "Einige Artikel können gerade nicht bestellt werden. Entferne sie oder verringere die Menge, bevor du zur Kasse gehst.",
    updateError: "Dein Warenkorb konnte nicht aktualisiert werden. Bitte versuche es erneut.",
    checkout: "Zur Kasse",
    continueShopping: "Weiter einkaufen",
  },
};

/**
 * The full cart: apps/api's priced preview (`GET /checkout/preview`), so the
 * titles, prices and subtotal are the same numbers checkout will charge.
 * Quantity and remove write through the cart API, then refresh both the cart
 * query (header badge) and the preview. No optimistic numbers here: the
 * preview is the priced authority, and stock flags must come from it.
 */
export function CartView({ locale }: { locale: Locale }) {
  const labels = copy[locale];
  const preview = useCheckoutPreview(locale);
  const updateItem = useUpdateCartItem();
  const removeItem = useRemoveCartItem();
  const writePending = updateItem.isPending || removeItem.isPending;
  // Keep the controls locked until the refreshed preview lands: a second click
  // during the refetch would step from the old quantity and lose the first one.
  const controlsLocked = writePending || preview.isFetching;

  if (preview.isPending) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-9 w-40" />
      </div>
    );
  }

  if (preview.isError) {
    const mixedCurrency =
      preview.error instanceof CheckoutError && preview.error.code === "mixed_currency";

    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-sm text-destructive" role="alert">
          {mixedCurrency ? labels.mixedCurrency : labels.loadError}
        </p>
        <Button
          type="button"
          variant="outline"
          disabled={preview.isFetching}
          onClick={() => preview.refetch()}
        >
          {labels.retry}
        </Button>
        <Link
          href={localizedPath(locale)}
          className="text-sm text-foreground underline underline-offset-4"
        >
          {labels.browse}
        </Link>
      </div>
    );
  }

  const { items, currency, subtotalCents } = preview.data;

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3">
        <h2 className="text-lg font-medium text-foreground">{labels.emptyTitle}</h2>
        <p className="text-sm text-muted-foreground">{labels.emptyBody}</p>
        <Link
          href={localizedPath(locale)}
          className="text-sm text-foreground underline underline-offset-4"
        >
          {labels.browse}
        </Link>
      </div>
    );
  }

  const displayCurrency = currency ?? "EUR";
  const hasProblems = items.some((line) => line.problem !== undefined);

  return (
    <div className="flex flex-col gap-6">
      <ul
        className="divide-y divide-border rounded-lg border border-border"
        aria-busy={controlsLocked}
      >
        {items.map((line) => (
          <CartLineItem
            key={line.slug}
            line={line}
            currency={displayCurrency}
            locale={locale}
            pending={controlsLocked}
            onQuantityChange={(quantity) =>
              updateItem.mutate({ slug: line.slug, quantity })
            }
            onRemove={() => removeItem.mutate(line.slug)}
          />
        ))}
      </ul>

      <div className="flex items-center justify-between text-sm font-semibold text-foreground">
        <span>{labels.subtotal}</span>
        <span className="tabular-nums">
          {formatMoney(subtotalCents, displayCurrency, locale)}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">{labels.shippingNote}</p>

      {hasProblems ? (
        <p className="text-sm text-destructive" role="alert">
          {labels.fixCart}
        </p>
      ) : null}
      {!writePending && (updateItem.isError || removeItem.isError) ? (
        <p className="text-sm text-destructive" role="alert">
          {labels.updateError}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-4">
        <Link
          href={localizedPath(locale, "/checkout")}
          className={buttonVariants({ size: "lg" })}
        >
          {labels.checkout}
        </Link>
        <Link
          href={localizedPath(locale)}
          className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
        >
          {labels.continueShopping}
        </Link>
      </div>
    </div>
  );
}
