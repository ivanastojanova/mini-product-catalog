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

type MiniCartCopy = {
  empty: string;
  browse: string;
  loadError: string;
  mixedCurrency: string;
  retry: string;
  subtotal: string;
  fixCart: string;
  updateError: string;
  viewCart: string;
  checkout: string;
};

const copy: Record<Locale, MiniCartCopy> = {
  en: {
    empty: "Your cart is empty.",
    browse: "Browse products",
    loadError: "Could not load your cart.",
    mixedCurrency:
      "Your cart has items in different currencies and can't be checked out together.",
    retry: "Retry",
    subtotal: "Subtotal",
    fixCart: "Some items can't be ordered right now.",
    updateError: "Your cart could not be updated.",
    viewCart: "View cart",
    checkout: "Checkout",
  },
  de: {
    empty: "Dein Warenkorb ist leer.",
    browse: "Produkte ansehen",
    loadError: "Dein Warenkorb konnte nicht geladen werden.",
    mixedCurrency:
      "Dein Warenkorb enthält Artikel in verschiedenen Währungen und kann nicht gemeinsam bestellt werden.",
    retry: "Erneut versuchen",
    subtotal: "Zwischensumme",
    fixCart: "Einige Artikel können gerade nicht bestellt werden.",
    updateError: "Dein Warenkorb konnte nicht aktualisiert werden.",
    viewCart: "Zum Warenkorb",
    checkout: "Zur Kasse",
  },
};

type MiniCartPanelProps = {
  locale: Locale;
  /** Closes the popover before navigating to a full page. */
  onNavigate: () => void;
};

/**
 * The dropdown's contents. Mounted only while the popover is open, so
 * `useCheckoutPreview` fires on open rather than on every page view: the
 * preview prices from the CMS and sweeps expired holds, so it is not free.
 * It shares `CartLineItem` and the cart write hooks with the cart page.
 */
export function MiniCartPanel({ locale, onNavigate }: MiniCartPanelProps) {
  const labels = copy[locale];
  const preview = useCheckoutPreview(locale);
  const updateItem = useUpdateCartItem();
  const removeItem = useRemoveCartItem();
  const writePending = updateItem.isPending || removeItem.isPending;
  const controlsLocked = writePending || preview.isFetching;

  if (preview.isPending) {
    return (
      <div className="flex flex-col gap-2" aria-busy="true">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }

  if (preview.isError) {
    const mixedCurrency =
      preview.error instanceof CheckoutError && preview.error.code === "mixed_currency";

    return (
      <div className="flex flex-col items-start gap-2">
        <p className="text-sm text-destructive" role="alert">
          {mixedCurrency ? labels.mixedCurrency : labels.loadError}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={preview.isFetching}
          onClick={() => preview.refetch()}
        >
          {labels.retry}
        </Button>
      </div>
    );
  }

  const { items, currency, subtotalCents } = preview.data;

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-start gap-2">
        <p className="text-sm text-muted-foreground">{labels.empty}</p>
        <Link
          href={localizedPath(locale)}
          onClick={onNavigate}
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
    <div className="flex flex-col gap-3">
      <ul
        className="max-h-72 divide-y divide-border overflow-y-auto rounded-lg border border-border"
        aria-busy={controlsLocked}
      >
        {items.map((line) => (
          <CartLineItem
            key={line.slug}
            line={line}
            currency={displayCurrency}
            locale={locale}
            pending={controlsLocked}
            compact
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

      {hasProblems ? (
        <p className="text-xs text-destructive" role="alert">
          {labels.fixCart}
        </p>
      ) : null}
      {!writePending && (updateItem.isError || removeItem.isError) ? (
        <p className="text-xs text-destructive" role="alert">
          {labels.updateError}
        </p>
      ) : null}

      <div className="flex items-center justify-between gap-3">
        <Link
          href={localizedPath(locale, "/cart")}
          onClick={onNavigate}
          className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
        >
          {labels.viewCart}
        </Link>
        <Link
          href={localizedPath(locale, "/checkout")}
          onClick={onNavigate}
          className={buttonVariants({ size: "sm" })}
        >
          {labels.checkout}
        </Link>
      </div>
    </div>
  );
}
