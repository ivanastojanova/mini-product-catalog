import { notFound } from "next/navigation";

import { getCategories } from "@/features/products/api/categories";
import { getFilteredProducts } from "@/features/products/api/products";
import { ProductFilterBar } from "@/features/products/components/ProductFilterBar";
import { ProductGrid } from "@/features/products/components/ProductGrid";
import { parseProductFilters } from "@/features/products/lib/productFilters";
import { isLocale, type Locale } from "@/shared/i18n/locales";

type HomePageProps = {
  params: Promise<{ lang: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const copy: Record<
  Locale,
  { title: string; description: string; noMatches: string; empty: string }
> = {
  en: {
    title: "Catalog",
    description: "Furniture and lighting from the collection.",
    noMatches: "No products match these filters.",
    empty: "No products yet.",
  },
  de: {
    title: "Katalog",
    description: "Möbel und Leuchten aus der Kollektion.",
    noMatches: "Keine Produkte entsprechen diesen Filtern.",
    empty: "Noch keine Produkte.",
  },
};

export default async function HomePage({ params, searchParams }: HomePageProps) {
  const { lang } = await params;

  if (!isLocale(lang)) {
    notFound();
  }

  const locale: Locale = lang;
  const categories = await getCategories(locale);
  const filters = parseProductFilters(
    await searchParams,
    categories.map((category) => category.slug),
  );
  const products = await getFilteredProducts(locale, filters);
  const { title, description, noMatches, empty } = copy[locale];

  const isFiltered =
    Object.keys(filters).length > 1 || filters.sort !== "title";

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6 lg:px-8">
      <header className="mb-8 max-w-2xl">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
          {title}
        </h1>
        <p className="mt-2 text-base text-muted-foreground">{description}</p>
      </header>

      <ProductFilterBar
        locale={locale}
        categories={categories}
        filters={filters}
      />

      <ProductGrid
        products={products}
        locale={locale}
        emptyMessage={isFiltered ? noMatches : empty}
      />
    </main>
  );
}
