import { apiFetch, extractErrorMessage } from "@/shared/api/client";
import type { Cart, CartLine } from "@/features/cart/types/cart";

/** The browser's cart: the customer's when logged in, otherwise the guest cart behind the `cart_token` cookie. */
export async function getCart(): Promise<Cart> {
  const response = await apiFetch("/cart");

  if (!response.ok) {
    throw new Error("Failed to load cart");
  }

  return response.json() as Promise<Cart>;
}

/** Increment a line (server clamps at the per-line max). Server messages (unknown product, CMS down) are surfaced as-is. */
export async function addToCart(slug: string, quantity = 1): Promise<CartLine> {
  let response: Response;
  try {
    response = await apiFetch("/cart/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug, quantity }),
    });
  } catch {
    throw new Error("Could not add to cart.");
  }

  if (!response.ok) {
    throw new Error(await extractErrorMessage(response, "Could not add to cart."));
  }

  return response.json() as Promise<CartLine>;
}

/** Set a line already in the cart to an absolute quantity (idempotent). */
export async function setCartItemQuantity(
  slug: string,
  quantity: number,
): Promise<CartLine> {
  const response = await apiFetch(`/cart/items/${encodeURIComponent(slug)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ quantity }),
  });

  if (!response.ok) {
    throw new Error(
      await extractErrorMessage(response, "Could not update the cart."),
    );
  }

  return response.json() as Promise<CartLine>;
}

/** Remove a line (idempotent). Deliberately no Content-Type: bodiless requests with it get a 400 from Fastify. */
export async function removeCartItem(slug: string): Promise<void> {
  const response = await apiFetch(`/cart/items/${encodeURIComponent(slug)}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    throw new Error(
      await extractErrorMessage(response, "Could not update the cart."),
    );
  }
}
