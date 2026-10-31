import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import cookie from "@fastify/cookie";

import { parseGatewayEvent } from "../lib/gatewayEvent.js";
import { registerPaymentWebhookRoute, type ProcessEvent } from "./webhook.js";

const SECRET = "whsec_test_secret";
const NOW = 1_767_000_000;

const body = JSON.stringify({
  id: "evt_test_123",
  type: "payment_intent.succeeded",
  created: NOW,
  data: { object: { id: "pi_test_123", amount: 132000, currency: "EUR" } },
});

function signedHeader(rawBody: string, timestamp = NOW, secret = SECRET) {
  const hmac = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  return `t=${timestamp},v1=${hmac}`;
}

const acknowledge = (): ProcessEvent => vi.fn(async () => ({ duplicate: false }));

async function buildApp(
  getSecret: () => string | undefined = () => SECRET,
  processEvent: ProcessEvent = acknowledge(),
) {
  const app = Fastify();
  await app.register(cookie);
  registerPaymentWebhookRoute(app, { getSecret, now: () => NOW, processEvent });
  // A second route, to prove the string parser doesn't leak out of the webhook's scope.
  app.post("/echo", async (request) => ({ type: typeof request.body, body: request.body }));
  await app.ready();
  return app;
}

function post(app: Awaited<ReturnType<typeof buildApp>>, payload: string, headers: Record<string, string> = {}) {
  return app.inject({
    method: "POST",
    url: "/webhooks/payments",
    headers: { "content-type": "application/json", ...headers },
    payload,
  });
}

describe("POST /webhooks/payments", () => {
  it("acknowledges a correctly signed event", async () => {
    const app = await buildApp();
    const response = await post(app, body, { "gateway-signature": signedHeader(body) });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ received: true });
  });

  it("needs no cookie or session", async () => {
    const app = await buildApp();
    const response = await post(app, body, { "gateway-signature": signedHeader(body) });
    expect(response.statusCode).toBe(200);
    expect(response.headers["set-cookie"]).toBeUndefined();
  });

  it("rejects a missing signature header", async () => {
    const app = await buildApp();
    const response = await post(app, body);
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ message: "Invalid signature" });
  });

  it("rejects a signature made with the wrong secret", async () => {
    const app = await buildApp();
    const response = await post(app, body, { "gateway-signature": signedHeader(body, NOW, "whsec_other") });
    expect(response.statusCode).toBe(400);
  });

  it("rejects a body changed after signing", async () => {
    const app = await buildApp();
    const tampered = body.replace("132000", "1");
    const response = await post(app, tampered, { "gateway-signature": signedHeader(body) });
    expect(response.statusCode).toBe(400);
  });

  it("verifies the exact bytes received, not a re-serialization of the parsed JSON", async () => {
    const app = await buildApp();
    const reformatted = JSON.stringify(JSON.parse(body), null, 2);
    const response = await post(app, reformatted, { "gateway-signature": signedHeader(body) });
    expect(response.statusCode).toBe(400);

    // The same pretty-printed bytes pass when they are what was signed.
    const accepted = await post(app, reformatted, { "gateway-signature": signedHeader(reformatted) });
    expect(accepted.statusCode).toBe(200);
  });

  it("rejects an old but otherwise valid signature (replay)", async () => {
    const app = await buildApp();
    const response = await post(app, body, { "gateway-signature": signedHeader(body, NOW - 3600) });
    expect(response.statusCode).toBe(400);
  });

  it("gives the same answer for every kind of signature failure", async () => {
    const app = await buildApp();
    const headers = [
      undefined,
      "garbage",
      signedHeader(body, NOW, "whsec_other"),
      signedHeader(body, NOW - 3600),
    ];
    const responses = await Promise.all(
      headers.map((header) => post(app, body, header ? { "gateway-signature": header } : {})),
    );
    for (const response of responses) {
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ message: "Invalid signature" });
    }
  });

  it("rejects a request with no body at all", async () => {
    const app = await buildApp();
    const response = await app.inject({ method: "POST", url: "/webhooks/payments" });
    expect(response.statusCode).toBe(400);
  });

  it("rejects a validly signed body that is not JSON", async () => {
    const app = await buildApp();
    const junk = "not json at all";
    const response = await post(app, junk, { "gateway-signature": signedHeader(junk) });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ message: "Invalid event" });
  });

  it.each([
    ["an array", "[]"],
    ["null", "null"],
    ["no id", JSON.stringify({ type: "payment_intent.succeeded" })],
    ["no type", JSON.stringify({ id: "evt_1" })],
    ["a numeric id", JSON.stringify({ id: 7, type: "x" })],
    ["an empty id", JSON.stringify({ id: "", type: "x" })],
  ])("rejects a validly signed body that is %s", async (_label, payload) => {
    const app = await buildApp();
    const response = await post(app, payload, { "gateway-signature": signedHeader(payload) });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ message: "Invalid event" });
  });

  it("refuses everything when no secret is configured (fails closed)", async () => {
    const app = await buildApp(() => undefined);
    const response = await post(app, body, { "gateway-signature": signedHeader(body) });
    expect(response.statusCode).toBe(500);
  });

  it("refuses everything when the secret is an empty string", async () => {
    const app = await buildApp(() => "");
    const response = await post(app, body, { "gateway-signature": signedHeader(body, NOW, "") });
    expect(response.statusCode).toBe(500);
  });

  it("rejects a body over the size limit before verifying it", async () => {
    const app = await buildApp();
    const huge = JSON.stringify({ id: "evt_1", type: "x", pad: "a".repeat(70 * 1024) });
    const response = await post(app, huge, { "gateway-signature": signedHeader(huge) });
    expect(response.statusCode).toBe(413);
  });

  it("does not change how other routes parse JSON", async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/echo",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ hello: "world" }),
    });
    expect(response.json()).toEqual({ type: "object", body: { hello: "world" } });
  });
});

