import { beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import * as schema from "../../db/schema.js";
import { createHttpPaymentGateway, type PaymentGateway } from "./gatewayClient.js";
import { requestRefunds } from "./requestRefunds.js";

const sqlite = new Database(":memory:");
sqlite.pragma("foreign_keys = ON");
const db = drizzle(sqlite, { schema });
migrate(db, { migrationsFolder: "./src/db/migrations" });

const log = { error: vi.fn() };

/** A gateway whose only working call is `refund`. */
const refundOnly = (refund: PaymentGateway["refund"]): PaymentGateway => ({
  createPaymentIntent: vi.fn(async () => {
    throw new Error("not used");
  }),
  refund,
});

let counter = 0;

function makePayment(status: (typeof schema.PAYMENT_STATUS_VALUES)[number], intentId: string | null = null) {
  counter += 1;
  const [order] = db
    .insert(schema.orders)
    .values({
      publicId: `pub-${counter}`,
      guestTokenHash: `guest-${counter}`,
      contactEmail: "g@example.com",
      status: "expired",
      currency: "EUR",
      totalCents: 1000,
      shipName: "Ada",
      shipLine1: "1 Main St",
      shipCity: "Berlin",
      shipPostalCode: "10115",
      shipCountry: "DE",
      idempotencyKey: `key-${counter}`,
      reservationExpiresAt: new Date(),
    })
    .returning()
    .all();

  const [payment] = db
    .insert(schema.payments)
    .values({
      orderId: order.id,
      gatewayIntentId: intentId === null ? `pi_${counter}` : intentId,
      amountCents: 1000,
      currency: "EUR",
      status,
    })
    .returning()
    .all();
  return payment;
}

function row(id: number) {
  return db.select().from(schema.payments).where(eq(schema.payments.id, id)).get()!;
}

beforeEach(() => {
  sqlite.exec("DELETE FROM payments; DELETE FROM orders;");
  log.error.mockClear();
});

describe("requestRefunds", () => {
  it("refunds a refund_pending payment and records the refund id", async () => {
    const payment = makePayment("refund_pending");
    const refund = vi.fn(async () => ({ id: "re_1" }));

    await requestRefunds(db, refundOnly(refund), [payment.id], log);

    expect(refund).toHaveBeenCalledTimes(1);
    expect(refund).toHaveBeenCalledWith({
      paymentIntentId: payment.gatewayIntentId,
      idempotencyKey: `refund-${payment.id}`,
    });
    expect(row(payment.id)).toMatchObject({ status: "refunded", refundId: "re_1" });
  });

  it("leaves the payment refund_pending and logs when the gateway fails, without throwing", async () => {
    const payment = makePayment("refund_pending");
    const refund = vi.fn(async () => {
      throw new Error("gateway down");
    });

    await expect(requestRefunds(db, refundOnly(refund), [payment.id], log)).resolves.toBeUndefined();

    expect(row(payment.id)).toMatchObject({ status: "refund_pending", refundId: null });
    expect(log.error).toHaveBeenCalledTimes(1);
  });

  it("keeps going after one refund fails", async () => {
    const bad = makePayment("refund_pending");
    const good = makePayment("refund_pending");
    const refund = vi.fn(async ({ paymentIntentId }: { paymentIntentId: string }) => {
      if (paymentIntentId === bad.gatewayIntentId) throw new Error("nope");
      return { id: "re_ok" };
    });

    await requestRefunds(db, refundOnly(refund), [bad.id, good.id], log);

    expect(row(bad.id).status).toBe("refund_pending");
    expect(row(good.id).status).toBe("refunded");
  });

  it("only refunds payments that are refund_pending", async () => {
    const succeeded = makePayment("succeeded");
    const refunded = makePayment("refunded");
    const pending = makePayment("pending");
    const refund = vi.fn(async () => ({ id: "re_x" }));

    await requestRefunds(db, refundOnly(refund), [succeeded.id, refunded.id, pending.id], log);

    expect(refund).not.toHaveBeenCalled();
    expect(row(succeeded.id).status).toBe("succeeded");
    expect(row(pending.id).status).toBe("pending");
  });

  it("does nothing for an empty list", async () => {
    const refund = vi.fn(async () => ({ id: "re_x" }));
    await requestRefunds(db, refundOnly(refund), [], log);
    expect(refund).not.toHaveBeenCalled();
  });

  it("keeps a payment with no intent id refund_pending instead of calling the gateway", async () => {
    const payment = makePayment("refund_pending", null);
    db.update(schema.payments).set({ gatewayIntentId: null }).where(eq(schema.payments.id, payment.id)).run();
    const refund = vi.fn(async () => ({ id: "re_x" }));

    await requestRefunds(db, refundOnly(refund), [payment.id], log);

    expect(refund).not.toHaveBeenCalled();
    expect(row(payment.id).status).toBe("refund_pending");
    expect(log.error).toHaveBeenCalled();
  });

  it("uses a stable idempotency key, so retrying the same payment can't refund twice", async () => {
    const payment = makePayment("refund_pending");
    const keys: string[] = [];
    const failOnce = refundOnly(
      vi.fn(async ({ idempotencyKey }) => {
        keys.push(idempotencyKey);
        if (keys.length === 1) throw new Error("timeout");
        return { id: "re_1" };
      }),
    );

    await requestRefunds(db, failOnce, [payment.id], log);
    await requestRefunds(db, failOnce, [payment.id], log);

    expect(keys).toEqual([`refund-${payment.id}`, `refund-${payment.id}`]);
    expect(row(payment.id).status).toBe("refunded");
  });
});

describe("createHttpPaymentGateway", () => {
  const config = { baseUrl: "http://gateway.test/", apiKey: "key_123" };

  function respond(status: number, body: unknown) {
    return vi.fn(async () => new Response(JSON.stringify(body), { status }));
  }

  it("posts the refund with the bearer key and idempotency key", async () => {
    const fetchImpl = respond(200, { id: "re_9" });
    const gateway = createHttpPaymentGateway({ ...config, fetchImpl: fetchImpl as unknown as typeof fetch });

    await expect(gateway.refund({ paymentIntentId: "pi_1", idempotencyKey: "refund-5" })).resolves.toEqual({
      id: "re_9",
    });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://gateway.test/v1/refunds");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      authorization: "Bearer key_123",
      "idempotency-key": "refund-5",
      "content-type": "application/json",
    });
    expect(JSON.parse(init.body as string)).toEqual({ paymentIntentId: "pi_1" });
  });

  it.each([400, 401, 404, 500, 503])("throws on a %s response", async (status) => {
    const gateway = createHttpPaymentGateway({
      ...config,
      fetchImpl: respond(status, {}) as unknown as typeof fetch,
    });
    await expect(gateway.refund({ paymentIntentId: "pi_1", idempotencyKey: "k" })).rejects.toThrow(
      String(status),
    );
  });

  it("throws when the response has no refund id", async () => {
    const gateway = createHttpPaymentGateway({
      ...config,
      fetchImpl: respond(200, {}) as unknown as typeof fetch,
    });
    await expect(gateway.refund({ paymentIntentId: "pi_1", idempotencyKey: "k" })).rejects.toThrow(/no id/);
  });

  it("throws, without sending anything, when no API key is configured", async () => {
    const previous = process.env.GATEWAY_API_KEY;
    delete process.env.GATEWAY_API_KEY;
    try {
      const fetchImpl = respond(200, { id: "re_1" });
      const gateway = createHttpPaymentGateway({ baseUrl: "http://gateway.test", fetchImpl: fetchImpl as unknown as typeof fetch });
      await expect(gateway.refund({ paymentIntentId: "pi_1", idempotencyKey: "k" })).rejects.toThrow(
        /GATEWAY_API_KEY/,
      );
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally {
      if (previous !== undefined) process.env.GATEWAY_API_KEY = previous;
    }
  });

  it("propagates a network failure", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const gateway = createHttpPaymentGateway({ ...config, fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(gateway.refund({ paymentIntentId: "pi_1", idempotencyKey: "k" })).rejects.toThrow(
      /fetch failed/,
    );
  });
});

describe("createHttpPaymentGateway.createPaymentIntent", () => {
  const config = { baseUrl: "http://gateway.test/", apiKey: "key_123" };
  const input = {
    amountCents: 4200,
    currency: "EUR",
    orderId: "order_abc",
    returnUrl: "http://localhost:3000/en/orders/order_abc",
    idempotencyKey: "payment-7-en",
  };
  const respond = (status: number, body: unknown) =>
    vi.fn(async () => new Response(JSON.stringify(body), { status }));
  const make = (fetchImpl: unknown) =>
    createHttpPaymentGateway({ ...config, fetchImpl: fetchImpl as typeof fetch });

  it("posts the intent with the bearer key and idempotency key, and returns only the id", async () => {
    const fetchImpl = respond(201, { id: "pi_abc123", status: "requires_payment", payUrl: "http://elsewhere/pay/x" });

    await expect(make(fetchImpl).createPaymentIntent(input)).resolves.toEqual({ id: "pi_abc123" });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://gateway.test/v1/payment_intents");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      authorization: "Bearer key_123",
      "idempotency-key": "payment-7-en",
      "content-type": "application/json",
    });
    expect(JSON.parse(init.body as string)).toEqual({
      amountCents: 4200,
      currency: "EUR",
      orderId: "order_abc",
      returnUrl: input.returnUrl,
    });
  });

  it("accepts a replayed (200) answer", async () => {
    await expect(make(respond(200, { id: "pi_abc123" })).createPaymentIntent(input)).resolves.toEqual({ id: "pi_abc123" });
  });

  it.each([400, 401, 409, 500, 503])("throws on a %s response", async (status) => {
    await expect(make(respond(status, {})).createPaymentIntent(input)).rejects.toThrow(String(status));
  });

  it.each([
    ["missing", {}],
    ["not a string", { id: 5 }],
    ["not a pi_ token", { id: "abc" }],
    ["containing a slash", { id: "pi_a/../../x" }],
    ["containing a query", { id: "pi_a?next=http://evil" }],
    ["with whitespace", { id: "pi_a b" }],
    ["empty after pi_", { id: "pi_" }],
  ])("rejects an intent id that is %s, because it ends up in a URL", async (_label, body) => {
    await expect(make(respond(201, body)).createPaymentIntent(input)).rejects.toThrow(/valid id/);
  });

  it("throws, without sending anything, when no API key is configured", async () => {
    const previous = process.env.GATEWAY_API_KEY;
    delete process.env.GATEWAY_API_KEY;
    try {
      const fetchImpl = respond(201, { id: "pi_abc" });
      const gateway = createHttpPaymentGateway({ baseUrl: "http://gateway.test", fetchImpl: fetchImpl as unknown as typeof fetch });
      await expect(gateway.createPaymentIntent(input)).rejects.toThrow(/GATEWAY_API_KEY/);
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally {
      if (previous !== undefined) process.env.GATEWAY_API_KEY = previous;
    }
  });

  it("propagates a network failure", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(make(fetchImpl).createPaymentIntent(input)).rejects.toThrow(/fetch failed/);
  });
});
