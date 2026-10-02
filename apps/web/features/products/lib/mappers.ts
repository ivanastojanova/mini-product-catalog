import type { CmsMedia, CmsProduct } from "@/shared/cms/types";
import type {
  Product,
  ProductImage,
  ProductSpecification,
} from "@/features/products/types/product";

function isMedia(value: number | string | CmsMedia): value is CmsMedia {
  return typeof value === "object" && value !== null && "id" in value;
}

/**
 * Payload returns media `url` as a path relative to the CMS origin
 * (e.g. `/api/media/file/chair.jpg`). Since apps/cms now serves media from
 * its own origin (distinct from apps/web), prefix with `CMS_API_URL` so
 * `next/image` and `<img>` can load it cross-origin. See
 * next.config.ts `images.remotePatterns`.
 */
function toAbsoluteCmsUrl(url: string | null | undefined): string | null {
  if (!url) {
    return null;
  }
  if (/^https?:\/\//.test(url)) {
    return url;
  }
  const base = process.env.CMS_API_URL?.replace(/\/+$/, "") ?? "";
  return `${base}${url}`;
}

function mapImage(media: CmsMedia): ProductImage {
  const rawUrl = media.url ?? media.thumbnailURL ?? null;

  return {
    id: String(media.id),
    url: toAbsoluteCmsUrl(rawUrl),
    alt: media.alt || "Product image",
  };
}

function mapImages(
  images: CmsProduct["images"],
): ProductImage[] | undefined {
  if (!images?.length) {
    return undefined;
  }

  const mapped = images.filter(isMedia).map(mapImage);
  return mapped.length > 0 ? mapped : undefined;
}

function mapSpecifications(
  specs: CmsProduct["specifications"],
): ProductSpecification[] | undefined {
  if (!specs?.length) {
    return undefined;
  }

  return specs.map((spec) => ({
    label: spec.label,
    value: spec.value,
  }));
}

/** Map a CMS REST product document into the storefront Product shape. */
export function mapProduct(doc: CmsProduct): Product {
  return {
    id: String(doc.id),
    slug: doc.slug,
    price: doc.price,
    currency: doc.currency,
    title: doc.title,
    description: doc.description ?? undefined,
    images: mapImages(doc.images),
    specifications: mapSpecifications(doc.specifications),
  };
}
