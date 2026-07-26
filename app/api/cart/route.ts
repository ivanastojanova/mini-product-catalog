import { NextResponse } from "next/server";

import type {
  AddToCartResponse,
  CartItem,
} from "@/features/products/types/cart";

/** In-memory cart for the optimistic-update demo (resets on server restart). */
const cartBySlug = new Map<string, number>();

function delay(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Simulated cart endpoint — randomly fails (~40%) so optimistic rollbacks
 * are easy to demo. Artificial latency makes the optimistic UI visible.
 */
export async function POST(request: Request) {
  await delay(600 + Math.floor(Math.random() * 400));

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: "Invalid JSON body" }, { status: 400 });
  }

  const slug =
    typeof body === "object" &&
    body !== null &&
    "slug" in body &&
    typeof (body as { slug: unknown }).slug === "string"
      ? (body as { slug: string }).slug.trim()
      : "";

  if (!slug) {
    return NextResponse.json({ message: "Missing slug" }, { status: 400 });
  }

  // ~40% failure — high enough to notice when clicking a few times
  if (Math.random() < 0.4) {
    return NextResponse.json(
      { message: "Could not add to cart. Please try again." },
      { status: 503 },
    );
  }

  const nextQuantity = (cartBySlug.get(slug) ?? 0) + 1;
  cartBySlug.set(slug, nextQuantity);

  return NextResponse.json({
    slug,
    quantity: nextQuantity,
    addedAt: new Date().toISOString(),
  } satisfies AddToCartResponse);
}

/** Optional read of the demo cart (per-process memory). */
export async function GET(request: Request) {
  const slug = new URL(request.url).searchParams.get("slug")?.trim();

  if (!slug) {
    const items: CartItem[] = [...cartBySlug.entries()].map(
      ([itemSlug, quantity]) => ({
        slug: itemSlug,
        quantity,
      }),
    );
    return NextResponse.json({ items });
  }

  return NextResponse.json({
    slug,
    quantity: cartBySlug.get(slug) ?? 0,
  } satisfies CartItem);
}
