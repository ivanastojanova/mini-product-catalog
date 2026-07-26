import type { Product as PayloadProduct } from "@/payload-types";
import type { Product } from "@/features/products/types/product";
import { productCacheTags } from "@/features/products/lib/cacheTags";
import { mapProduct } from "@/features/products/lib/mappers";
import type { Locale } from "@/shared/i18n/locales";
import { getPayloadClient } from "@/shared/cms/payload";
import { unstable_cache } from "next/cache";

async function fetchProducts(locale: Locale): Promise<Product[]> {
  const payload = await getPayloadClient();

  const result = await payload.find({
    collection: "products",
    locale,
    depth: 1,
    limit: 100,
    sort: "title",
  });

  return result.docs.map((doc) => mapProduct(doc as PayloadProduct));
}

async function fetchProduct(
  slug: string,
  locale: Locale,
): Promise<Product | null> {
  const payload = await getPayloadClient();

  const result = await payload.find({
    collection: "products",
    locale,
    depth: 1,
    limit: 1,
    where: {
      slug: {
        equals: slug,
      },
    },
  });

  const doc = result.docs[0] as PayloadProduct | undefined;
  return doc ? mapProduct(doc) : null;
}

/**
 * Locale-aware CMS accessors via Payload Local API.
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
  const payload = await getPayloadClient();

  const result = await payload.find({
    collection: "products",
    depth: 0,
    limit: 1000,
    select: {
      slug: true,
    },
  });

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
