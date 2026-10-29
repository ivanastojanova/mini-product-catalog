import type { CmsProduct } from "../../cart/lib/cmsClient.js";
import { toMinorUnits } from "./money.js";

export type PricingProblem = "unknown_product" | "insufficient_stock";

export type PricedLine = {
  slug: string;
  title: string;
  unitPriceCents: number;
  quantity: number;
  lineTotalCents: number;
  available: number;
  problem?: PricingProblem;
};

export type PricedCart =
  | { ok: true; currency: string | null; items: PricedLine[]; subtotalCents: number }
  | { ok: false; reason: "mixed_currency"; currencies: string[] };

/**
 * Prices a cart exactly as an order would be: CMS price (to integer cents) x
 * quantity per line, summed. Shared by the checkout preview and `POST /orders`,
 * so the number the shopper reviews is computed by the same code that charges.
 *
 * - A slug the CMS doesn't know stays in the result flagged `unknown_product`
 *   (price 0, not counted in the subtotal) so the shopper can see and remove it.
 * - A line asking for more than is available is flagged `insufficient_stock`
 *   but still priced.
 * - Lines in different currencies can't be summed: the whole cart is rejected.
 *   `currency` is null for a cart with no priceable lines.
 * - Lines keep the cart's order.
 */
export function priceCart(
  lines: Array<{ slug: string; quantity: number }>,
  products: Map<string, CmsProduct>,
  availability: Map<string, number>,
): PricedCart {
  const currencies = [
    ...new Set(
      lines.flatMap((line) => {
        const product = products.get(line.slug);
        return product ? [product.currency] : [];
      }),
    ),
  ];

  if (currencies.length > 1) {
    return { ok: false, reason: "mixed_currency", currencies };
  }

  const items: PricedLine[] = lines.map((line) => {
    const product = products.get(line.slug);
    const available = availability.get(line.slug) ?? 0;

    if (!product) {
      return {
        slug: line.slug,
        title: line.slug,
        unitPriceCents: 0,
        quantity: line.quantity,
        lineTotalCents: 0,
        available,
        problem: "unknown_product",
      };
    }

    const unitPriceCents = toMinorUnits(product.price);
    const priced: PricedLine = {
      slug: line.slug,
      title: product.title,
      unitPriceCents,
      quantity: line.quantity,
      lineTotalCents: unitPriceCents * line.quantity,
      available,
    };

    return available < line.quantity ? { ...priced, problem: "insufficient_stock" } : priced;
  });

  return {
    ok: true,
    currency: currencies[0] ?? null,
    items,
    subtotalCents: items.reduce((sum, item) => sum + item.lineTotalCents, 0),
  };
}
