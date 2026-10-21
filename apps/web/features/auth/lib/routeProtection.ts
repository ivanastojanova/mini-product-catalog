import { isLocale } from "@/shared/i18n/locales";

/**
 * Name of the session cookie apps/api sets. Intentionally duplicated from
 * apps/api/src/auth/lib/sessionConfig.ts — the apps are separate deploys and
 * apps/web must not import from apps/api (same stance as the i18n locale list).
 */
export const SESSION_COOKIE_NAME = "session";

/** First path segment after the locale that requires a logged-in customer. */
const PROTECTED_SEGMENTS = ["account", "checkout"];

/**
 * Decides whether a request must be redirected to the login page, returning
 * the redirect target path or `null` to let it through.
 *
 * Only checks that a session cookie is *present* — not that it's valid. That
 * keeps the proxy free of network calls to apps/api (no added latency, no
 * availability coupling), so this is a UX redirect, not enforcement: a stale
 * or forged cookie gets through here, and is caught by apps/api (401) and the
 * client-side `useSession` check. See docs/specs/0002-auth.md.
 */
export function getLoginRedirect(
  pathname: string,
  hasSessionCookie: boolean,
): string | null {
  if (hasSessionCookie) {
    return null;
  }

  const [, locale, segment] = pathname.split("/");

  if (!locale || !isLocale(locale) || !segment) {
    return null;
  }

  if (!PROTECTED_SEGMENTS.includes(segment)) {
    return null;
  }

  return `/${locale}/login`;
}
