/**
 * Thin client for apps/cms (Payload REST). apps/api treats the CMS like any
 * third-party service — plain HTTP, no shared code (ADR 0001).
 */
function cmsBaseUrl(): string {
  return (process.env.CMS_API_URL ?? "http://localhost:3001").replace(/\/+$/, "");
}

/**
 * Whether a product with this slug exists in the catalog. Resolves false only
 * when the CMS answered and found nothing; throws if the CMS is unreachable or
 * errors, so callers can tell "unknown product" (404) from "can't check" (502).
 */
export async function productExists(slug: string): Promise<boolean> {
  const url = new URL(`${cmsBaseUrl()}/api/products`);
  url.searchParams.set("limit", "1");
  url.searchParams.set("depth", "0");
  url.searchParams.set("select[slug]", "true");
  url.searchParams.set("where[slug][equals]", slug);

  const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) {
    throw new Error(`CMS request failed: ${response.status} (${url.pathname})`);
  }

  const result = (await response.json()) as { docs?: unknown[] };
  return (result.docs?.length ?? 0) > 0;
}

const SLUG_PAGE_SIZE = 100;
/** Guards against a CMS that never reports `hasNextPage: false`. */
const MAX_SLUG_PAGES = 100;

/**
 * Every product slug in the catalog, following Payload's pagination. Throws if
 * the CMS is unreachable or errors, so a seed run can't mistake "CMS down" for
 * "no products".
 */
export async function listProductSlugs(): Promise<string[]> {
  const slugs: string[] = [];

  for (let page = 1; page <= MAX_SLUG_PAGES; page += 1) {
    const url = new URL(`${cmsBaseUrl()}/api/products`);
    url.searchParams.set("limit", String(SLUG_PAGE_SIZE));
    url.searchParams.set("page", String(page));
    url.searchParams.set("depth", "0");
    url.searchParams.set("select[slug]", "true");

    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) {
      throw new Error(`CMS request failed: ${response.status} (${url.pathname})`);
    }

    const result = (await response.json()) as {
      docs?: Array<{ slug?: unknown }>;
      hasNextPage?: boolean;
    };

    for (const doc of result.docs ?? []) {
      if (typeof doc.slug === "string" && doc.slug.length > 0) {
        slugs.push(doc.slug);
      }
    }

    if (!result.hasNextPage) {
      return slugs;
    }
  }

  throw new Error(`CMS product list exceeded ${MAX_SLUG_PAGES} pages`);
}

export type CmsProduct = {
  slug: string;
  title: string;
  price: number;
  currency: string;
};

/** Payload's `where[slug][in]` goes in the query string, so this bounds how many slugs one call may ask for. */
const MAX_BATCH_SLUGS = 50;

/**
 * Title, price and currency for several slugs in ONE request (`where[slug][in]`),
 * keyed by slug. Slugs the CMS doesn't know are simply absent from the map, so
 * callers can tell "unknown product" from a failure. `locale` only affects the
 * title; price and currency aren't localized. Throws if the CMS is unreachable,
 * errors, or returns a product without a usable price, so a bad CMS value fails
 * the request instead of being priced at 0 or NaN.
 */
export async function getProductsBySlugs(
  slugs: string[],
  locale = "en",
): Promise<Map<string, CmsProduct>> {
  const unique = [...new Set(slugs)];
  const products = new Map<string, CmsProduct>();
  if (unique.length === 0) {
    return products;
  }
  if (unique.length > MAX_BATCH_SLUGS) {
    throw new RangeError(`Cannot look up more than ${MAX_BATCH_SLUGS} products at once`);
  }

  const url = new URL(`${cmsBaseUrl()}/api/products`);
  url.searchParams.set("limit", String(unique.length));
  url.searchParams.set("depth", "0");
  url.searchParams.set("locale", locale);
  url.searchParams.set("where[slug][in]", unique.join(","));
  for (const field of ["slug", "title", "price", "currency"]) {
    url.searchParams.set(`select[${field}]`, "true");
  }

  const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) {
    throw new Error(`CMS request failed: ${response.status} (${url.pathname})`);
  }

  const result = (await response.json()) as { docs?: Array<Record<string, unknown>> };

  for (const doc of result.docs ?? []) {
    const { slug, title, price, currency } = doc;
    if (
      typeof slug !== "string" ||
      typeof title !== "string" ||
      typeof price !== "number" ||
      !Number.isFinite(price) ||
      price < 0 ||
      typeof currency !== "string" ||
      currency.length === 0
    ) {
      throw new Error(`CMS returned an unusable product (${String(slug)})`);
    }
    products.set(slug, { slug, title, price, currency });
  }

  return products;
}
