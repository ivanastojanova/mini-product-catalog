"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { i18nConfig } from "./config";
import { getLocaleFromPathname, replaceLocaleInPath } from "./routing";

export function LanguageSwitcher() {
  const pathname = usePathname();
  const currentLocale = getLocaleFromPathname(pathname);

  return (
    <nav aria-label="Language" className="flex items-center gap-1 text-sm">
      {i18nConfig.locales.map((locale) => {
        const href = replaceLocaleInPath(pathname, locale);
        const isActive = currentLocale === locale;

        return (
          <Link
            key={locale}
            href={href}
            hrefLang={locale}
            aria-current={isActive ? "page" : undefined}
            className={
              isActive
                ? "rounded-md bg-muted px-2.5 py-1 font-medium text-foreground"
                : "rounded-md px-2.5 py-1 text-muted-foreground hover:text-foreground"
            }
          >
            {i18nConfig.labels[locale]}
          </Link>
        );
      })}
    </nav>
  );
}
