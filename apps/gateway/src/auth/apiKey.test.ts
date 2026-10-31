import { describe, expect, it } from "vitest";

import { isAuthorized } from "./apiKey.js";

describe("isAuthorized", () => {
  it("accepts the exact bearer key", () => {
    expect(isAuthorized("Bearer secret_key", "secret_key")).toBe(true);
  });

  it.each([
    ["no header", undefined],
    ["an empty header", ""],
    ["the key without Bearer", "secret_key"],
    ["a different scheme", "Basic secret_key"],
    ["a lowercase scheme", "bearer secret_key"],
    ["a wrong key", "Bearer wrong_key"],
    ["a key that is a prefix of the real one", "Bearer secret"],
    ["a key that extends the real one", "Bearer secret_key_extra"],
    ["an empty key", "Bearer "],
    ["extra whitespace", "Bearer  secret_key"],
  ])("rejects %s", (_label, header) => {
    expect(isAuthorized(header, "secret_key")).toBe(false);
  });

  it("never authorizes when the configured key is empty, even for an empty bearer", () => {
    expect(isAuthorized("Bearer ", "")).toBe(false);
    expect(isAuthorized("Bearer x", "")).toBe(false);
  });
});
