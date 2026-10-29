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

/**
 * Formats integer minor units (cents) from apps/api orders and checkout
 * previews. Separate from `formatPrice`, which takes the CMS's major-unit
 * float, so a cents value can't be passed there by mistake and shown 100x too
 * large. Assumes a 2-decimal currency, same as apps/api's `toMinorUnits`.
 */
export function formatMoney(
  cents: number,
  currency = "EUR",
  locale: Locale = "en",
) {
  return formatPrice(cents / 100, currency, locale);
}
