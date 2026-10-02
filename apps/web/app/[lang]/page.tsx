import { notFound } from "next/navigation";

import { getProducts } from "@/features/products/api/products";
import { ProductGrid } from "@/features/products/components/ProductGrid";
import { isLocale, type Locale } from "@/shared/i18n/locales";

type HomePageProps = {
  params: Promise<{ lang: string }>;
};

const copy: Record<
  Locale,
  { title: string; description: string }
> = {
  en: {
    title: "Catalog",
    description: "Furniture and lighting from the collection.",
  },
  de: {
    title: "Katalog",
    description: "Möbel und Leuchten aus der Kollektion.",
  },
};

export default async function HomePage({ params }: HomePageProps) {
  const { lang } = await params;

  if (!isLocale(lang)) {
    notFound();
  }

  const locale: Locale = lang;
  const products = await getProducts(locale);
  const { title, description } = copy[locale];

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6 lg:px-8">
      <header className="mb-10 max-w-2xl">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
          {title}
        </h1>
        <p className="mt-2 text-base text-muted-foreground">{description}</p>
      </header>

      <ProductGrid products={products} locale={locale} />
    </main>
  );
}
