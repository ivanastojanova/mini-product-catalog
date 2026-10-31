import { describe, expect, it } from "vitest";

import { signWebhook } from "./sign.js";

/**
 * Fixed vector, duplicated in apps/api's verifyWebhookSignature tests. If
 * either app's scheme drifts, its copy of this test fails. Do not "fix" it by
 * regenerating.
 */
const VECTOR = {
  secret: "whsec_test_secret",
  timestamp: 1767000000,
  body: '{"id":"evt_test_123","type":"payment_intent.succeeded","created":1767000000,"data":{"object":{"id":"pi_test_123","amount":132000,"currency":"EUR","metadata":{"orderId":"order_abc"}}}}',
  signature: "2afcf7174a16af84dbcb9ad1379a5fcce56a3b8a44ee06d6b9a7990d0ca25048",
};

describe("signWebhook", () => {
  it("produces the fixed cross-app test vector", () => {
    expect(
      signWebhook({ rawBody: VECTOR.body, secret: VECTOR.secret, timestamp: VECTOR.timestamp }),
    ).toBe(`t=${VECTOR.timestamp},v1=${VECTOR.signature}`);
  });

  it("changes when the body changes by one character", () => {
    const a = signWebhook({ rawBody: VECTOR.body, secret: VECTOR.secret, timestamp: VECTOR.timestamp });
    const b = signWebhook({ rawBody: VECTOR.body.replace("132000", "132001"), secret: VECTOR.secret, timestamp: VECTOR.timestamp });
    expect(a).not.toBe(b);
  });

  it("changes with the secret", () => {
    const a = signWebhook({ rawBody: VECTOR.body, secret: "one", timestamp: VECTOR.timestamp });
    const b = signWebhook({ rawBody: VECTOR.body, secret: "two", timestamp: VECTOR.timestamp });
    expect(a).not.toBe(b);
  });

  it("covers the timestamp, so it can't be moved to a fresher time", () => {
    const a = signWebhook({ rawBody: VECTOR.body, secret: VECTOR.secret, timestamp: 1000 });
    const b = signWebhook({ rawBody: VECTOR.body, secret: VECTOR.secret, timestamp: 1001 });
    expect(a.split("v1=")[1]).not.toBe(b.split("v1=")[1]);
  });

  it("is deterministic for the same input", () => {
    const input = { rawBody: "{}", secret: "s", timestamp: 5 };
    expect(signWebhook(input)).toBe(signWebhook(input));
  });
});
