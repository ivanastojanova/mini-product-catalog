import { notFound } from "next/navigation";

import { OrdersList } from "@/features/orders/components/OrdersList";
import { isLocale, type Locale } from "@/shared/i18n/locales";

type OrdersPageProps = {
  params: Promise<{ lang: string }>;
};

const copy: Record<Locale, { title: string }> = {
  en: { title: "Your orders" },
  de: { title: "Deine Bestellungen" },
};

/** Private and per-customer: rendered per request and kept out of search indexes. */
export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

export default async function OrdersPage({ params }: OrdersPageProps) {
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
      <OrdersList locale={locale} />
    </main>
  );
}
