import { revalidateTag } from "next/cache";

import { productCacheTags } from "@/features/products/lib/cacheTags";

type RevalidateProductArgs = {
  slug?: string | null;
  previousSlug?: string | null;
};

/**
 * Targeted invalidation after a CMS product write.
 * - Always refresh the listing (`products`)
 * - Refresh the changed product detail (`product:slug`)
 * - If the slug renamed, also drop the old detail tag
 */
export function revalidateProductCache({
  slug,
  previousSlug,
}: RevalidateProductArgs): string[] {
  const tags = new Set<string>([productCacheTags.all]);

  if (slug) {
    tags.add(productCacheTags.bySlug(slug));
  }

  if (previousSlug && previousSlug !== slug) {
    tags.add(productCacheTags.bySlug(previousSlug));
  }

  const invalidated = [...tags];

  for (const tag of invalidated) {
    // Immediate expire so the next request refetches (CMS webhook-style).
    revalidateTag(tag, { expire: 0 });
  }

  return invalidated;
}
