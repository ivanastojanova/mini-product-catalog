import { notFound } from "next/navigation";

import { OrderView } from "@/features/orders/components/OrderView";
import { isLocale, type Locale } from "@/shared/i18n/locales";

type OrderPageProps = {
  params: Promise<{ lang: string; publicId: string }>;
};

const copy: Record<Locale, { title: string }> = {
  en: { title: "Your order" },
  de: { title: "Deine Bestellung" },
};

/** Always rendered per request and kept out of search indexes: the content is private and lives in apps/api. */
export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

export default async function OrderPage({ params }: OrderPageProps) {
  const { lang, publicId } = await params;

  if (!isLocale(lang)) {
    notFound();
  }

  const locale: Locale = lang;

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-10">
      <h1 className="mb-6 text-3xl font-semibold tracking-tight text-foreground">
        {copy[locale].title}
      </h1>
      <OrderView locale={locale} publicId={publicId} />
    </main>
  );
}
