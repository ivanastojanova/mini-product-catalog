"use client";

import { Button } from "@/components/ui/button";
import { MAX_LINE_QUANTITY } from "@/features/cart/lib/cartMath";
import type { PreviewLine } from "@/features/checkout/types/checkout";
import { formatMoney } from "@/features/products/lib/formatters";
import { cn } from "@/lib/utils";
import type { Locale } from "@/shared/i18n/locales";

type LineCopy = {
  decrease: (title: string) => string;
  increase: (title: string) => string;
  quantityOf: (title: string) => string;
  remove: string;
  removeLabel: (title: string) => string;
  outOfStock: string;
  fewer: (available: number) => string;
  unavailable: string;
};

const copy: Record<Locale, LineCopy> = {
  en: {
    decrease: (title) => `Decrease quantity of ${title}`,
    increase: (title) => `Increase quantity of ${title}`,
    quantityOf: (title) => `Quantity of ${title}`,
    remove: "Remove",
    removeLabel: (title) => `Remove ${title} from cart`,
    outOfStock: "Out of stock",
    fewer: (available) => `Only ${available} left`,
    unavailable: "No longer available",
  },
  de: {
    decrease: (title) => `Menge von ${title} verringern`,
    increase: (title) => `Menge von ${title} erhöhen`,
    quantityOf: (title) => `Menge von ${title}`,
    remove: "Entfernen",
    removeLabel: (title) => `${title} aus dem Warenkorb entfernen`,
    outOfStock: "Nicht vorrätig",
    fewer: (available) => `Nur noch ${available} verfügbar`,
    unavailable: "Nicht mehr verfügbar",
  },
};

function problemLabel(line: PreviewLine, labels: LineCopy): string | null {
  if (line.problem === "unknown_product") return labels.unavailable;
  if (line.problem === "insufficient_stock") {
    return line.available <= 0 ? labels.outOfStock : labels.fewer(line.available);
  }
  return null;
}

type CartLineItemProps = {
  line: PreviewLine;
  currency: string;
  locale: Locale;
  /** A write for this line is in flight: disable the controls that would fire another. */
  pending: boolean;
  /** Narrow container (the header mini-cart): stack instead of using the cart page's wide row. */
  compact?: boolean;
  onQuantityChange: (quantity: number) => void;
  onRemove: () => void;
};

/**
 * One priced cart line: title, unit price, quantity stepper, line total and
 * remove. Purely presentational — the cart page and the header mini-cart
 * share it so both show the same numbers and controls.
 */
export function CartLineItem({
  line,
  currency,
  locale,
  pending,
  compact = false,
  onQuantityChange,
  onRemove,
}: CartLineItemProps) {
  const labels = copy[locale];
  const problem = problemLabel(line, labels);
  const priced = line.problem !== "unknown_product";

  return (
    <li
      className={cn(
        "flex flex-col px-4 py-4",
        compact ? "gap-2" : "gap-3 sm:flex-row sm:items-center sm:justify-between",
      )}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <span className="font-medium text-foreground">{line.title}</span>
        <span className="text-sm text-muted-foreground">
          {priced
            ? formatMoney(line.unitPriceCents, currency, locale)
            : labels.unavailable}
        </span>
        {problem ? (
          <span className="text-sm text-destructive" role="status">
            {problem}
          </span>
        ) : null}
      </div>

      <div className={cn("flex items-center gap-3", compact && "justify-between")}>
        <div
          className="flex items-center gap-1"
          role="group"
          aria-label={labels.quantityOf(line.title)}
        >
          <Button
            type="button"
            variant="outline"
            size="icon-xs"
            aria-label={labels.decrease(line.title)}
            disabled={pending || line.quantity <= 1}
            onClick={() => onQuantityChange(line.quantity - 1)}
          >
            −
          </Button>
          <span className="min-w-6 text-center text-sm tabular-nums text-foreground" aria-live="polite">
            {line.quantity}
          </span>
          <Button
            type="button"
            variant="outline"
            size="icon-xs"
            aria-label={labels.increase(line.title)}
            disabled={pending || line.quantity >= MAX_LINE_QUANTITY}
            onClick={() => onQuantityChange(line.quantity + 1)}
          >
            +
          </Button>
        </div>

        <span className="min-w-16 text-right text-sm tabular-nums text-foreground">
          {priced ? formatMoney(line.lineTotalCents, currency, locale) : null}
        </span>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={labels.removeLabel(line.title)}
          disabled={pending}
          onClick={onRemove}
        >
          {labels.remove}
        </Button>
      </div>
    </li>
  );
}
