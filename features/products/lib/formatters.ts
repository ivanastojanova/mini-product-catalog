import type { Locale } from "@/shared/i18n/locales";

const localeToBcp47: Record<Locale, string> = {
  en: "en-EU",
  de: "de-DE",
};

export function formatPrice(
  amount: number,
  currency = "EUR",
  locale: Locale = "en",
) {
  return new Intl.NumberFormat(localeToBcp47[locale], {
    style: "currency",
    currency,
  }).format(amount);
}
