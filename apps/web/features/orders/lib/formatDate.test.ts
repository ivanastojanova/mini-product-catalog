import { describe, expect, it } from "vitest";

import { formatOrderDate } from "./formatDate";

describe("formatOrderDate", () => {
  it("formats an ISO timestamp in the shopper's locale", () => {
    const iso = "2026-11-06T10:00:00.000Z";

    const en = formatOrderDate(iso, "en");
    const de = formatOrderDate(iso, "de");

    expect(en).toContain("2026");
    expect(de).toContain("2026");
    expect(en).not.toBe(de);
  });

  it("returns null for an unparseable timestamp", () => {
    expect(formatOrderDate("not-a-date", "en")).toBeNull();
  });
});
