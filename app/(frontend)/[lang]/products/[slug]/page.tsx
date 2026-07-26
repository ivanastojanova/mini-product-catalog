import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  getProductBySlug,
  getProductSlugs,
} from "@/features/products/api/products";
import { ProductGallery } from "@/features/products/components/ProductGallery";
import { ProductHeader } from "@/features/products/components/ProductHeader";
import { ProductSpecs } from "@/features/products/components/ProductSpecs";
import { isLocale, locales, type Locale } from "@/shared/i18n/locales";
import { localizedPath } from "@/shared/i18n/routing";

type ProductPageProps = {
  params: Promise<{ lang: string; slug: string }>;
};

const backCopy: Record<Locale, string> = {
  en: "Back to catalog",
  de: "Zurück zum Katalog",
};

export async function generateStaticParams() {
  const slugs = await getProductSlugs();

  return locales.flatMap((lang) =>
    slugs.map((slug) => ({
      lang,
      slug,
    })),
  );
}

export async function generateMetadata({
  params,
}: ProductPageProps): Promise<Metadata> {
  const { lang, slug } = await params;

  if (!isLocale(lang)) {
    return { title: "Product" };
  }

  const product = await getProductBySlug(slug, lang);

  if (!product) {
    return { title: "Product not found" };
  }

  return {
    title: product.title,
    description: product.description ?? undefined,
  };
}

export default async function ProductPage({ params }: ProductPageProps) {
  const { lang, slug } = await params;

  if (!isLocale(lang)) {
    notFound();
  }

  const locale: Locale = lang;
  const product = await getProductBySlug(slug, locale);

  if (!product) {
    notFound();
  }

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6 lg:px-8">
      <p className="mb-8">
        <Link
          href={localizedPath(locale)}
          className="text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          ← {backCopy[locale]}
        </Link>
      </p>

      <div className="grid grid-cols-1 gap-10 lg:grid-cols-2 lg:gap-14">
        <ProductGallery images={product.images} title={product.title} />

        <div className="flex flex-col gap-10">
          <ProductHeader product={product} locale={locale} />
          <ProductSpecs
            specifications={product.specifications}
            locale={locale}
          />
        </div>
      </div>
    </main>
  );
}
