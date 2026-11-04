import type { Product } from "@/features/products/types/product";
import { productCacheTags } from "@/features/products/lib/cacheTags";
import { mapProduct } from "@/features/products/lib/mappers";
import { getStockBatch } from "@/features/products/api/stock";
import { applyLiveFilters } from "@/features/products/lib/liveFilters";
import {
  DEFAULT_SORT,
  hasLiveFacet,
  type ProductFilters,
} from "@/features/products/lib/productFilters";
import {
  buildProductSearchParams,
  isCacheableQuery,
  productQueryCacheKey,
} from "@/features/products/lib/productQuery";
import type { Locale } from "@/shared/i18n/locales";
import { cmsFetch } from "@/shared/cms/client";
import type { CmsFindResponse, CmsProduct } from "@/shared/cms/types";
import { unstable_cache } from "next/cache";

async function fetchProducts(
  locale: Locale,
  filters: ProductFilters,
): Promise<Product[]> {
  const result = await cmsFetch<CmsFindResponse<CmsProduct>>("/api/products", {
    searchParams: buildProductSearchParams(filters, locale),
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
 *
 * `filters` are the catalog facets from `parseProductFilters` (category, price,
 * text, sort); live facets are applied by the caller. Queries with a finite set
 * of values are cached; free text and price bounds call the CMS live (see
 * `isCacheableQuery`).
 */
export async function getProducts(
  locale: Locale,
  filters: ProductFilters = { sort: DEFAULT_SORT },
): Promise<Product[]> {
  if (!isCacheableQuery(filters)) {
    return fetchProducts(locale, filters);
  }

  const getCached = unstable_cache(
    async () => fetchProducts(locale, filters),
    productQueryCacheKey(locale, filters),
    { tags: [productCacheTags.all] },
  );

  return getCached();
}

/**
 * The storefront's filtered list: the CMS query (`getProducts`), then, only if
 * a live facet is set, apps/api's stock narrows it. The stock step is never
 * cached. If apps/api is unreachable this throws rather than returning the
 * unfiltered list, which would show out-of-stock items under an "in stock"
 * filter; the page's error boundary handles it.
 */
export async function getFilteredProducts(
  locale: Locale,
  filters: ProductFilters,
): Promise<Product[]> {
  const products = await getProducts(locale, filters);

  if (!hasLiveFacet(filters) || products.length === 0) {
    return products;
  }

  const available = await getStockBatch(products.map((p) => p.slug));
  return applyLiveFilters(products, available, filters);
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
