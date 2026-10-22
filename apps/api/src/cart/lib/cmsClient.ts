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
