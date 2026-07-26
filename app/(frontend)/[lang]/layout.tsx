import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { notFound } from "next/navigation";

import { LanguageSwitcher } from "@/shared/i18n/LanguageSwitcher";
import { isLocale, locales, type Locale } from "@/shared/i18n/locales";
import { QueryProvider } from "@/shared/providers/QueryProvider";

import "../globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Mini Product Catalog",
  description: "Localized product catalog",
};

export function generateStaticParams() {
  return locales.map((lang) => ({ lang }));
}

type FrontendLayoutProps = {
  children: React.ReactNode;
  params: Promise<{ lang: string }>;
};

export default async function FrontendLayout({
  children,
  params,
}: FrontendLayoutProps) {
  const { lang } = await params;

  if (!isLocale(lang)) {
    notFound();
  }

  const locale: Locale = lang;

  return (
    <html
      lang={locale}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <QueryProvider>
          <header className="border-b border-border">
            <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
              <Link
                href={`/${locale}`}
                className="text-sm font-semibold tracking-tight text-foreground"
              >
                Mini Catalog
              </Link>
              <LanguageSwitcher />
            </div>
          </header>
          {children}
        </QueryProvider>
      </body>
    </html>
  );
}
