import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  addToCart,
  getCart,
  removeCartItem,
  setCartItemQuantity,
} from "./cart";

const fetchMock = vi.fn();

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function lastCall() {
  const [url, init] = fetchMock.mock.calls.at(-1)!;
  return { url: String(url), init: init as RequestInit };
}

describe("cart API wrappers", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://localhost:4000/");
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("sends the cookies cross-origin on every call (credentials: include)", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ items: [] }));

    await getCart();

    expect(lastCall().url).toBe("http://localhost:4000/cart");
    expect(lastCall().init.credentials).toBe("include");
  });

  it("POSTs the slug and quantity as JSON", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ slug: "lamp", quantity: 1 }));

    await addToCart("lamp");

    const { url, init } = lastCall();
    expect(url).toBe("http://localhost:4000/cart/items");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(init.body as string)).toEqual({ slug: "lamp", quantity: 1 });
  });

  it("PUTs an absolute quantity to the URL-encoded slug", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ slug: "a/b c", quantity: 3 }));

    await setCartItemQuantity("a/b c", 3);

    const { url, init } = lastCall();
    expect(url).toBe("http://localhost:4000/cart/items/a%2Fb%20c");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual({ quantity: 3 });
  });

  it("DELETE sends no Content-Type and no body (Fastify answers 400 to a JSON content-type with an empty body)", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await removeCartItem("lamp");

    const { url, init } = lastCall();
    expect(url).toBe("http://localhost:4000/cart/items/lamp");
    expect(init.method).toBe("DELETE");
    expect(init.headers).toBeUndefined();
    expect(init.body).toBeUndefined();
  });

  it("surfaces the server's message on failure", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: "Product not found" }, 404));

    await expect(addToCart("ghost")).rejects.toThrow("Product not found");
  });

  it("falls back to a generic message when the error body isn't JSON", async () => {
    fetchMock.mockResolvedValue(new Response("<html>bad gateway</html>", { status: 502 }));

    await expect(addToCart("lamp")).rejects.toThrow("Could not add to cart.");
  });

  it("turns a network failure into the friendly message", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(addToCart("lamp")).rejects.toThrow("Could not add to cart.");
  });
});
