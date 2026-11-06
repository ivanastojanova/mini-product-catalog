import { MutationObserver, QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { cartKeys } from "@/features/cart/queries/cartKeys";
import { checkoutKeys } from "@/features/checkout/queries/checkoutKeys";

const setCartItemQuantity = vi.fn();
const removeCartItem = vi.fn();
vi.mock("@/features/cart/api/cart", () => ({ setCartItemQuantity, removeCartItem }));

const { removeItemMutationOptions, setQuantityMutationOptions } = await import("./cartItemMutations");

function newClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

describe("cart item mutation options", () => {
  beforeEach(() => {
    setCartItemQuantity.mockReset();
    removeCartItem.mockReset();
  });

  it("sets an absolute quantity and refreshes the cart and the preview", async () => {
    const client = newClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    setCartItemQuantity.mockResolvedValue({ slug: "lamp", quantity: 3 });

    await new MutationObserver(client, setQuantityMutationOptions(client)).mutate({
      slug: "lamp",
      quantity: 3,
    });

    expect(setCartItemQuantity).toHaveBeenCalledWith("lamp", 3);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: cartKeys.current() });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: checkoutKeys.all });
  });

  it("refreshes the views after a failed set too, in case the server applied it", async () => {
    const client = newClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    setCartItemQuantity.mockRejectedValue(new Error("Could not update the cart."));

    await new MutationObserver(client, setQuantityMutationOptions(client))
      .mutate({ slug: "lamp", quantity: 3 })
      .catch(() => undefined);

    expect(invalidate).toHaveBeenCalledWith({ queryKey: cartKeys.current() });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: checkoutKeys.all });
  });

  it("removes a line and refreshes the cart and the preview", async () => {
    const client = newClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    removeCartItem.mockResolvedValue(undefined);

    await new MutationObserver(client, removeItemMutationOptions(client)).mutate("lamp");

    expect(removeCartItem).toHaveBeenCalledWith("lamp");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: cartKeys.current() });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: checkoutKeys.all });
  });
});
