import { NextResponse } from "next/server";

import type { ProductStock } from "@/features/products/types/product";

type RouteContext = {
  params: Promise<{ slug: string }>;
};

/** Deterministic pseudo-inventory from slug (stable across requests, not from CMS). */
function simulateStock(slug: string): Omit<ProductStock, "updatedAt"> {
  let hash = 0;
  for (let i = 0; i < slug.length; i += 1) {
    hash = (hash * 31 + slug.charCodeAt(i)) >>> 0;
  }

  const quantity = hash % 12; // 0–11 units

  return {
    slug,
    inStock: quantity > 0,
    quantity,
  };
}

function delay(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Simulated inventory endpoint — intentionally not backed by Payload.
 * Artificial latency makes loading states visible on the product page.
 */
export async function GET(request: Request, context: RouteContext) {
  const { slug } = await context.params;
  const fail = new URL(request.url).searchParams.get("fail") === "1";

  await delay(500 + (slug.length % 5) * 100);

  if (fail) {
    return NextResponse.json(
      { message: "Inventory service unavailable" },
      { status: 503 },
    );
  }

  if (!slug) {
    return NextResponse.json({ message: "Missing slug" }, { status: 400 });
  }

  const stock = simulateStock(slug);

  return NextResponse.json({
    ...stock,
    updatedAt: new Date().toISOString(),
  } satisfies ProductStock);
}
