import { notFound } from "next/navigation";

import { CartView } from "@/features/cart/components/CartView";
import { isLocale, type Locale } from "@/shared/i18n/locales";

type CartPageProps = {
  params: Promise<{ lang: string }>;
};

const copy: Record<Locale, { title: string }> = {
  en: { title: "Cart" },
  de: { title: "Warenkorb" },
};

export const metadata = { robots: { index: false, follow: false } };

export default async function CartPage({ params }: CartPageProps) {
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
      <CartView locale={locale} />
    </main>
  );
}
