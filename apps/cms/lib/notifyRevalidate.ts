/**
 * apps/cms and apps/web are separate processes/deploys. Payload can no longer
 * call `revalidateTag` in-process (that API only exists inside the Next.js
 * runtime of apps/web). Instead, treat this exactly like a real third-party
 * CMS webhook: fire an authenticated HTTP request at the storefront's
 * `POST /api/revalidate` and let it own its own cache.
 */
type NotifyRevalidateArgs = {
  slug?: string | null;
  previousSlug?: string | null;
};

export async function notifyRevalidate({
  slug,
  previousSlug,
}: NotifyRevalidateArgs): Promise<void> {
  const webAppUrl = process.env.WEB_APP_URL;
  const secret = process.env.REVALIDATE_SECRET;

  if (!webAppUrl || !secret) {
    console.warn(
      "[notifyRevalidate] WEB_APP_URL or REVALIDATE_SECRET not configured — skipping webhook.",
    );
    return;
  }

  try {
    const response = await fetch(`${webAppUrl}/api/revalidate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({ slug, previousSlug }),
    });

    if (!response.ok) {
      console.warn(
        `[notifyRevalidate] Storefront responded ${response.status} for slug "${slug}".`,
      );
    }
  } catch (error) {
    // The storefront may not be running (e.g. during a seed script or when
    // apps/web is deployed separately and temporarily unreachable). A write
    // to the CMS should never fail because the webhook target is down.
    console.warn(
      `[notifyRevalidate] Failed to reach ${webAppUrl} — is apps/web running?`,
      error instanceof Error ? error.message : error,
    );
  }
}
