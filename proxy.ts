import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { defaultLocale, isLocale } from "@/shared/i18n/locales";

/**
 * Next.js 16 renamed `middleware` → `proxy`.
 * Redirect bare `/` to the default locale. Skip admin, API, and assets.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    pathname.startsWith("/admin") ||
    pathname.startsWith("/api") ||
    pathname.startsWith("/_next") ||
    pathname.includes(".")
  ) {
    return NextResponse.next();
  }

  if (pathname === "/") {
    const url = request.nextUrl.clone();
    url.pathname = `/${defaultLocale}`;
    return NextResponse.redirect(url);
  }

  const maybeLocale = pathname.split("/")[1];
  if (maybeLocale && !isLocale(maybeLocale)) {
    // Unknown first segment that isn't a locale — leave routing to the app
    // (e.g. future non-localized routes). Locale pages validate via isLocale.
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
