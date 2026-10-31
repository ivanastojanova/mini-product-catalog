import { describe, expect, it } from "vitest";

import { assertPaymentSecrets } from "./assertPaymentSecrets.js";

const real = { GATEWAY_WEBHOOK_SECRET: "whsec_real", GATEWAY_API_KEY: "key_real" };

describe("assertPaymentSecrets", () => {
  it("does nothing outside production, even with nothing set", () => {
    expect(() => assertPaymentSecrets({})).not.toThrow();
    expect(() => assertPaymentSecrets({ NODE_ENV: "development", GATEWAY_WEBHOOK_SECRET: "replace-me" })).not.toThrow();
  });

  it("accepts real secrets in production", () => {
    expect(() => assertPaymentSecrets({ NODE_ENV: "production", ...real })).not.toThrow();
  });

  it.each(["GATEWAY_WEBHOOK_SECRET", "GATEWAY_API_KEY"] as const)("refuses a missing %s in production", (name) => {
    const env = { NODE_ENV: "production", ...real, [name]: undefined };
    expect(() => assertPaymentSecrets(env)).toThrow(new RegExp(`${name} is required`));
    expect(() => assertPaymentSecrets({ ...env, [name]: "" })).toThrow(new RegExp(`${name} is required`));
  });

  it.each(["GATEWAY_WEBHOOK_SECRET", "GATEWAY_API_KEY"] as const)("refuses the placeholder %s in production", (name) => {
    expect(() => assertPaymentSecrets({ NODE_ENV: "production", ...real, [name]: "replace-me-with-a-long-random-string" })).toThrow(
      new RegExp(`${name} is still the example placeholder`),
    );
  });

  it("reports both problems at once", () => {
    expect(() => assertPaymentSecrets({ NODE_ENV: "production" })).toThrow(/WEBHOOK_SECRET[\s\S]*API_KEY/);
  });
});
