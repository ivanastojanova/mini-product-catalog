"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useSession } from "@/features/auth/hooks/useSession";
import { useOrders } from "@/features/orders/hooks/useOrders";
import type { OrderStatus } from "@/features/orders/types/order";
import { formatMoney } from "@/features/products/lib/formatters";
import type { Locale } from "@/shared/i18n/locales";
import { localizedPath } from "@/shared/i18n/routing";

type OrdersListProps = {
  locale: Locale;
};

const copy: Record<
  Locale,
  {
    status: Record<OrderStatus, string>;
    empty: string;
    startShopping: string;
    itemCount: (n: number) => string;
    loadError: string;
    retry: string;
    backToAccount: string;
  }
> = {
  en: {
    status: {
      pending_payment: "Awaiting payment",
      paid: "Paid",
      fulfilled: "Shipped",
      cancelled: "Cancelled",
      expired: "Expired",
    },
    empty: "You haven't placed any orders yet.",
    startShopping: "Start shopping",
    itemCount: (n) => (n === 1 ? "1 item" : `${n} items`),
    loadError: "Could not load your orders.",
    retry: "Retry",
    backToAccount: "Back to account",
  },
  de: {
    status: {
      pending_payment: "Zahlung ausstehend",
      paid: "Bezahlt",
      fulfilled: "Versandt",
      cancelled: "Storniert",
      expired: "Abgelaufen",
    },
    empty: "Du hast noch keine Bestellungen aufgegeben.",
    startShopping: "Jetzt einkaufen",
    itemCount: (n) => (n === 1 ? "1 Artikel" : `${n} Artikel`),
    loadError: "Deine Bestellungen konnten nicht geladen werden.",
    retry: "Erneut versuchen",
    backToAccount: "Zurück zum Konto",
  },
};

const badgeVariant: Record<OrderStatus, "default" | "secondary" | "destructive" | "outline"> = {
  pending_payment: "outline",
  paid: "default",
  fulfilled: "default",
  cancelled: "secondary",
  expired: "destructive",
};

/**
 * Order history for the logged-in customer. Guests have no list (apps/api
 * answers 401), so like the account page this sends anyone without a session
 * to /login. The query waits for the session so a guest never fires a request
 * that is certain to fail.
 */
export function OrdersList({ locale }: OrdersListProps) {
  const labels = copy[locale];
  const router = useRouter();
  const { data: customer, isPending: sessionPending } = useSession();
  const { data: orders, isPending, isError, refetch, isFetching } = useOrders(Boolean(customer));

  useEffect(() => {
    if (!sessionPending && !customer) {
      router.replace(localizedPath(locale, "/login"));
    }
  }, [customer, sessionPending, locale, router]);

  const backLink = (
    <Link
      href={localizedPath(locale, "/account")}
      className="text-sm text-muted-foreground underline-offset-4 hover:underline"
    >
      {labels.backToAccount}
    </Link>
  );

  if (sessionPending || !customer || isPending) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-sm text-destructive" role="alert">
          {labels.loadError}
        </p>
        <Button type="button" variant="outline" disabled={isFetching} onClick={() => refetch()}>
          {labels.retry}
        </Button>
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-sm text-muted-foreground">{labels.empty}</p>
        <Link
          href={localizedPath(locale)}
          className="text-sm text-foreground underline-offset-4 hover:underline"
        >
          {labels.startShopping}
        </Link>
        {backLink}
      </div>
    );
  }

  const dateFormat = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });

  return (
    <div className="flex flex-col gap-4">
      <ul className="divide-y divide-border rounded-lg border border-border">
        {orders.map((order) => {
          const itemCount = order.items.reduce((sum, line) => sum + line.quantity, 0);

          return (
            <li key={order.publicId}>
              <Link
                href={localizedPath(locale, `/orders/${order.publicId}`)}
                className="flex items-center justify-between gap-4 px-4 py-3 text-sm hover:bg-muted/50"
              >
                <div className="flex flex-col gap-1">
                  <span className="font-medium text-foreground">
                    {dateFormat.format(new Date(order.createdAt))}
                  </span>
                  <span className="text-muted-foreground">
                    {labels.itemCount(itemCount)} ·{" "}
                    {formatMoney(order.totalCents, order.currency, locale)}
                  </span>
                </div>
                <Badge variant={badgeVariant[order.status]}>{labels.status[order.status]}</Badge>
              </Link>
            </li>
          );
        })}
      </ul>
      {backLink}
    </div>
  );
}
