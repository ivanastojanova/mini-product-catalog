import type { Locale } from "@/shared/i18n/locales";

export const checkoutKeys = {
  all: ["checkout"] as const,
  preview: (locale: Locale) => [...checkoutKeys.all, "preview", locale] as const,
};
