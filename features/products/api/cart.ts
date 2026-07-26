import type {
  AddToCartResponse,
  CartItem,
} from "@/features/products/types/cart";

export async function getCartItem(slug: string): Promise<CartItem> {
  const response = await fetch(
    `/api/cart?slug=${encodeURIComponent(slug)}`,
  );

  if (!response.ok) {
    throw new Error("Failed to load cart");
  }

  return response.json() as Promise<CartItem>;
}

export async function addToCart(slug: string): Promise<AddToCartResponse> {
  const response = await fetch("/api/cart", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slug }),
  });

  if (!response.ok) {
    let message = "Could not add to cart.";
    try {
      const data = (await response.json()) as { message?: string };
      if (data.message) {
        message = data.message;
      }
    } catch {
      // keep default message
    }
    throw new Error(message);
  }

  return response.json() as Promise<AddToCartResponse>;
}
