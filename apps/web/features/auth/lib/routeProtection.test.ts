import { describe, expect, it } from "vitest";

import { getLoginRedirect } from "./routeProtection";

describe("getLoginRedirect", () => {
  it("redirects a logged-out request for /account to the same locale's login", () => {
    expect(getLoginRedirect("/en/account", false)).toBe("/en/login");
    expect(getLoginRedirect("/de/account", false)).toBe("/de/login");
  });

  it("redirects /account sub-paths (order history) when logged out", () => {
    expect(getLoginRedirect("/en/account/orders", false)).toBe("/en/login");
  });

  it("leaves checkout and order pages public: guests can check out and view their order", () => {
    expect(getLoginRedirect("/en/checkout", false)).toBeNull();
    expect(getLoginRedirect("/de/checkout", false)).toBeNull();
    expect(getLoginRedirect("/en/orders/abc123", false)).toBeNull();
  });

  it("lets protected paths through when a session cookie is present", () => {
    expect(getLoginRedirect("/en/account", true)).toBeNull();
    expect(getLoginRedirect("/en/checkout", true)).toBeNull();
  });

  it("never redirects public pages, including /login itself (no redirect loop)", () => {
    expect(getLoginRedirect("/en", false)).toBeNull();
    expect(getLoginRedirect("/en/login", false)).toBeNull();
    expect(getLoginRedirect("/en/products/chair", false)).toBeNull();
  });

  it("does not match look-alike segments", () => {
    expect(getLoginRedirect("/en/accounting", false)).toBeNull();
    expect(getLoginRedirect("/en/products/account", false)).toBeNull();
  });

  it("ignores paths without a valid locale prefix", () => {
    expect(getLoginRedirect("/account", false)).toBeNull();
    expect(getLoginRedirect("/fr/account", false)).toBeNull();
    expect(getLoginRedirect("/", false)).toBeNull();
  });
});
