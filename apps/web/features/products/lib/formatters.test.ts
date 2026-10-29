import { describe, expect, it } from "vitest";

import { formatMoney, formatPrice } from "./formatters";

const normalize = (value: string) => value.replace(/\u00a0/g, " ");

describe("formatMoney", () => {
  it("formats integer cents as currency", () => {
    expect(normalize(formatMoney(26500, "EUR", "en"))).toBe("€265.00");
    expect(normalize(formatMoney(79050, "EUR", "en"))).toBe("€790.50");
  });

  it("uses the locale's separators and symbol placement", () => {
    expect(normalize(formatMoney(79050, "EUR", "de"))).toBe("790,50 €");
    expect(normalize(formatMoney(123456789, "EUR", "de"))).toBe("1.234.567,89 €");
  });

  it("handles zero and sub-euro amounts", () => {
    expect(normalize(formatMoney(0, "EUR", "en"))).toBe("€0.00");
    expect(normalize(formatMoney(5, "EUR", "en"))).toBe("€0.05");
  });

  it("is formatPrice of the same amount in major units (cents are not shown 100x too large)", () => {
    expect(formatMoney(1999, "USD", "en")).toBe(formatPrice(19.99, "USD", "en"));
  });

  it("defaults to EUR and English", () => {
    expect(normalize(formatMoney(100))).toBe("€1.00");
  });
});
