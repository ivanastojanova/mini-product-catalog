import type { Locale } from "@/shared/i18n/locales";

// Same BCP 47 mapping as `features/products/lib/formatters.ts`; kept here so
// order dates don't depend on the product feature.
const localeToBcp47: Record<Locale, string> = {
  en: "en-EU",
  de: "de-DE",
};

/** Formats an ISO timestamp for order dates, or `null` if it can't be parsed so the UI can omit the line. */
export function formatOrderDate(iso: string, locale: Locale): string | null {
  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat(localeToBcp47[locale], {
    dateStyle: "medium",
  }).format(date);
}
