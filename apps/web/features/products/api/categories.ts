import { unstable_cache } from "next/cache";

import { productCacheTags } from "@/features/products/lib/cacheTags";
import type { ProductCategory } from "@/features/products/types/product";
import { cmsFetch } from "@/shared/cms/client";
import type { CmsCategory, CmsFindResponse } from "@/shared/cms/types";
import type { Locale } from "@/shared/i18n/locales";

async function fetchCategories(locale: Locale): Promise<ProductCategory[]> {
  const result = await cmsFetch<CmsFindResponse<CmsCategory>>(
    "/api/categories",
    {
      searchParams: { locale, depth: 0, limit: 100, sort: "name" },
    },
  );

  return result.docs.map(({ slug, name }) => ({ slug, name }));
}

/**
 * Every category, including ones with no products, sorted by the localized name.
 * Shares the `products` tag: a category edit in the CMS already fires the
 * listing webhook (apps/cms/collections/Category.ts), so no new invalidation
 * path is needed.
 */
export async function getCategories(
  locale: Locale,
): Promise<ProductCategory[]> {
  const getCached = unstable_cache(
    async () => fetchCategories(locale),
    ["categories", locale],
    { tags: [productCacheTags.all] },
  );

  return getCached();
}
