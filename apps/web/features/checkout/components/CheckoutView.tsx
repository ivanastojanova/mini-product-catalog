"use client";

import { Form } from "@base-ui/react/form";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useSession } from "@/features/auth/hooks/useSession";
import { CheckoutError } from "@/features/checkout/api/checkout";
import { useCheckoutPreview } from "@/features/checkout/hooks/useCheckoutPreview";
import { usePlaceOrder } from "@/features/checkout/hooks/usePlaceOrder";
import type { CheckoutErrorCode, PreviewLine } from "@/features/checkout/types/checkout";
import { formatMoney } from "@/features/products/lib/formatters";
import type { Locale } from "@/shared/i18n/locales";
import { localizedPath } from "@/shared/i18n/routing";

type CheckoutViewProps = {
  locale: Locale;
};

const copy: Record<
  Locale,
  {
    summary: string;
    quantity: (n: number) => string;
    subtotal: string;
    shippingNote: string;
    address: string;
    contact: string;
    loggedInAs: (email: string) => string;
    email: string;
    name: string;
    line1: string;
    line2: string;
    city: string;
    postalCode: string;
    country: string;
    countryHint: string;
    submit: string;
    submitting: string;
    emailInvalid: string;
    required: (field: string) => string;
    countryInvalid: string;
    emptyTitle: string;
    emptyBody: string;
    browse: string;
    loadError: string;
    retry: string;
    problemOutOfStock: string;
    problemFewer: (available: number) => string;
    problemUnavailable: string;
    fixCart: string;
    errors: Record<CheckoutErrorCode, string>;
    viewOpenOrder: string;
  }
