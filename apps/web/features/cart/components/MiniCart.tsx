"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MiniCartPanel } from "@/features/cart/components/MiniCartPanel";
import { useCart } from "@/features/cart/hooks/useCart";
import { totalQuantity } from "@/features/cart/lib/cartMath";
import type { Locale } from "@/shared/i18n/locales";

const copy: Record<
  Locale,
  { cart: string; title: string; items: (count: number) => string }
> = {
  en: {
    cart: "Cart",
    title: "Cart",
    items: (count) => `${count} ${count === 1 ? "item" : "items"} in cart`,
  },
  de: {
    cart: "Warenkorb",
    title: "Warenkorb",
    items: (count) => `${count} Artikel im Warenkorb`,
  },
};

/**
 * Header cart button: the count comes from the shared cart query (so an
 * optimistic add updates it immediately), and opening it mounts the priced
 * preview. Deliberately a button, not a link: the cart page is one click away
 * inside the dropdown.
 */
export function MiniCart({ locale }: { locale: Locale }) {
  const labels = copy[locale];
  const { data } = useCart();
  const count = totalQuantity(data);
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={count === 0 ? labels.cart : labels.items(count)}
        className="inline-flex items-center gap-1.5 rounded-sm text-sm text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        {labels.cart}
        {count > 0 ? (
          <Badge aria-hidden="true" className="tabular-nums">
            {count}
          </Badge>
        ) : null}
      </PopoverTrigger>
      <PopoverContent aria-label={labels.title}>
        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-foreground">{labels.title}</h2>
          <MiniCartPanel locale={locale} onNavigate={() => setOpen(false)} />
        </div>
      </PopoverContent>
    </Popover>
  );
}
