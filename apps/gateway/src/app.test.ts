import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "./app.js";
import { MIGRATIONS_FOLDER } from "./db/client.js";
import { migrate } from "./db/migrate.js";
import type { GatewayConfig } from "./config.js";
import { insertIntent } from "./testing.js";

const config: GatewayConfig = {
  webhookUrl: "http://localhost:4000/webhooks/payments",
  webhookSecret: "whsec_123",
  port: 4100,
  databasePath: ":memory:",
  apiKey: "key_123",
  allowedReturnOrigin: "http://localhost:3000",
  publicUrl: "http://localhost:4100",
};

const body = {
  amountCents: 132000,
  currency: "EUR",
  orderId: "order_abc",
  returnUrl: "http://localhost:3000/en/orders/order_abc",
};

let sqlite: Database.Database;
let app: ReturnType<typeof buildApp>;

beforeEach(() => {
  sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  migrate(sqlite, MIGRATIONS_FOLDER);
  app = buildApp({ sqlite, config });
});

const AUTH = { authorization: "Bearer key_123" };

const post = (payload: unknown, headers: Record<string, string> = {}) =>
  app.inject({ method: "POST", url: "/v1/payment_intents", payload: payload as object, headers: { ...AUTH, "idempotency-key": "k1", ...headers } });

const count = () => (sqlite.prepare("SELECT COUNT(*) AS n FROM payment_intents").get() as { n: number }).n;

describe("GET /health", () => {
  it("needs no key", async () => {
    expect((await app.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
  });
});

describe("API key on /v1/*", () => {
  it.each([
    ["no header", {}],
    ["a wrong key", { authorization: "Bearer nope" }],
    ["a malformed header", { authorization: "key_123" }],
  ])("answers 401 to POST with %s and creates nothing", async (_label, headers) => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/payment_intents",
      payload: body,
      headers: { "idempotency-key": "k1", ...headers },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ message: "Unauthorized" });
    expect(count()).toBe(0);
  });

  it("answers 401 to GET without the key, whether or not the intent exists", async () => {
    const created = (await post(body)).json();
    const real = await app.inject({ method: "GET", url: `/v1/payment_intents/${created.id}` });
    const fake = await app.inject({ method: "GET", url: "/v1/payment_intents/pi_nope" });
    expect(real.statusCode).toBe(401);
    expect(fake.statusCode).toBe(401);
  });

  it("checks the key before the body, so an unauthenticated caller learns nothing about validation", async () => {
    const response = await app.inject({ method: "POST", url: "/v1/payment_intents", payload: { junk: true } });
    expect(response.statusCode).toBe(401);
  });
});

describe("POST /v1/payment_intents", () => {
  it("creates an intent: 201 with id, status and payUrl", async () => {
    const response = await post(body);
    expect(response.statusCode).toBe(201);
    const json = response.json();
    expect(json).toEqual({
      id: expect.stringMatching(/^pi_[0-9a-f]{32}$/),
      status: "requires_payment",
      payUrl: `http://localhost:4100/pay/${json.id}`,
    });
  });

  it("requires an Idempotency-Key", async () => {
    const response = await app.inject({ method: "POST", url: "/v1/payment_intents", payload: body, headers: AUTH });
    expect(response.statusCode).toBe(400);
    expect(response.json().message).toMatch(/Idempotency-Key/);
    expect(count()).toBe(0);
  });

  it("rejects an over-long Idempotency-Key", async () => {
    expect((await post(body, { "idempotency-key": "k".repeat(256) })).statusCode).toBe(400);
  });

  it("replays the same key and body: 200 with the same intent", async () => {
    const first = await post(body);
    const second = await post(body);
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual(first.json());
    expect(count()).toBe(1);
  });

  it("answers 409 for the same key with a different body", async () => {
    await post(body);
    const response = await post({ ...body, amountCents: 1 });
    expect(response.statusCode).toBe(409);
    expect(count()).toBe(1);
  });

  it("rejects an invalid amount with 400 and stores nothing", async () => {
    for (const amountCents of [0, -5, 1.5, "100"]) {
      expect((await post({ ...body, amountCents })).statusCode).toBe(400);
    }
    expect(count()).toBe(0);
  });

  it("rejects a return URL on another origin with 400 (open-redirect guard)", async () => {
    for (const returnUrl of ["http://evil.com/x", "http://localhost:3000@evil.com/x", "http://localhost:3000.evil.com/x"]) {
      const response = await post({ ...body, returnUrl });
      expect(response.statusCode).toBe(400);
      expect(response.json().message).toMatch(/returnUrl/);
    }
    expect(count()).toBe(0);
  });

  it("does not burn the idempotency key on a rejected request", async () => {
    await post({ ...body, amountCents: 0 });
    expect((await post(body)).statusCode).toBe(201);
  });
});

describe("GET /v1/payment_intents/:id", () => {
  it("returns the intent", async () => {
    const created = (await post(body)).json();
    const response = await app.inject({ method: "GET", url: `/v1/payment_intents/${created.id}`, headers: AUTH });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: created.id,
      status: "requires_payment",
      amountCents: 132000,
      currency: "EUR",
      orderId: "order_abc",
      returnUrl: body.returnUrl,
      payUrl: created.payUrl,
    });
  });

  it("answers 404 for an unknown id", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/payment_intents/pi_nope", headers: AUTH });
    expect(response.statusCode).toBe(404);
  });
});

describe("POST /v1/refunds", () => {
  const refund = (payload: unknown, headers: Record<string, string> = {}) =>
    app.inject({
      method: "POST",
      url: "/v1/refunds",
      payload: payload as object,
      headers: { ...AUTH, "idempotency-key": "r1", ...headers },
    });

  const succeededIntent = () => {
    const id = insertIntent(sqlite, { status: "succeeded", amount: 4200 });
    return id;
  };

  it("requires the API key", async () => {
    const id = succeededIntent();
    const response = await app.inject({
      method: "POST",
      url: "/v1/refunds",
      payload: { paymentIntentId: id },
      headers: { "idempotency-key": "r1" },
    });
    expect(response.statusCode).toBe(401);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM refunds").get()).toEqual({ n: 0 });
  });

  it("201 with the refund, then 200 with the same refund on a repeat", async () => {
    const id = succeededIntent();
    const first = await refund({ paymentIntentId: id });
    const second = await refund({ paymentIntentId: id });

    expect(first.statusCode).toBe(201);
    expect(first.json()).toEqual({ id: expect.stringMatching(/^re_/), paymentIntentId: id, amountCents: 4200 });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual(first.json());
  });

  it("requires an Idempotency-Key and a paymentIntentId", async () => {
    const id = succeededIntent();
    const noKey = await app.inject({ method: "POST", url: "/v1/refunds", payload: { paymentIntentId: id }, headers: AUTH });
    expect(noKey.statusCode).toBe(400);
    expect((await refund({})).statusCode).toBe(400);
    expect((await refund({ paymentIntentId: 5 })).statusCode).toBe(400);
    expect((await refund(['pi_1'])).statusCode).toBe(400);
  });

  it("404 for an unknown intent; 409 for one that never succeeded", async () => {
    expect((await refund({ paymentIntentId: "pi_nope" })).statusCode).toBe(404);
    const open = insertIntent(sqlite);
    expect((await refund({ paymentIntentId: open }, { "idempotency-key": "r2" })).statusCode).toBe(409);
  });
});
