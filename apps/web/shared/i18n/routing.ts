import { defaultLocale, isLocale, type Locale } from "./locales";

/**
 * Build a path under a locale prefix.
 * localizedPath("en", "/products/chair") → "/en/products/chair"
 */
export function localizedPath(locale: Locale, path = "/"): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (normalized === "/") {
    return `/${locale}`;
  }
  return `/${locale}${normalized}`;
}

/**
 * Swap the locale segment in a pathname while keeping the rest of the route.
 * "/en/products/chair" + "de" → "/de/products/chair"
 */
export function replaceLocaleInPath(pathname: string, locale: Locale): string {
  const segments = pathname.split("/");

  if (segments.length > 1 && isLocale(segments[1])) {
    segments[1] = locale;
    return segments.join("/") || `/${locale}`;
  }

  return localizedPath(locale, pathname);
}

/**
 * Read the locale from a pathname, or fall back to the default.
 */
export function getLocaleFromPathname(pathname: string): Locale {
  const segment = pathname.split("/")[1];
  return isLocale(segment) ? segment : defaultLocale;
}
