/**
 * apps/cms and apps/web are separate services now, so this list is
 * intentionally duplicated (not imported across the app boundary) rather
 * than hoisted into a shared package. For two locales that's a reasonable
 * tradeoff; if locales grow or drift becomes a real problem, promote this
 * to a published `@mini-catalog/i18n` workspace package instead.
 * See docs/adr/0001-monorepo-content-commerce-split.md.
 */
export const locales = ["en", "de"] as const;

export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "en";

export const localeLabels: Record<Locale, string> = {
  en: "English",
  de: "Deutsch",
};
