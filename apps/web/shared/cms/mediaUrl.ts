import "server-only";

import { resolveMediaUrl } from "@/features/products/lib/mediaUrl";
import type { ProductImage } from "@/features/products/types/product";

/** Full URL for a CMS media path, for server components that render images. */
export function cmsMediaUrl(url: string | null | undefined): string | null {
  return resolveMediaUrl(url, process.env.CMS_API_URL);
}

/** Images with absolute URLs, for handing to a client component (which cannot read `CMS_API_URL`). */
export function withAbsoluteImageUrls(
  images: ProductImage[] | undefined,
): ProductImage[] | undefined {
  return images?.map((image) => ({ ...image, url: cmsMediaUrl(image.url) }));
}
