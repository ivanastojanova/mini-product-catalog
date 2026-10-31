import { createHmac } from "node:crypto";
import type Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildApp } from "../../app.js";
import type { GatewayConfig } from "../../config.js";
import { insertIntent, memoryDb } from "../../testing.js";

const SECRET = "whsec_123";
const config: GatewayConfig = {
  port: 4100,
  databasePath: ":memory:",
  apiKey: "key_123",
  allowedReturnOrigin: "http://localhost:3000",
  publicUrl: "http://localhost:4100",
  webhookUrl: "http://api.test/webhooks/payments",
  webhookSecret: SECRET,
};

let sqlite: Database.Database;
let fetchImpl: ReturnType<typeof vi.fn>;
let app: ReturnType<typeof buildApp>;

function setup(respond: () => Promise<Response> = async () => new Response("{}", { status: 200 })) {
  sqlite = memoryDb();
  fetchImpl = vi.fn(respond);
  app = buildApp({ sqlite, config, fetchImpl: fetchImpl as unknown as typeof fetch });
}
beforeEach(() => setup());

const submit = (id: string, outcome: string) =>
  app.inject({
    method: "POST",
    url: `/pay/${id}`,
    payload: `outcome=${outcome}`,
    headers: { "content-type": "application/x-www-form-urlencoded" },
  });
const sent = () =>
  (fetchImpl.mock.calls as unknown as Array<[string, RequestInit]>).map(([url, init]) => ({
    url,
    body: init.body as string,
    signature: (init.headers as Record<string, string>)["gateway-signature"],
  }));
const status = (id: string) =>
  (sqlite.prepare("SELECT status FROM payment_intents WHERE id = ?").get(id) as { status: string }).status;
const attempts = () =>
  (sqlite.prepare("SELECT COALESCE(SUM(delivery_attempts), 0) AS n FROM events").get() as { n: number }).n;

describe("GET /pay/:intentId", () => {
  it("shows the amount, the order and the three buttons, with no API key", async () => {
    const id = insertIntent(sqlite);
    const response = await app.inject({ method: "GET", url: `/pay/${id}` });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toMatch(/text\/html/);
    expect(response.body).toContain("€1,320.00");
    expect(response.body).toContain("order_abc");
    expect(response.body).toContain(`action="/pay/${id}"`);
    for (const value of ["succeed", "succeed_twice", "decline"]) {
      expect(response.body).toContain(`value="${value}"`);
    }
  });

  it("is locked down: no framing, no scripts, not cached", async () => {
    const id = insertIntent(sqlite);
    const { headers } = await app.inject({ method: "GET", url: `/pay/${id}` });

    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["content-security-policy"]).toContain("default-src 'none'");
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(headers["cache-control"]).toBe("no-store");
  });

  it.each(["succeeded", "failed", "refunded"])("an intent that is %s shows its state instead of buttons", async (current) => {
    const id = insertIntent(sqlite, { status: current });
    const response = await app.inject({ method: "GET", url: `/pay/${id}` });

    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain("<button");
    expect(response.body).toContain("Back to the shop");
  });

  it("escapes anything that came from the order", async () => {
    const id = insertIntent(sqlite);
    sqlite.prepare("UPDATE payment_intents SET metadata_order_id = ? WHERE id = ?").run('<script>alert(1)</script>"', id);
    const response = await app.inject({ method: "GET", url: `/pay/${id}` });

    expect(response.body).not.toContain("<script>");
    expect(response.body).toContain("&lt;script&gt;");
  });

  it("404 for an unknown intent", async () => {
    expect((await app.inject({ method: "GET", url: "/pay/pi_nope" })).statusCode).toBe(404);
  });
});

