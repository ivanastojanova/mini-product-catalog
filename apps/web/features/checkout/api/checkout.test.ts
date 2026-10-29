import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CheckoutError, getCheckoutPreview, placeOrder } from "./checkout";

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

const input = {
  email: "ada@example.com",
  shippingAddress: {
    name: "Ada",
    line1: "1 Main St",
    city: "Berlin",
    postalCode: "10115",
    country: "DE",
  },
};

const order = { publicId: "abc", status: "pending_payment", totalCents: 1000 };

async function failure(
  body: unknown,
  status: number,
  respond: () => Response = () => jsonResponse(body, status),
): Promise<CheckoutError> {
  fetchMock.mockResolvedValue(respond());
  try {
    await placeOrder(input, "key-12345678");
  } catch (error) {
    return error as CheckoutError;
  }
  throw new Error("expected placeOrder to throw");
}

describe("checkout API wrappers", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://localhost:4000/");
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  describe("getCheckoutPreview", () => {
    it("GETs the preview with the locale and sends cookies", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ currency: "EUR", items: [], subtotalCents: 0 }),
      );

      const preview = await getCheckoutPreview("de");

      expect(lastCall().url).toBe("http://localhost:4000/checkout/preview?locale=de");
      expect(lastCall().init.credentials).toBe("include");
      expect(preview.subtotalCents).toBe(0);
    });

    it("surfaces the server's message on failure", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ message: "Could not load product prices." }, 502));
      await expect(getCheckoutPreview("en")).rejects.toThrow("Could not load product prices.");
    });
  });

  describe("placeOrder", () => {
    it("POSTs the address as JSON with the Idempotency-Key header and cookies", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ order }, 201));

      const result = await placeOrder(input, "key-12345678");

      const { url, init } = lastCall();
      expect(url).toBe("http://localhost:4000/orders");
      expect(init.method).toBe("POST");
      expect(init.credentials).toBe("include");
      expect(init.headers).toEqual({
        "Content-Type": "application/json",
        "Idempotency-Key": "key-12345678",
      });
      expect(JSON.parse(init.body as string)).toEqual(input);
      expect(result).toEqual(order);
    });

    it("never sends prices, totals or currency", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ order }, 201));
      await placeOrder(input, "key-12345678");
      const sent = lastCall().init.body as string;
      expect(sent).not.toMatch(/price|total|currency|cents/i);
    });

    it("returns the order for an idempotent replay (200) too", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ order }, 200));
      await expect(placeOrder(input, "key-12345678")).resolves.toEqual(order);
    });

    it("insufficient_stock carries the short lines", async () => {
      const error = await failure(
        {
          code: "insufficient_stock",
          message: "Some items are no longer available.",
          items: [{ slug: "lamp", requested: 3, available: 1 }],
        },
        409,
      );
      expect(error).toBeInstanceOf(CheckoutError);
      expect(error.code).toBe("insufficient_stock");
      expect(error.details.shortItems).toEqual([{ slug: "lamp", requested: 3, available: 1 }]);
    });

    it("unavailable_items carries the slugs", async () => {
      const error = await failure(
        { code: "unavailable_items", message: "Gone.", items: ["old-chair"] },
        409,
      );
      expect(error.code).toBe("unavailable_items");
      expect(error.details.unavailableSlugs).toEqual(["old-chair"]);
    });

    it("open_order carries the id of the unpaid order, so the UI can link to it", async () => {
      const error = await failure(
        { code: "open_order", message: "You already have an unpaid order.", orderPublicId: "pub123" },
        409,
      );
      expect(error.code).toBe("open_order");
      expect(error.details.orderPublicId).toBe("pub123");
    });

    it.each(["empty_cart", "mixed_currency", "key_conflict", "cart_changed"])(
      "maps the %s refusal to its code",
      async (code) => {
        const error = await failure({ code, message: "Nope." }, 409);
        expect(error.code).toBe(code);
        expect(error.message).toBe("Nope.");
      },
    );

    it("a 400 with a field becomes invalid_field naming that field", async () => {
      const error = await failure(
        { message: "City is required.", field: "shippingAddress.city" },
        400,
      );
      expect(error.code).toBe("invalid_field");
      expect(error.details.field).toBe("shippingAddress.city");
      expect(error.message).toBe("City is required.");
    });

    it("an unrecognised 409 code is 'unknown', not trusted as a known one", async () => {
      const error = await failure({ code: "something_new", message: "Hm." }, 409);
      expect(error.code).toBe("unknown");
      expect(error.message).toBe("Hm.");
    });

    it("a 400 about the Idempotency-Key (no field) is 'unknown'", async () => {
      const error = await failure({ message: "An Idempotency-Key header is required" }, 400);
      expect(error.code).toBe("unknown");
    });

    it("a 502 and a non-JSON error body both become a generic 'unknown' error", async () => {
      expect((await failure({ message: "Could not load product prices." }, 502)).code).toBe("unknown");

      const error = await failure(null, 500, () => new Response("<html>oops</html>", { status: 500 }));
      expect(error.code).toBe("unknown");
      expect(error.message).toBe("Could not place your order.");
    });

    it("a network failure becomes an 'unknown' CheckoutError the UI can retry", async () => {
      fetchMock.mockRejectedValue(new TypeError("fetch failed"));
      const error = await placeOrder(input, "key-12345678").then(
        () => {
          throw new Error("expected placeOrder to throw");
        },
        (e: unknown) => e as CheckoutError,
      );
      expect(error).toBeInstanceOf(CheckoutError);
      expect(error.code).toBe("unknown");
    });
  });
});
