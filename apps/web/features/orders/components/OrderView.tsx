"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useCancelOrder, useStartPayment } from "@/features/orders/hooks/useOrderMutations";
import { useOrder } from "@/features/orders/hooks/useOrder";
import { formatCountdown, secondsUntil } from "@/features/orders/lib/countdown";
import type { Order, OrderStatus } from "@/features/orders/types/order";
import { formatMoney } from "@/features/products/lib/formatters";
import type { Locale } from "@/shared/i18n/locales";
import { localizedPath } from "@/shared/i18n/routing";

type OrderViewProps = {
  locale: Locale;
  publicId: string;
};

const copy: Record<
  Locale,
  {
    status: Record<OrderStatus, string>;
    statusNote: Record<OrderStatus, string>;
    paymentNote: {
      processing: string;
      declined: string;
      refunding: string;
      refunded: string;
    };
    holdLeft: (time: string) => string;
    items: string;
    quantity: (n: number) => string;
    total: string;
    shipTo: string;
    contact: string;
    cancel: string;
    cancelling: string;
    pay: string;
    payAgain: string;
    paying: string;
    testNote: string;
    notFoundTitle: string;
    notFoundBody: string;
    loadError: string;
    retry: string;
    keepShopping: string;
    actionError: string;
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
    statusNote: {
      pending_payment: "Your items are reserved for you while you pay.",
      paid: "Thank you! We've received your payment.",
      fulfilled: "Your order is on its way.",
      cancelled: "This order was cancelled and its items were released.",
      expired:
        "The reservation ran out before payment, so the items were released. Add them to your cart again to order.",
    },
    paymentNote: {
      processing: "We're confirming your payment. This page updates by itself.",
      declined: "Your payment was declined. You can try again while your items are reserved.",
      refunding: "Your payment arrived after the order closed. We're refunding it.",
      refunded: "Your payment arrived after the order closed, so it was refunded in full.",
    },
    holdLeft: (time) => `Reserved for ${time}`,
    items: "Items",
    quantity: (n) => `Qty ${n}`,
    total: "Total",
    shipTo: "Ship to",
    contact: "Contact",
    cancel: "Cancel order",
    cancelling: "Cancelling…",
    pay: "Pay now",
    payAgain: "Try paying again",
    paying: "Taking you to the payment page…",
    testNote: "Test mode: you'll be sent to a mock payment page. No real payment is taken.",
    notFoundTitle: "Order not found",
    notFoundBody:
      "We couldn't find this order. If you placed it as a guest, open this link in the same browser you ordered from.",
    loadError: "Could not load your order.",
    retry: "Retry",
    keepShopping: "Continue shopping",
    actionError: "That didn't work.",
  },
  de: {
    status: {
      pending_payment: "Zahlung ausstehend",
      paid: "Bezahlt",
      fulfilled: "Versandt",
      cancelled: "Storniert",
      expired: "Abgelaufen",
    },
    statusNote: {
      pending_payment: "Deine Artikel sind für dich reserviert, solange du zahlst.",
      paid: "Danke! Deine Zahlung ist eingegangen.",
      fulfilled: "Deine Bestellung ist unterwegs.",
      cancelled: "Diese Bestellung wurde storniert, die Artikel wurden freigegeben.",
      expired:
        "Die Reservierung ist vor der Zahlung abgelaufen, die Artikel wurden freigegeben. Lege sie erneut in den Warenkorb, um zu bestellen.",
    },
    paymentNote: {
      processing: "Wir bestätigen deine Zahlung. Diese Seite aktualisiert sich von selbst.",
      declined: "Deine Zahlung wurde abgelehnt. Du kannst es erneut versuchen, solange deine Artikel reserviert sind.",
      refunding: "Deine Zahlung kam an, nachdem die Bestellung geschlossen war. Wir erstatten sie dir.",
      refunded: "Deine Zahlung kam an, nachdem die Bestellung geschlossen war, und wurde vollständig erstattet.",
    },
    holdLeft: (time) => `Reserviert für ${time}`,
    items: "Artikel",
    quantity: (n) => `Menge ${n}`,
    total: "Gesamt",
    shipTo: "Lieferadresse",
    contact: "Kontakt",
    cancel: "Bestellung stornieren",
    cancelling: "Wird storniert…",
    pay: "Jetzt bezahlen",
    payAgain: "Erneut bezahlen",
    paying: "Weiterleitung zur Zahlungsseite…",
    testNote: "Testmodus: Du wirst zu einer Mock-Zahlungsseite weitergeleitet. Es wird keine echte Zahlung durchgeführt.",
    notFoundTitle: "Bestellung nicht gefunden",
    notFoundBody:
      "Wir konnten diese Bestellung nicht finden. Falls du als Gast bestellt hast, öffne diesen Link im selben Browser, mit dem du bestellt hast.",
    loadError: "Deine Bestellung konnte nicht geladen werden.",
    retry: "Erneut versuchen",
    keepShopping: "Weiter einkaufen",
    actionError: "Das hat nicht geklappt.",
  },
};

const badgeVariant: Record<OrderStatus, "default" | "secondary" | "destructive" | "outline"> = {
  pending_payment: "outline",
  paid: "default",
  fulfilled: "default",
  cancelled: "secondary",
  expired: "destructive",
};

