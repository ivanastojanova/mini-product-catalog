import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import { verifyWebhookSignature } from "./verifyWebhookSignature.js";

/**
 * Fixed vector, duplicated in apps/gateway's `sign` tests. If either app's
 * scheme drifts, its copy of this test fails. Do not "fix" it by regenerating.
 */
const VECTOR = {
  secret: "whsec_test_secret",
  timestamp: 1767000000,
  body: '{"id":"evt_test_123","type":"payment_intent.succeeded","created":1767000000,"data":{"object":{"id":"pi_test_123","amount":132000,"currency":"EUR","metadata":{"orderId":"order_abc"}}}}',
  signature: "2afcf7174a16af84dbcb9ad1379a5fcce56a3b8a44ee06d6b9a7990d0ca25048",
};

const header = `t=${VECTOR.timestamp},v1=${VECTOR.signature}`;

function verify(overrides: Partial<Parameters<typeof verifyWebhookSignature>[0]> = {}) {
  return verifyWebhookSignature({
    rawBody: VECTOR.body,
    header,
    secret: VECTOR.secret,
    now: VECTOR.timestamp,
    ...overrides,
  });
}

function sign(timestamp: number, body: string, secret = VECTOR.secret) {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

describe("verifyWebhookSignature", () => {
  it("accepts the fixed cross-app test vector", () => {
    expect(verify()).toEqual({ ok: true });
  });

  it("rejects a signature made with a different secret", () => {
    expect(verify({ secret: "whsec_other" })).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects a body changed by a single character", () => {
    const tampered = VECTOR.body.replace("132000", "132001");
    expect(verify({ rawBody: tampered })).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects equivalent JSON that is not the exact signed bytes", () => {
    const reformatted = JSON.stringify(JSON.parse(VECTOR.body), null, 2);
    expect(verify({ rawBody: reformatted })).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects when the timestamp in the header was altered (it is part of the signed text)", () => {
    const forged = `t=${VECTOR.timestamp + 1},v1=${VECTOR.signature}`;
    expect(verify({ header: forged })).toEqual({ ok: false, reason: "bad_signature" });
  });

  describe("header", () => {
    it.each([undefined, "", "   "])("rejects a missing header (%j)", (value) => {
      expect(verify({ header: value })).toEqual({ ok: false, reason: "missing_header" });
    });

    it.each([
      ["garbage", "not-a-signature"],
      ["no timestamp", `v1=${VECTOR.signature}`],
      ["no v1", `t=${VECTOR.timestamp}`],
      ["non-numeric timestamp", `t=abc,v1=${VECTOR.signature}`],
      ["negative timestamp", `t=-5,v1=${VECTOR.signature}`],
      ["fractional timestamp", `t=1.5,v1=${VECTOR.signature}`],
      ["empty timestamp", `t=,v1=${VECTOR.signature}`],
      ["a part without '='", `t=${VECTOR.timestamp},oops,v1=${VECTOR.signature}`],
    ])("rejects a malformed header: %s", (_label, value) => {
      expect(verify({ header: value })).toEqual({ ok: false, reason: "malformed_header" });
    });

    it("ignores unknown keys, like a future v2 scheme", () => {
      expect(verify({ header: `t=${VECTOR.timestamp},v2=abc,v1=${VECTOR.signature}` })).toEqual({
        ok: true,
      });
    });

    it("accepts when any one of several v1 signatures matches (secret rotation)", () => {
      const rotated = `t=${VECTOR.timestamp},v1=${"0".repeat(64)},v1=${VECTOR.signature}`;
      expect(verify({ header: rotated })).toEqual({ ok: true });
    });

    it("rejects when none of several v1 signatures match", () => {
      const none = `t=${VECTOR.timestamp},v1=${"0".repeat(64)},v1=${"1".repeat(64)}`;
      expect(verify({ header: none })).toEqual({ ok: false, reason: "bad_signature" });
    });
  });

  describe("signature length", () => {
    it("rejects a too-short signature instead of throwing", () => {
      expect(verify({ header: `t=${VECTOR.timestamp},v1=abcd` })).toEqual({
        ok: false,
        reason: "bad_signature",
      });
    });

    it("rejects a too-long signature instead of throwing", () => {
      expect(verify({ header: `t=${VECTOR.timestamp},v1=${VECTOR.signature}00` })).toEqual({
        ok: false,
        reason: "bad_signature",
      });
    });

    it("rejects an empty v1 value", () => {
      expect(verify({ header: `t=${VECTOR.timestamp},v1=` })).toEqual({
        ok: false,
        reason: "bad_signature",
      });
    });
  });

  describe("timestamp tolerance (replay protection)", () => {
    const body = '{"id":"evt_1"}';
    const signedAt = 1_000_000;
    const signedHeader = `t=${signedAt},v1=${sign(signedAt, body)}`;

    function at(now: number, toleranceSeconds?: number) {
      return verifyWebhookSignature({
        rawBody: body,
        header: signedHeader,
        secret: VECTOR.secret,
        now,
        toleranceSeconds,
      });
    }

    it("accepts exactly at the 5-minute edge", () => {
      expect(at(signedAt + 300)).toEqual({ ok: true });
      expect(at(signedAt - 300)).toEqual({ ok: true });
    });

    it("rejects one second past the edge, in the past", () => {
      expect(at(signedAt + 301)).toEqual({ ok: false, reason: "stale_timestamp" });
    });

    it("rejects one second past the edge, in the future", () => {
      expect(at(signedAt - 301)).toEqual({ ok: false, reason: "stale_timestamp" });
    });

    it("rejects a perfectly valid but old signature (a captured request replayed later)", () => {
      expect(at(signedAt + 24 * 60 * 60)).toEqual({ ok: false, reason: "stale_timestamp" });
    });

    it("honors a custom tolerance", () => {
      expect(at(signedAt + 10, 5)).toEqual({ ok: false, reason: "stale_timestamp" });
      expect(at(signedAt + 5, 5)).toEqual({ ok: true });
    });
  });
});
