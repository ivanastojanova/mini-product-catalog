/**
 * apps/api's origin — a genuinely separate service from apps/web (see
 * docs/adr/0004-standalone-commerce-api-service.md), reached from the
 * browser, so this must be a `NEXT_PUBLIC_` var, not a server-only one.
 */
function apiBaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_API_URL;
  if (!url) {
    throw new Error("NEXT_PUBLIC_API_URL is not configured");
  }
  return url.replace(/\/+$/, "");
}

/**
 * fetch against apps/api. Every call is cross-origin, so `credentials:
 * "include"` is required or the browser won't send/store the session and
 * cart cookies, regardless of apps/api's CORS headers being correct.
 *
 * Callers set `Content-Type: application/json` only when they send a body —
 * Fastify answers 400 to that header on an empty body.
 */
export function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${apiBaseUrl()}${path}`, {
    ...init,
    credentials: "include",
  });
}

/** Extracts a server error message, falling back to a generic one if the body isn't JSON or has no `message`. */
export async function extractErrorMessage(
  response: Response,
  fallback: string,
): Promise<string> {
  try {
    const data = (await response.json()) as { message?: string };
    return data.message ?? fallback;
  } catch {
    return fallback;
  }
}