/** The extra line about the payment, if the latest attempt needs one. */
function paymentNoteFor(order: Order, labels: (typeof copy)[Locale]): string | null {
  switch (order.payment?.status) {
    case "pending":
      return order.status === "pending_payment" ? labels.paymentNote.processing : null;
    case "failed":
      return order.status === "pending_payment" ? labels.paymentNote.declined : null;
    case "refunding":
      return labels.paymentNote.refunding;
    case "refunded":
      return labels.paymentNote.refunded;
    default:
      return null;
  }
}

/** Ticks once a second while `active`, returning the current time (null until mounted, so server and client render the same HTML). */
function useNow(active: boolean): number | null {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    if (!active) return;
    const tick = () => setNow(Date.now());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [active]);

  return now;
}

/**
 * The order page: the confirmation after checkout and the permanent link to
 * the order. apps/api decides who may see it (customer session or the guest's
 * order_token cookie); a missing order and someone else's both come back as
 * "not found" and render the same way.
 */
export function OrderView({ locale, publicId }: OrderViewProps) {
  const labels = copy[locale];
  const { data: order, isPending, isError, refetch, isFetching } = useOrder(publicId);
  const cancel = useCancelOrder();
  const pay = useStartPayment(locale);
  const now = useNow(order?.status === "pending_payment");

  const shopLink = (
    <Link
      href={localizedPath(locale)}
      className="text-sm text-muted-foreground underline-offset-4 hover:underline"
    >
      {labels.keepShopping}
    </Link>
  );

  if (isPending) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-5 w-64" />
        <Skeleton className="h-24 w-full" />
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

  if (order === null) {
    return (
      <div className="flex flex-col items-start gap-3">
        <h2 className="text-lg font-medium text-foreground">{labels.notFoundTitle}</h2>
        <p className="text-sm text-muted-foreground">{labels.notFoundBody}</p>
        {shopLink}
      </div>
    );
  }

  const isUnpaid = order.status === "pending_payment";
  const secondsLeft = now === null ? null : secondsUntil(order.reservationExpiresAt, now);
  const actionError = cancel.error ?? pay.error;
  // Stays true after a successful start, while the browser leaves for the payment page.
  const busy = cancel.isPending || pay.isPending || pay.isSuccess;
  const paymentNote = paymentNoteFor(order, labels);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <Badge variant={badgeVariant[order.status]}>{labels.status[order.status]}</Badge>
          {isUnpaid && secondsLeft !== null ? (
            <span className="text-sm tabular-nums text-muted-foreground">
              {labels.holdLeft(formatCountdown(secondsLeft))}
            </span>
          ) : null}
        </div>
        <p className="text-sm text-muted-foreground">{labels.statusNote[order.status]}</p>
        {paymentNote ? (
          <p className="text-sm text-foreground" role="status">
            {paymentNote}
          </p>
        ) : null}
      </div>

      <section aria-label={labels.items}>
        <ul className="divide-y divide-border rounded-lg border border-border">
          {order.items.map((line) => (
            <li key={line.slug} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
              <div className="flex flex-col">
                <Link
                  href={localizedPath(locale, `/products/${line.slug}`)}
                  className="font-medium text-foreground hover:underline"
                >
                  {line.title}
                </Link>
                <span className="text-muted-foreground">
                  {labels.quantity(line.quantity)} · {formatMoney(line.unitPriceCents, order.currency, locale)}
                </span>
              </div>
              <span className="tabular-nums text-foreground">
                {formatMoney(line.lineTotalCents, order.currency, locale)}
              </span>
            </li>
          ))}
        </ul>
        <div className="flex items-center justify-between px-4 pt-3 text-sm font-semibold text-foreground">
          <span>{labels.total}</span>
          <span className="tabular-nums">{formatMoney(order.totalCents, order.currency, locale)}</span>
        </div>
      </section>

      <dl className="grid gap-4 text-sm sm:grid-cols-2">
        <div>
          <dt className="mb-1 text-muted-foreground">{labels.shipTo}</dt>
          <dd className="text-foreground">
            <address className="not-italic">
              {order.shippingAddress.name}
              <br />
              {order.shippingAddress.line1}
              {order.shippingAddress.line2 ? (
                <>
                  <br />
                  {order.shippingAddress.line2}
                </>
              ) : null}
              <br />
              {order.shippingAddress.postalCode} {order.shippingAddress.city}
              <br />
              {order.shippingAddress.country}
            </address>
          </dd>
        </div>
        <div>
          <dt className="mb-1 text-muted-foreground">{labels.contact}</dt>
          <dd className="text-foreground">{order.contactEmail}</dd>
        </div>
      </dl>

      {isUnpaid ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-3">
            <Button type="button" disabled={busy} onClick={() => pay.mutate(order.publicId)}>
              {pay.isPending || pay.isSuccess
                ? labels.paying
                : order.payment?.status === "failed"
                  ? labels.payAgain
                  : labels.pay}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => cancel.mutate(order.publicId)}
            >
              {cancel.isPending ? labels.cancelling : labels.cancel}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{labels.testNote}</p>
          {actionError ? (
            <p className="text-sm text-destructive" role="alert">
              {actionError instanceof Error ? actionError.message : labels.actionError}
            </p>
          ) : null}
        </div>
      ) : null}

      <div>{shopLink}</div>
    </div>
  );
}
