import { NextResponse } from "next/server";

import { revalidateProductCache } from "@/shared/cms/revalidateProductCache";

type RevalidateBody = {
  slug?: string;
  previousSlug?: string;
  /** When true, only invalidate the listing tag (e.g. bulk ops). */
  listingOnly?: boolean;
};

function isAuthorized(request: Request): boolean {
  const secret = process.env.REVALIDATE_SECRET;

  if (!secret) {
    return false;
  }

  const header = request.headers.get("authorization");
  if (header === `Bearer ${secret}`) {
    return true;
  }

  // Also accept a dedicated header for simple webhook tools.
  return request.headers.get("x-revalidate-secret") === secret;
}

/**
 * On-demand cache invalidation for CMS product writes.
 *
 * POST /api/revalidate
 * Authorization: Bearer <REVALIDATE_SECRET>
 * Body: { "slug": "malmo-lounge-chair", "previousSlug?": "old-slug" }
 */
export async function POST(request: Request) {
  if (!process.env.REVALIDATE_SECRET) {
    return NextResponse.json(
      { revalidated: false, message: "REVALIDATE_SECRET is not configured" },
      { status: 500 },
    );
  }

  if (!isAuthorized(request)) {
    return NextResponse.json(
      { revalidated: false, message: "Unauthorized" },
      { status: 401 },
    );
  }

  let body: RevalidateBody = {};

  try {
    body = (await request.json()) as RevalidateBody;
  } catch {
    body = {};
  }

  const tags = body.listingOnly
    ? revalidateProductCache({})
    : revalidateProductCache({
        slug: body.slug,
        previousSlug: body.previousSlug,
      });

  return NextResponse.json({
    revalidated: true,
    tags,
    now: Date.now(),
  });
}