> = {
  en: {
    summary: "Order summary",
    quantity: (n) => `Qty ${n}`,
    subtotal: "Subtotal",
    shippingNote: "Shipping and tax are not charged yet.",
    address: "Shipping address",
    contact: "Contact",
    loggedInAs: (email) => `Order confirmation goes to ${email}.`,
    email: "Email",
    name: "Full name",
    line1: "Address",
    line2: "Address line 2 (optional)",
    city: "City",
    postalCode: "Postal code",
    country: "Country",
    countryHint: "2-letter code, e.g. DE",
    submit: "Place order",
    submitting: "Placing order…",
    emailInvalid: "Enter a valid email address.",
    required: (field) => `${field} is required.`,
    countryInvalid: "Use a 2-letter country code.",
    emptyTitle: "Your cart is empty",
    emptyBody: "Add something to your cart to check out.",
    browse: "Browse products",
    loadError: "Could not load your checkout.",
    retry: "Retry",
    problemOutOfStock: "Out of stock",
    problemFewer: (available) => `Only ${available} left`,
    problemUnavailable: "No longer available",
    fixCart: "Some items can't be ordered right now. Remove them or lower the quantity, then try again.",
    errors: {
      empty_cart: "Your cart is empty.",
      unavailable_items: "Some items in your cart are no longer available.",
      insufficient_stock: "Some items are no longer available in the quantity you asked for.",
      mixed_currency: "Your cart has items in different currencies and can't be checked out together.",
      open_order: "You already have an unpaid order. Pay for or cancel it first.",
      key_conflict: "That didn't go through. Please try placing the order again.",
      cart_changed: "Your cart changed while ordering. Please review it and try again.",
      invalid_field: "Please check the highlighted field.",
      unknown: "Could not place your order. Please try again.",
    },
    viewOpenOrder: "View your open order",
  },
  de: {
    summary: "Bestellübersicht",
    quantity: (n) => `Menge ${n}`,
    subtotal: "Zwischensumme",
    shippingNote: "Versand und Steuern werden noch nicht berechnet.",
    address: "Lieferadresse",
    contact: "Kontakt",
    loggedInAs: (email) => `Die Bestätigung geht an ${email}.`,
    email: "E-Mail",
    name: "Vollständiger Name",
    line1: "Adresse",
    line2: "Adresszusatz (optional)",
    city: "Stadt",
    postalCode: "Postleitzahl",
    country: "Land",
    countryHint: "2-Buchstaben-Code, z. B. DE",
    submit: "Bestellung aufgeben",
    submitting: "Bestellung wird aufgegeben…",
    emailInvalid: "Bitte eine gültige E-Mail-Adresse eingeben.",
    required: (field) => `${field} ist erforderlich.`,
    countryInvalid: "Bitte einen 2-Buchstaben-Ländercode verwenden.",
    emptyTitle: "Dein Warenkorb ist leer",
    emptyBody: "Lege etwas in den Warenkorb, um zu bestellen.",
    browse: "Produkte ansehen",
    loadError: "Deine Kasse konnte nicht geladen werden.",
    retry: "Erneut versuchen",
    problemOutOfStock: "Nicht vorrätig",
    problemFewer: (available) => `Nur noch ${available} verfügbar`,
    problemUnavailable: "Nicht mehr verfügbar",
    fixCart: "Einige Artikel können gerade nicht bestellt werden. Entferne sie oder verringere die Menge und versuche es erneut.",
    errors: {
      empty_cart: "Dein Warenkorb ist leer.",
      unavailable_items: "Einige Artikel in deinem Warenkorb sind nicht mehr verfügbar.",
      insufficient_stock: "Einige Artikel sind in der gewünschten Menge nicht mehr verfügbar.",
      mixed_currency: "Dein Warenkorb enthält Artikel in verschiedenen Währungen und kann nicht gemeinsam bestellt werden.",
      open_order: "Du hast bereits eine unbezahlte Bestellung. Bezahle oder storniere sie zuerst.",
      key_conflict: "Das hat nicht geklappt. Bitte gib die Bestellung erneut auf.",
      cart_changed: "Dein Warenkorb hat sich während der Bestellung geändert. Bitte prüfe ihn und versuche es erneut.",
      invalid_field: "Bitte prüfe das markierte Feld.",
      unknown: "Die Bestellung konnte nicht aufgegeben werden. Bitte versuche es erneut.",
    },
    viewOpenOrder: "Zur offenen Bestellung",
  },
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Form field names the server's `shippingAddress.x` / `email` field paths map to. */
function formFieldName(serverField: string): string {
  return serverField.replace(/^shippingAddress\./, "");
}

function problemLabel(line: PreviewLine, labels: (typeof copy)[Locale]): string | null {
  if (line.problem === "unknown_product") return labels.problemUnavailable;
  if (line.problem === "insufficient_stock") {
    return line.available <= 0 ? labels.problemOutOfStock : labels.problemFewer(line.available);
  }
  return null;
}

/**
 * Checkout for guests and customers. The review is apps/api's own pricing
 * (`GET /checkout/preview`), so what is shown is what `POST /orders` charges;
 * the form sends only the address (and, for guests, an email), never a price.
 * Client validation is a convenience: apps/api re-validates and its field
 * errors are shown next to the right input. On success it goes to the order page.
 */
export function CheckoutView({ locale }: CheckoutViewProps) {
  const labels = copy[locale];
  const router = useRouter();
  const preview = useCheckoutPreview(locale);
  const session = useSession();
  const placeOrder = usePlaceOrder();
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});

  if (preview.isPending || session.isPending) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>
    );
  }

  if (preview.isError) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-sm text-destructive" role="alert">
          {preview.error instanceof Error ? preview.error.message : labels.loadError}
        </p>
        <Button type="button" variant="outline" disabled={preview.isFetching} onClick={() => preview.refetch()}>
          {labels.retry}
        </Button>
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

  const customer = session.data;
  const hasProblems = items.some((line) => line.problem !== undefined);
  const error = placeOrder.error;
  const checkoutError = error instanceof CheckoutError ? error : null;
  const errorCode: CheckoutErrorCode | null = checkoutError ? checkoutError.code : error ? "unknown" : null;
  const required = (field: string) => (value: unknown) =>
    typeof value !== "string" || value.trim().length === 0 ? labels.required(field) : null;

  return (
    <div className="flex flex-col gap-8">
      <section aria-label={labels.summary} className="flex flex-col gap-3">
        <h2 className="text-lg font-medium text-foreground">{labels.summary}</h2>
        <ul className="divide-y divide-border rounded-lg border border-border">
          {items.map((line) => {
            const problem = problemLabel(line, labels);
            return (
              <li key={line.slug} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
                <div className="flex flex-col">
                  <span className="font-medium text-foreground">{line.title}</span>
                  <span className="text-muted-foreground">
                    {labels.quantity(line.quantity)}
                    {line.problem === "unknown_product"
                      ? null
                      : ` · ${formatMoney(line.unitPriceCents, currency ?? "EUR", locale)}`}
                  </span>
                  {problem ? (
                    <span className="text-destructive" role="status">
                      {problem}
                    </span>
                  ) : null}
                </div>
                {line.problem === "unknown_product" ? null : (
                  <span className="tabular-nums text-foreground">
                    {formatMoney(line.lineTotalCents, currency ?? "EUR", locale)}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
        <div className="flex items-center justify-between px-4 text-sm font-semibold text-foreground">
          <span>{labels.subtotal}</span>
          <span className="tabular-nums">{formatMoney(subtotalCents, currency ?? "EUR", locale)}</span>
        </div>
        <p className="px-4 text-xs text-muted-foreground">{labels.shippingNote}</p>
        {hasProblems ? (
          <p className="px-4 text-sm text-destructive" role="alert">
            {labels.fixCart}
          </p>
        ) : null}
      </section>

      <Form
        className="flex flex-col gap-4"
        errors={serverErrors}
        onFormSubmit={(values) => {
          setServerErrors({});
          const line2 = String(values.line2 ?? "").trim();
          placeOrder.mutate(
            {
              ...(customer ? {} : { email: String(values.email ?? "").trim() }),
              shippingAddress: {
                name: String(values.name ?? ""),
                line1: String(values.line1 ?? ""),
                ...(line2 ? { line2 } : {}),
                city: String(values.city ?? ""),
                postalCode: String(values.postalCode ?? ""),
                country: String(values.country ?? ""),
              },
            },
            {
              onSuccess: (order) => {
                router.push(localizedPath(locale, `/orders/${order.publicId}`));
              },
              onError: (failure) => {
                if (failure instanceof CheckoutError && failure.code === "invalid_field" && failure.details.field) {
                  setServerErrors({ [formFieldName(failure.details.field)]: failure.message });
                }
              },
            },
          );
        }}
      >
        <h2 className="text-lg font-medium text-foreground">{labels.contact}</h2>
        {customer ? (
          <p className="text-sm text-muted-foreground">{labels.loggedInAs(customer.email)}</p>
        ) : (
          <Field
            name="email"
            validate={(value) =>
              typeof value !== "string" || !EMAIL_PATTERN.test(value.trim()) ? labels.emailInvalid : null
            }
          >
            <FieldLabel>{labels.email}</FieldLabel>
            <Input type="email" name="email" autoComplete="email" />
            <FieldError />
          </Field>
        )}

        <h2 className="mt-2 text-lg font-medium text-foreground">{labels.address}</h2>
        <Field name="name" validate={required(labels.name)}>
          <FieldLabel>{labels.name}</FieldLabel>
          <Input name="name" autoComplete="name" />
          <FieldError />
        </Field>
        <Field name="line1" validate={required(labels.line1)}>
          <FieldLabel>{labels.line1}</FieldLabel>
          <Input name="line1" autoComplete="address-line1" />
          <FieldError />
        </Field>
        <Field name="line2">
          <FieldLabel>{labels.line2}</FieldLabel>
          <Input name="line2" autoComplete="address-line2" />
          <FieldError />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field name="postalCode" validate={required(labels.postalCode)}>
            <FieldLabel>{labels.postalCode}</FieldLabel>
            <Input name="postalCode" autoComplete="postal-code" />
            <FieldError />
          </Field>
          <Field name="city" validate={required(labels.city)}>
            <FieldLabel>{labels.city}</FieldLabel>
            <Input name="city" autoComplete="address-level2" />
            <FieldError />
          </Field>
        </div>
        <Field
          name="country"
          validate={(value) =>
            typeof value !== "string" || !/^[A-Za-z]{2}$/.test(value.trim()) ? labels.countryInvalid : null
          }
        >
          <FieldLabel>{labels.country}</FieldLabel>
          <Input name="country" autoComplete="country" maxLength={2} placeholder={labels.countryHint} />
          <FieldError />
        </Field>

        <Button type="submit" disabled={placeOrder.isPending || placeOrder.isSuccess || hasProblems}>
          {placeOrder.isPending || placeOrder.isSuccess ? labels.submitting : labels.submit}
        </Button>

        {errorCode && errorCode !== "invalid_field" ? (
          <div className="flex flex-col gap-2" role="alert">
            <p className="text-sm text-destructive">{labels.errors[errorCode]}</p>
            {errorCode === "open_order" && checkoutError?.details.orderPublicId ? (
              <Link
                href={localizedPath(locale, `/orders/${checkoutError.details.orderPublicId}`)}
                className="text-sm text-foreground underline underline-offset-4"
              >
                {labels.viewOpenOrder}
              </Link>
            ) : null}
          </div>
        ) : null}
      </Form>
    </div>
  );
}
