import { MutationObserver, QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { cartKeys } from "@/features/cart/queries/cartKeys";
import type { Cart } from "@/features/cart/types/cart";

const addToCart = vi.fn();
vi.mock("@/features/cart/api/cart", () => ({ addToCart }));

const { addToCartMutationOptions } = await import("./addToCartMutation");

function newClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

/** A promise the test resolves/rejects by hand, to observe the cache *while* the request is in flight. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const cacheOf = (client: QueryClient) =>
  client.getQueryData<Cart>(cartKeys.current());

describe("addToCartMutationOptions", () => {
  beforeEach(() => {
    addToCart.mockReset();
  });

  it("bumps the cached quantity immediately, before the server answers", async () => {
    const client = newClient();
    client.setQueryData<Cart>(cartKeys.current(), {
      items: [{ slug: "lamp", quantity: 1 }],
    });
    const request = deferred<{ slug: string; quantity: number }>();
    addToCart.mockReturnValue(request.promise);

    const pending = new MutationObserver(client, addToCartMutationOptions(client, "lamp")).mutate();
    await vi.waitFor(() =>
      expect(cacheOf(client)).toEqual({ items: [{ slug: "lamp", quantity: 2 }] }),
    );

    request.resolve({ slug: "lamp", quantity: 2 });
    await pending;
  });

  it("settles on the server's quantity, which may differ from the guess (clamped)", async () => {
    const client = newClient();
    client.setQueryData<Cart>(cartKeys.current(), {
      items: [{ slug: "lamp", quantity: 5 }],
    });
    addToCart.mockResolvedValue({ slug: "lamp", quantity: 9 });

    await new MutationObserver(client, addToCartMutationOptions(client, "lamp")).mutate();

    expect(cacheOf(client)).toEqual({ items: [{ slug: "lamp", quantity: 9 }] });
  });

  it("rolls back to the previous cart when the request fails, keeping other lines", async () => {
    const client = newClient();
    const before: Cart = {
      items: [
        { slug: "lamp", quantity: 1 },
        { slug: "desk", quantity: 4 },
      ],
    };
    client.setQueryData<Cart>(cartKeys.current(), before);
    const request = deferred<never>();
    addToCart.mockReturnValue(request.promise);

    const pending = new MutationObserver(client, addToCartMutationOptions(client, "lamp"))
      .mutate()
      .catch((error: Error) => error);
    await vi.waitFor(() => expect(cacheOf(client)?.items[0].quantity).toBe(2));

    request.reject(new Error("Product not found"));
    const error = await pending;

    expect(error).toEqual(new Error("Product not found"));
    expect(cacheOf(client)).toEqual(before);
  });

  it("rolls back a first-ever add to the empty cart it started from", async () => {
    const client = newClient();
    client.setQueryData<Cart>(cartKeys.current(), { items: [] });
    addToCart.mockRejectedValue(new Error("Could not add to cart."));

    await new MutationObserver(client, addToCartMutationOptions(client, "lamp"))
      .mutate()
      .catch(() => undefined);

    expect(cacheOf(client)).toEqual({ items: [] });
  });

  it("refetches instead of guessing when it fails before the cart was ever loaded", async () => {
    const client = newClient();
    addToCart.mockRejectedValue(new Error("boom"));
    const invalidate = vi.spyOn(client, "invalidateQueries");

    await new MutationObserver(client, addToCartMutationOptions(client, "lamp"))
      .mutate()
      .catch(() => undefined);

    expect(invalidate).toHaveBeenCalledWith({ queryKey: cartKeys.current() });
  });

  it("does not touch other products' lines on success", async () => {
    const client = newClient();
    client.setQueryData<Cart>(cartKeys.current(), {
      items: [{ slug: "desk", quantity: 4 }],
    });
    addToCart.mockResolvedValue({ slug: "lamp", quantity: 1 });

    await new MutationObserver(client, addToCartMutationOptions(client, "lamp")).mutate();

    expect(cacheOf(client)?.items).toEqual([
      { slug: "desk", quantity: 4 },
      { slug: "lamp", quantity: 1 },
    ]);
  });
});
