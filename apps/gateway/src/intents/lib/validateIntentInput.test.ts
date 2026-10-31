import { describe, expect, it } from "vitest";

import { validateIntentInput } from "./validateIntentInput.js";

const ORIGIN = "http://localhost:3000";
const good = {
  amountCents: 132000,
  currency: "EUR",
  orderId: "order_abc",
  returnUrl: "http://localhost:3000/en/orders/order_abc",
};

const check = (over: Record<string, unknown>) => validateIntentInput({ ...good, ...over }, ORIGIN);

describe("validateIntentInput", () => {
  it("accepts a valid body and returns exactly the four fields", () => {
    expect(validateIntentInput({ ...good, extra: "ignored" }, ORIGIN)).toEqual({ ok: true, input: good });
  });

  it.each([null, "x", 5, [], undefined])("rejects a body that is %j", (body) => {
    expect(validateIntentInput(body, ORIGIN)).toMatchObject({ ok: false });
  });

  describe("amountCents", () => {
    it.each([0, -1, 1.5, "1000", null, NaN, Infinity, 100_000_000])("rejects %j", (amountCents) => {
      expect(check({ amountCents })).toMatchObject({ ok: false, message: expect.stringMatching(/amountCents/) });
    });

    it("accepts the smallest and the largest amount", () => {
      expect(check({ amountCents: 1 })).toMatchObject({ ok: true });
      expect(check({ amountCents: 99_999_999 })).toMatchObject({ ok: true });
    });

    it("rejects a missing amount", () => {
      expect(validateIntentInput({ ...good, amountCents: undefined }, ORIGIN)).toMatchObject({ ok: false });
    });
  });

  describe("currency", () => {
    it.each(["eur", "EURO", "EU", "E1R", "", 5, null])("rejects %j", (currency) => {
      expect(check({ currency })).toMatchObject({ ok: false, message: expect.stringMatching(/currency/) });
    });
  });

  describe("orderId", () => {
    it.each(["", 5, null, "x".repeat(101)])("rejects %j", (orderId) => {
      expect(check({ orderId })).toMatchObject({ ok: false, message: expect.stringMatching(/orderId/) });
    });
  });

  describe("returnUrl (open-redirect guard)", () => {
    it("accepts any path and query on the allowed origin", () => {
      expect(check({ returnUrl: "http://localhost:3000/a/b?x=1#h" })).toMatchObject({ ok: true });
      expect(check({ returnUrl: "http://localhost:3000" })).toMatchObject({ ok: true });
    });

    it.each([
      ["another host", "http://evil.com/orders/x"],
      ["a prefix-lookalike host", "http://localhost:3000.evil.com/orders/x"],
      ["credentials smuggling", "http://localhost:3000@evil.com/orders/x"],
      ["another port", "http://localhost:3001/orders/x"],
      ["another scheme", "https://localhost:3000/orders/x"],
      ["a protocol-relative URL", "//evil.com/orders/x"],
      ["a relative path", "/orders/x"],
      ["a javascript URL", "javascript:alert(1)"],
      ["a data URL", "data:text/html,hi"],
      ["not a URL", "not a url"],
      ["an empty string", ""],
      ["a number", 5],
      ["null", null],
      ["an over-long URL", `http://localhost:3000/${"a".repeat(2100)}`],
    ])("rejects %s", (_label, returnUrl) => {
      expect(check({ returnUrl })).toMatchObject({ ok: false, message: expect.stringMatching(/returnUrl/) });
    });
  });
});
