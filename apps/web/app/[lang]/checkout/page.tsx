import { notFound } from "next/navigation";

import { CheckoutView } from "@/features/checkout/components/CheckoutView";
import { isLocale, type Locale } from "@/shared/i18n/locales";

type CheckoutPageProps = {
  params: Promise<{ lang: string }>;
};

const copy: Record<Locale, { title: string }> = {
  en: { title: "Checkout" },
  de: { title: "Kasse" },
};

export const metadata = { robots: { index: false, follow: false } };

export default async function CheckoutPage({ params }: CheckoutPageProps) {
  const { lang } = await params;

  if (!isLocale(lang)) {
    notFound();
  }

  const locale: Locale = lang;

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-10">
      <h1 className="mb-6 text-3xl font-semibold tracking-tight text-foreground">
        {copy[locale].title}
      </h1>
      <CheckoutView locale={locale} />
    </main>
  );
}
