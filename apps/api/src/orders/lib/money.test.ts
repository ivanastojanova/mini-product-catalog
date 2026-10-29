import { describe, expect, it } from "vitest";
import { toMinorUnits } from "./money.js";

describe("toMinorUnits", () => {
  it("converts whole and fractional prices to cents", () => {
    expect(toMinorUnits(10)).toBe(1000);
    expect(toMinorUnits(19.5)).toBe(1950);
    expect(toMinorUnits(0)).toBe(0);
  });

  it("returns exact integers for prices whose float product is slightly off", () => {
    // 19.99 * 100 === 1998.9999999999998 in IEEE 754
    expect(19.99 * 100).not.toBe(1999);
    expect(toMinorUnits(19.99)).toBe(1999);
    // 0.1 + 0.2 === 0.30000000000000004
    expect(toMinorUnits(0.1 + 0.2)).toBe(30);
    expect(toMinorUnits(4.35)).toBe(435);
    expect(toMinorUnits(1.1)).toBe(110);
  });

  it("always returns an integer", () => {
    for (const price of [0.01, 0.07, 3.33, 12.34, 99.99, 1234.56]) {
      expect(Number.isInteger(toMinorUnits(price))).toBe(true);
    }
  });

  it("rounds sub-cent prices to the nearest cent", () => {
    expect(toMinorUnits(2.344)).toBe(234);
    expect(toMinorUnits(2.346)).toBe(235);
  });

  it("rejects values that can't be a price", () => {
    expect(() => toMinorUnits(-1)).toThrow(RangeError);
    expect(() => toMinorUnits(Number.NaN)).toThrow(RangeError);
    expect(() => toMinorUnits(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => toMinorUnits("19.99" as unknown as number)).toThrow(RangeError);
    expect(() => toMinorUnits(null as unknown as number)).toThrow(RangeError);
  });
});
