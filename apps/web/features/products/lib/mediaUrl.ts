/**
 * Payload returns media `url` as a path relative to the CMS origin
 * (e.g. `/api/media/file/chair.jpg`). Products are cached with that relative
 * path, and the CMS host is added only when rendering, so changing
 * `CMS_API_URL` never leaves stale absolute URLs in the cache. An already
 * absolute URL is returned unchanged.
 */
export function resolveMediaUrl(
  url: string | null | undefined,
  cmsBaseUrl: string | undefined,
): string | null {
  if (!url) {
    return null;
  }
  if (/^https?:\/\//.test(url)) {
    return url;
  }
  const base = cmsBaseUrl?.replace(/\/+$/, "") ?? "";
  return `${base}${url}`;
}