describe("POST /webhooks/payments hands verified events to the processor", () => {
  it("passes the parsed event and the exact raw body", async () => {
    const processEvent = vi.fn(async () => ({ duplicate: false }));
    const app = await buildApp(() => SECRET, processEvent);
    await post(app, body, { "gateway-signature": signedHeader(body) });
    expect(processEvent).toHaveBeenCalledTimes(1);
    const [event, rawBody] = processEvent.mock.calls[0] as unknown as [{ id: string }, string];
    expect(event.id).toBe("evt_test_123");
    expect(rawBody).toBe(body);
  });

  it("never calls the processor for a request that fails verification", async () => {
    const processEvent = vi.fn(async () => ({ duplicate: false }));
    const app = await buildApp(() => SECRET, processEvent);
    await post(app, body);
    await post(app, body, { "gateway-signature": signedHeader(body, NOW, "whsec_other") });
    await post(app, body, { "gateway-signature": signedHeader(body, NOW - 3600) });
    const junk = "not json";
    await post(app, junk, { "gateway-signature": signedHeader(junk) });
    expect(processEvent).not.toHaveBeenCalled();
  });

  it("never calls the processor when no secret is configured", async () => {
    const processEvent = vi.fn(async () => ({ duplicate: false }));
    const app = await buildApp(() => undefined, processEvent);
    await post(app, body, { "gateway-signature": signedHeader(body) });
    expect(processEvent).not.toHaveBeenCalled();
  });

  it("says so when the event was a duplicate (still 200, so the gateway stops retrying)", async () => {
    const app = await buildApp(() => SECRET, vi.fn(async () => ({ duplicate: true })));
    const response = await post(app, body, { "gateway-signature": signedHeader(body) });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ received: true, duplicate: true });
  });

  it("answers 500 when processing throws, so a retrying gateway tries again", async () => {
    const app = await buildApp(
      () => SECRET,
      vi.fn(async () => {
        throw new Error("db exploded");
      }),
    );
    const response = await post(app, body, { "gateway-signature": signedHeader(body) });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ message: "Could not process event" });
  });
});

describe("parseGatewayEvent", () => {
  it("returns the event when it has a string id and type", () => {
    expect(parseGatewayEvent(body)?.id).toBe("evt_test_123");
  });

  it("returns null for anything that is not an event", () => {
    expect(parseGatewayEvent("")).toBeNull();
    expect(parseGatewayEvent("{")).toBeNull();
    expect(parseGatewayEvent('"just a string"')).toBeNull();
  });
});
