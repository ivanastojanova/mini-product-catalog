import { describe, expect, it } from "vitest";

import { formatCountdown, secondsUntil } from "./countdown";

describe("secondsUntil", () => {
  const now = Date.parse("2030-01-01T12:00:00Z");

  it("counts whole seconds, rounding a partial second up", () => {
    expect(secondsUntil("2030-01-01T12:15:00Z", now)).toBe(900);
    expect(secondsUntil("2030-01-01T12:00:00.100Z", now)).toBe(1);
  });

  it("is zero at and after the deadline, never negative", () => {
    expect(secondsUntil("2030-01-01T12:00:00Z", now)).toBe(0);
    expect(secondsUntil("2030-01-01T11:00:00Z", now)).toBe(0);
  });

  it("is zero for an unparseable date", () => {
    expect(secondsUntil("not a date", now)).toBe(0);
  });
});

describe("formatCountdown", () => {
  it("formats minutes and zero-padded seconds", () => {
    expect(formatCountdown(905)).toBe("15:05");
    expect(formatCountdown(59)).toBe("0:59");
    expect(formatCountdown(60)).toBe("1:00");
    expect(formatCountdown(0)).toBe("0:00");
  });

  it("clamps negatives and drops fractions", () => {
    expect(formatCountdown(-5)).toBe("0:00");
    expect(formatCountdown(61.9)).toBe("1:01");
  });
});
