/**
 * Hand-written response shapes for the subset of the Payload REST API that
 * the storefront consumes. Intentionally NOT the generated `payload-types.ts`
 * from apps/cms — that file is CMS-internal. apps/web talks to apps/cms only
 * over HTTP, so it only knows about the public REST JSON shape, exactly like
 * it would for any third-party headless CMS. See
 * docs/adr/0001-monorepo-content-commerce-split.md.
 */
export type CmsMedia = {
  id: number | string;
  url?: string | null;
  thumbnailURL?: string | null;
  alt?: string | null;
};

export type CmsSpecification = {
  label: string;
  value: string;
};

export type CmsProduct = {
  id: number | string;
  slug: string;
  price: number;
  currency: string;
  title: string;
  description?: string | null;
  images?: (number | CmsMedia)[] | null;
  specifications?: CmsSpecification[] | null;
};

export type CmsFindResponse<T> = {
  docs: T[];
  totalDocs: number;
};
