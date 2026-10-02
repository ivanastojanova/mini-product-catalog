import type { Product } from "@/features/products/types/product";
import { productCacheTags } from "@/features/products/lib/cacheTags";
import { mapProduct } from "@/features/products/lib/mappers";
import type { Locale } from "@/shared/i18n/locales";
import { cmsFetch } from "@/shared/cms/client";
import type { CmsFindResponse, CmsProduct } from "@/shared/cms/types";
import { unstable_cache } from "next/cache";

async function fetchProducts(locale: Locale): Promise<Product[]> {
  const result = await cmsFetch<CmsFindResponse<CmsProduct>>("/api/products", {
    searchParams: {
      locale,
      depth: 1,
      limit: 100,
      sort: "title",
    },
  });

  return result.docs.map(mapProduct);
}

async function fetchProduct(
  slug: string,
  locale: Locale,
): Promise<Product | null> {
  const result = await cmsFetch<CmsFindResponse<CmsProduct>>("/api/products", {
    searchParams: {
      locale,
      depth: 1,
      limit: 1,
      "where[slug][equals]": slug,
    },
  });

  const doc = result.docs[0];
  return doc ? mapProduct(doc) : null;
}

/**
 * Locale-aware CMS accessors over the apps/cms REST API.
 * Results are cached indefinitely and invalidated via `revalidateTag`.
 */
export async function getProducts(locale: Locale): Promise<Product[]> {
  const getCached = unstable_cache(
    async () => fetchProducts(locale),
    ["products", locale],
    { tags: [productCacheTags.all] },
  );

  return getCached();
}

/** Slugs only — used by `generateStaticParams` at build time (uncached). */
export async function getProductSlugs(): Promise<string[]> {
  const result = await cmsFetch<CmsFindResponse<Pick<CmsProduct, "slug">>>(
    "/api/products",
    {
      searchParams: {
        depth: 0,
        limit: 1000,
        "select[slug]": true,
      },
    },
  );

  return result.docs
    .map((doc) => doc.slug)
    .filter((slug): slug is string => Boolean(slug));
}

export async function getProduct(
  slug: string,
  locale: Locale,
): Promise<Product | null> {
  const getCached = unstable_cache(
    async () => fetchProduct(slug, locale),
    ["product", slug, locale],
    { tags: [productCacheTags.bySlug(slug)] },
  );

  return getCached();
}

/** Alias kept for existing call sites. */
export async function getProductBySlug(
  slug: string,
  locale: Locale,
): Promise<Product | null> {
  return getProduct(slug, locale);
}
