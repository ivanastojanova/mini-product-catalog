import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cancelOrder, getOrder, listOrders, startPayment } from "./orders";

const fetchMock = vi.fn();

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function lastCall() {
  const [url, init] = fetchMock.mock.calls.at(-1)!;
  return { url: String(url), init: (init ?? {}) as RequestInit };
}

const order = { publicId: "abc", status: "pending_payment" };

describe("orders API wrappers", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://localhost:4000/");
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  describe("getOrder", () => {
    it("GETs the URL-encoded public id with cookies and unwraps the order", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ order }));

      const result = await getOrder("a/b c");

      expect(lastCall().url).toBe("http://localhost:4000/orders/a%2Fb%20c");
      expect(lastCall().init.credentials).toBe("include");
      expect(result).toEqual(order);
    });

    it("returns null for a 404 (missing and not-yours look the same)", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ message: "Order not found" }, 404));
      await expect(getOrder("abc")).resolves.toBeNull();
    });

    it("throws for any other failure, so a server error is not shown as 'not found'", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ message: "boom" }, 500));
      await expect(getOrder("abc")).rejects.toThrow("boom");
    });
  });

  describe("listOrders", () => {
    it("GETs /orders and unwraps the list", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ orders: [order] }));
      await expect(listOrders()).resolves.toEqual([order]);
      expect(lastCall().url).toBe("http://localhost:4000/orders");
      expect(lastCall().init.credentials).toBe("include");
    });

    it("throws on 401", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ message: "Log in to see your orders" }, 401));
      await expect(listOrders()).rejects.toThrow("Log in to see your orders");
    });
  });

  describe("cancelOrder", () => {
    it("POSTs bodiless, with no Content-Type", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ order: { ...order, status: "cancelled" } }));

      const result = await cancelOrder("abc");

      const { url, init } = lastCall();
      expect(url).toBe("http://localhost:4000/orders/abc/cancel");
      expect(init.method).toBe("POST");
      expect(init.credentials).toBe("include");
      expect(init.body).toBeUndefined();
      expect(init.headers).toBeUndefined();
      expect(result.status).toBe("cancelled");
    });

    it("surfaces the server's message when the order can't be cancelled", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ code: "not_cancellable", message: "An order that is paid can't be cancelled." }, 409),
      );
      await expect(cancelOrder("abc")).rejects.toThrow("An order that is paid can't be cancelled.");
    });
  });

  describe("startPayment", () => {
    it("POSTs bodiless to the order's pay route with the locale, and returns the pay URL", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ payUrl: "http://localhost:4100/pay/pi_abc" }));

      const result = await startPayment("a/b c", "de");

      const { url, init } = lastCall();
      expect(url).toBe("http://localhost:4000/orders/a%2Fb%20c/pay?lang=de");
      expect(init.method).toBe("POST");
      expect(init.credentials).toBe("include");
      expect(init.body).toBeUndefined();
      expect(init.headers).toBeUndefined();
      expect(result).toEqual({ payUrl: "http://localhost:4100/pay/pi_abc" });
    });

    it("sends no amount or other payment data: the server reads them from the order", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ payUrl: "https://pay.example.com/pay/pi_abc" }));
      await startPayment("abc", "en");
      expect(lastCall().url).not.toMatch(/amount|currency/i);
    });

    it("surfaces the server's message when the order can't be paid", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ message: "An order that is expired can't be paid." }, 409));
      await expect(startPayment("abc", "en")).rejects.toThrow("expired can't be paid");
    });

    it("surfaces the gateway-unavailable message from a 502", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ message: "The payment service is unavailable. Please try again." }, 502));
      await expect(startPayment("abc", "en")).rejects.toThrow("unavailable");
    });

    it("falls back to a generic message when the error has no body", async () => {
      fetchMock.mockResolvedValue(new Response("", { status: 500 }));
      await expect(startPayment("abc", "en")).rejects.toThrow("Could not start your payment.");
    });

    it.each([
      ["missing", {}],
      ["not a string", { payUrl: 5 }],
      ["a javascript: URL", { payUrl: "javascript:alert(1)" }],
      ["a data: URL", { payUrl: "data:text/html,hi" }],
      ["a relative path", { payUrl: "/pay/pi_abc" }],
      ["not a URL", { payUrl: "nope" }],
    ])("refuses to navigate when payUrl is %s", async (_label, body) => {
      fetchMock.mockResolvedValue(jsonResponse(body));
      await expect(startPayment("abc", "en")).rejects.toThrow("Could not start your payment.");
    });
  });
});
