import "server-only";

/**
 * Thin REST client for apps/cms (Payload). This is a real network call
 * (`fetch`, not the Payload Local API) because apps/web and apps/cms are
 * separate deployable services now — see
 * docs/adr/0001-monorepo-content-commerce-split.md.
 *
 * Server-only: never import this from a client component. The storefront's
 * own `app/api/*` routes are the client-callable boundary.
 */
function cmsBaseUrl(): string {
  const url = process.env.CMS_API_URL;
  if (!url) {
    throw new Error("CMS_API_URL is not configured");
  }
  return url.replace(/\/+$/, "");
}

type CmsFetchOptions = {
  searchParams?: Record<string, string | number | boolean | undefined>;
  /** Forwarded to `fetch`'s Next.js cache extensions. */
  next?: NextFetchRequestConfig;
};

/**
 * GET a Payload REST endpoint (e.g. `/api/products`) and parse JSON.
 * Throws on non-2xx so callers can decide how to surface CMS outages.
 */
export async function cmsFetch<T>(
  path: string,
  options: CmsFetchOptions = {},
): Promise<T> {
  const url = new URL(`${cmsBaseUrl()}${path}`);

  for (const [key, value] of Object.entries(options.searchParams ?? {})) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(url, { next: options.next });

  if (!response.ok) {
    throw new Error(
      `CMS request failed: ${response.status} ${response.statusText} (${url.pathname})`,
    );
  }

  return response.json() as Promise<T>;
}
