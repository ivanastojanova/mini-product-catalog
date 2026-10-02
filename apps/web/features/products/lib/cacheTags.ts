/** Next.js cache tags for CMS product data. */

export const productCacheTags = {
  /** Shared by the catalog listing for every locale. */
  all: "products",
  /** One product detail (all locales share this tag; locale is in the cache key). */
  bySlug: (slug: string) => `product:${slug}`,
} as const;
