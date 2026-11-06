import type { CmsMedia, CmsProduct } from "@/shared/cms/types";
import type {
  Product,
  ProductCategory,
  ProductImage,
  ProductSpecification,
} from "@/features/products/types/product";

function isMedia(value: number | string | CmsMedia): value is CmsMedia {
  return typeof value === "object" && value !== null && "id" in value;
}

function mapImage(media: CmsMedia): ProductImage {
  const rawUrl = media.url ?? media.thumbnailURL ?? null;

  return {
    id: String(media.id),
    // Kept as the CMS returns it (relative); the host is added when rendering, see mediaUrl.ts.
    url: rawUrl,
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

/** A category that was not populated (an id, or missing/deleted) is left off rather than shown half-filled. */
export function mapCategory(
  category: CmsProduct["category"],
): ProductCategory | undefined {
  if (
    typeof category !== "object" ||
    category === null ||
    !category.slug ||
    !category.name
  ) {
    return undefined;
  }

  return { slug: category.slug, name: category.name };
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
    category: mapCategory(doc.category),
    images: mapImages(doc.images),
    specifications: mapSpecifications(doc.specifications),
  };
}
