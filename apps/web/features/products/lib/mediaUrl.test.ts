import { describe, expect, it } from "vitest";

import { resolveMediaUrl } from "./mediaUrl";

describe("resolveMediaUrl", () => {
  it("prefixes a CMS-relative path with the CMS origin", () => {
    expect(
      resolveMediaUrl("/api/media/file/sofa.png", "http://localhost:3001"),
    ).toBe("http://localhost:3001/api/media/file/sofa.png");
  });

  it("does not double the slash when the base ends with one", () => {
    expect(
      resolveMediaUrl("/api/media/file/sofa.png", "http://localhost:3001/"),
    ).toBe("http://localhost:3001/api/media/file/sofa.png");
  });

  it("leaves an absolute URL unchanged", () => {
    expect(
      resolveMediaUrl("https://cdn.example.com/a.png", "http://localhost:3001"),
    ).toBe("https://cdn.example.com/a.png");
  });

  it("returns null for a missing url", () => {
    expect(resolveMediaUrl(undefined, "http://localhost:3001")).toBeNull();
    expect(resolveMediaUrl(null, "http://localhost:3001")).toBeNull();
    expect(resolveMediaUrl("", "http://localhost:3001")).toBeNull();
  });

  it("uses the new base each call, so a changed CMS_API_URL takes effect", () => {
    const path = "/api/media/file/sofa.png";
    expect(resolveMediaUrl(path, "http://localhost:3002")).not.toBe(
      resolveMediaUrl(path, "http://localhost:3001"),
    );
  });
});
