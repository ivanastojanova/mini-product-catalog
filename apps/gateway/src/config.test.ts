import { describe, expect, it } from "vitest";

import { ConfigError, loadConfig } from "./config.js";

const valid = { GATEWAY_API_KEY: "key_123", GATEWAY_WEBHOOK_SECRET: "whsec_123" };

describe("loadConfig", () => {
  it("applies local defaults", () => {
    expect(loadConfig(valid)).toEqual({
      port: 4100,
      databasePath: "./gateway.db",
      apiKey: "key_123",
      allowedReturnOrigin: "http://localhost:3000",
      publicUrl: "http://localhost:4100",
      webhookUrl: "http://localhost:4000/webhooks/payments",
      webhookSecret: "whsec_123",
    });
  });

  it("reads every setting from the environment", () => {
    const config = loadConfig({
      ...valid,
      PORT: "5000",
      DATABASE_URL: "file:/tmp/g.db",
      ALLOWED_RETURN_ORIGIN: "https://shop.example.com/some/path",
      GATEWAY_PUBLIC_URL: "https://pay.example.com/",
      WEBHOOK_URL: "https://api.example.com/hooks",
    });
    expect(config).toMatchObject({
      port: 5000,
      databasePath: "/tmp/g.db",
      allowedReturnOrigin: "https://shop.example.com",
      publicUrl: "https://pay.example.com",
      webhookUrl: "https://api.example.com/hooks",
    });
  });

  it("builds the default public URL from the configured port", () => {
    expect(loadConfig({ ...valid, PORT: "5000" }).publicUrl).toBe("http://localhost:5000");
  });

  it("refuses to start without an API key (or with an empty one)", () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    expect(() => loadConfig({ GATEWAY_API_KEY: "" })).toThrow(/GATEWAY_API_KEY/);
  });

  it("refuses to start without a webhook secret (or with an empty one)", () => {
    expect(() => loadConfig({ GATEWAY_API_KEY: "k" })).toThrow(/GATEWAY_WEBHOOK_SECRET/);
    expect(() => loadConfig({ ...valid, GATEWAY_WEBHOOK_SECRET: "" })).toThrow(/GATEWAY_WEBHOOK_SECRET/);
  });

  it("rejects a WEBHOOK_URL that is not http(s)", () => {
    expect(() => loadConfig({ ...valid, WEBHOOK_URL: "nope" })).toThrow(/WEBHOOK_URL/);
    expect(() => loadConfig({ ...valid, WEBHOOK_URL: "file:///etc/passwd" })).toThrow(/WEBHOOK_URL/);
  });

  describe("in production", () => {
    it("refuses the example placeholder values", () => {
      expect(() =>
        loadConfig({ NODE_ENV: "production", GATEWAY_API_KEY: "replace-me-key", GATEWAY_WEBHOOK_SECRET: "whsec_ok" }),
      ).toThrow(/GATEWAY_API_KEY is still the example placeholder/);
      expect(() =>
        loadConfig({ NODE_ENV: "production", GATEWAY_API_KEY: "real_key", GATEWAY_WEBHOOK_SECRET: "replace-me-secret" }),
      ).toThrow(/GATEWAY_WEBHOOK_SECRET is still the example placeholder/);
    });

    it("accepts real values", () => {
      expect(loadConfig({ NODE_ENV: "production", GATEWAY_API_KEY: "real_key", GATEWAY_WEBHOOK_SECRET: "real_secret" })).toMatchObject({
        apiKey: "real_key",
      });
    });

    it("allows placeholders outside production (local dev)", () => {
      expect(() => loadConfig({ GATEWAY_API_KEY: "replace-me-key", GATEWAY_WEBHOOK_SECRET: "replace-me-secret" })).not.toThrow();
    });
  });

  it.each(["abc", "0", "70000", "1.5"])("rejects PORT=%s", (port) => {
    expect(() => loadConfig({ ...valid, PORT: port })).toThrow(/PORT/);
  });

  it.each(["not a url", "ftp://shop.example.com", "javascript:alert(1)"])(
    "rejects ALLOWED_RETURN_ORIGIN=%s",
    (value) => {
      expect(() => loadConfig({ ...valid, ALLOWED_RETURN_ORIGIN: value })).toThrow(/ALLOWED_RETURN_ORIGIN/);
    },
  );

  it("reports every problem at once", () => {
    try {
      loadConfig({ PORT: "x", ALLOWED_RETURN_ORIGIN: "nope" });
      expect.unreachable();
    } catch (error) {
      expect((error as ConfigError).problems).toHaveLength(4);
    }
  });
});