describe("POST /pay/:intentId", () => {
  it("succeed: settles, delivers ONE signed event, then redirects 303 to the return URL", async () => {
    const id = insertIntent(sqlite);
    const response = await submit(id, "succeed");

    expect(response.statusCode).toBe(303);
    expect(response.headers.location).toBe("http://localhost:3000/en/orders/order_abc");
    expect(status(id)).toBe("succeeded");

    const calls = sent();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(config.webhookUrl);
    const event = JSON.parse(calls[0].body);
    expect(event).toMatchObject({ type: "payment_intent.succeeded", data: { object: { id, amount: 132000, currency: "EUR" } } });

    const [, t, v1] = /^t=(\d+),v1=([0-9a-f]+)$/.exec(calls[0].signature) as RegExpExecArray;
    expect(v1).toBe(createHmac("sha256", SECRET).update(`${t}.${calls[0].body}`).digest("hex"));
  });

  it("succeed_twice: the SAME event (same id, same body) is delivered twice", async () => {
    const id = insertIntent(sqlite);
    await submit(id, "succeed_twice");

    const calls = sent();
    expect(calls).toHaveLength(2);
    expect(calls[0].body).toBe(calls[1].body);
    expect(JSON.parse(calls[0].body).id).toBe(JSON.parse(calls[1].body).id);
    expect(attempts()).toBe(2);
    expect((sqlite.prepare("SELECT COUNT(*) AS n FROM events").get() as { n: number }).n).toBe(1);
  });

  it("decline: marks the intent failed, delivers a payment_failed event, and still redirects", async () => {
    const id = insertIntent(sqlite);
    const response = await submit(id, "decline");

    expect(response.statusCode).toBe(303);
    expect(status(id)).toBe("failed");
    expect(JSON.parse(sent()[0].body).type).toBe("payment_intent.payment_failed");
  });

  it("submitting again after a payment sends nothing more but still redirects", async () => {
    const id = insertIntent(sqlite);
    await submit(id, "succeed");
    const again = await submit(id, "succeed_twice");
    const decline = await submit(id, "decline");

    expect(again.statusCode).toBe(303);
    expect(decline.statusCode).toBe(303);
    expect(sent()).toHaveLength(1);
    expect(status(id)).toBe("succeeded");
  });

  it("a receiver that is down does not block the redirect; the failure is recorded", async () => {
    setup(async () => {
      throw new TypeError("fetch failed");
    });
    const id = insertIntent(sqlite);
    const response = await submit(id, "succeed");

    expect(response.statusCode).toBe(303);
    expect(status(id)).toBe("succeeded");
    expect(attempts()).toBe(1);
    expect((sqlite.prepare("SELECT delivered_at FROM events").get() as { delivered_at: number | null }).delivered_at).toBeNull();
  });

  it("a receiver answering 500 is recorded as not delivered, redirect unaffected", async () => {
    setup(async () => new Response("{}", { status: 500 }));
    const id = insertIntent(sqlite);

    expect((await submit(id, "succeed")).statusCode).toBe(303);
    expect((sqlite.prepare("SELECT delivered_at FROM events").get() as { delivered_at: number | null }).delivered_at).toBeNull();
  });

  it.each(["", "refund", "SUCCEED", "succeed;decline"])("rejects the outcome %j and changes nothing", async (outcome) => {
    const id = insertIntent(sqlite);
    const response = await submit(id, outcome);

    expect(response.statusCode).toBe(400);
    expect(status(id)).toBe("requires_payment");
    expect(sent()).toHaveLength(0);
  });

  it("404 for an unknown intent, and nothing is sent", async () => {
    expect((await submit("pi_nope", "succeed")).statusCode).toBe(404);
    expect(sent()).toHaveLength(0);
  });

  it("redirects only to the return URL stored at creation, never to anything in the request", async () => {
    const id = insertIntent(sqlite);
    const response = await app.inject({
      method: "POST",
      url: `/pay/${id}?returnUrl=http://evil.com`,
      payload: "outcome=succeed&returnUrl=http://evil.com",
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });

    expect(response.headers.location).toBe("http://localhost:3000/en/orders/order_abc");
  });

  it("the pay page needs no API key but /v1 still does", async () => {
    const id = insertIntent(sqlite);
    expect((await app.inject({ method: "GET", url: `/pay/${id}` })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: `/v1/payment_intents/${id}` })).statusCode).toBe(401);
  });
});
