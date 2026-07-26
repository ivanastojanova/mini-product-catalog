import type { Media, Product as PayloadProduct } from "@/payload-types";
import type {
  Product,
  ProductImage,
  ProductSpecification,
} from "@/features/products/types/product";

function isMedia(value: number | Media): value is Media {
  return typeof value === "object" && value !== null && "id" in value;
}

function mapImage(media: Media): ProductImage {
  return {
    id: String(media.id),
    url: media.url ?? media.thumbnailURL ?? null,
    alt: media.alt || "Product image",
  };
}

function mapImages(
  images: PayloadProduct["images"],
): ProductImage[] | undefined {
  if (!images?.length) {
    return undefined;
  }

  const mapped = images.filter(isMedia).map(mapImage);
  return mapped.length > 0 ? mapped : undefined;
}

function mapSpecifications(
  specs: PayloadProduct["specifications"],
): ProductSpecification[] | undefined {
  if (!specs?.length) {
    return undefined;
  }

  return specs.map((spec) => ({
    label: spec.label,
    value: spec.value,
  }));
}

/** Map a Payload product document into the storefront Product shape. */
export function mapProduct(doc: PayloadProduct): Product {
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
