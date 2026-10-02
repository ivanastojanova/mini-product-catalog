import { defaultLocale, locales, type Locale } from "./locales";

export const i18nConfig = {
  locales,
  defaultLocale,
  labels: {
    en: "English",
    de: "Deutsch",
  } satisfies Record<Locale, string>,
} as const;
