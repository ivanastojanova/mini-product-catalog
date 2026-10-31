import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { MIGRATIONS_FOLDER } from "./client.js";
import { migrate } from "./migrate.js";

const sqlite = new Database(":memory:");
sqlite.pragma("foreign_keys = ON");
migrate(sqlite, MIGRATIONS_FOLDER);

let counter = 0;

function makeIntent(overrides: Record<string, unknown> = {}) {
  counter += 1;
  const row = {
    id: `pi_${counter}`,
    amount_cents: 1000,
    currency: "EUR",
    metadata_order_id: "order_1",
    return_url: "http://localhost:3000/en/orders/x",
    ...overrides,
  };
  sqlite
    .prepare(
      "INSERT INTO payment_intents (id, amount_cents, currency, metadata_order_id, return_url, status) VALUES (@id, @amount_cents, @currency, @metadata_order_id, @return_url, @status)",
    )
    .run({ status: "requires_payment", ...row });
  return row.id as string;
}

function makeEvent(intentId: string, overrides: Record<string, unknown> = {}) {
  counter += 1;
  sqlite
    .prepare("INSERT INTO events (id, type, intent_id, payload, delivery_attempts) VALUES (@id, @type, @intent_id, @payload, @attempts)")
    .run({ id: `evt_${counter}`, type: "payment_intent.succeeded", intent_id: intentId, payload: "{}", attempts: 0, ...overrides });
}

describe("payment_intents", () => {
  it("accepts a valid intent and defaults to requires_payment", () => {
    const id = makeIntent();
    expect(sqlite.prepare("SELECT status FROM payment_intents WHERE id = ?").get(id)).toEqual({
      status: "requires_payment",
    });
  });

  it("rejects an amount of zero or less", () => {
    expect(() => makeIntent({ amount_cents: 0 })).toThrow(/CHECK constraint/);
    expect(() => makeIntent({ amount_cents: -1 })).toThrow(/CHECK constraint/);
  });

  it("accepts the four statuses and rejects anything else", () => {
    for (const status of ["requires_payment", "succeeded", "failed", "refunded"]) makeIntent({ status });
    expect(() => makeIntent({ status: "captured" })).toThrow(/CHECK constraint/);
  });

  it("rejects a duplicate id", () => {
    makeIntent({ id: "pi_dup" });
    expect(() => makeIntent({ id: "pi_dup" })).toThrow(/UNIQUE constraint/);
  });
});

describe("events", () => {
  it("accepts the two event types and rejects anything else", () => {
    const intent = makeIntent();
    makeEvent(intent, { type: "payment_intent.succeeded" });
    makeEvent(intent, { type: "payment_intent.payment_failed" });
    expect(() => makeEvent(intent, { type: "charge.refunded" })).toThrow(/CHECK constraint/);
  });

  it("rejects an event for an unknown intent", () => {
    expect(() => makeEvent("pi_missing")).toThrow(/FOREIGN KEY constraint/);
  });

  it("rejects negative delivery attempts", () => {
    expect(() => makeEvent(makeIntent(), { attempts: -1 })).toThrow(/CHECK constraint/);
  });

  it("rejects a reused event id", () => {
    const intent = makeIntent();
    makeEvent(intent, { id: "evt_same" });
    expect(() => makeEvent(intent, { id: "evt_same" })).toThrow(/UNIQUE constraint/);
  });
});

describe("refunds", () => {
  const refund = (intentId: string, id: string, amount = 1000) =>
    sqlite.prepare("INSERT INTO refunds (id, intent_id, amount_cents) VALUES (?, ?, ?)").run(id, intentId, amount);

  it("allows one refund per intent only", () => {
    const intent = makeIntent();
    refund(intent, "re_1");
    expect(() => refund(intent, "re_2")).toThrow(/UNIQUE constraint/);
  });

  it("rejects a refund of zero and a refund for an unknown intent", () => {
    expect(() => refund(makeIntent(), "re_zero", 0)).toThrow(/CHECK constraint/);
    expect(() => refund("pi_missing", "re_orphan")).toThrow(/FOREIGN KEY constraint/);
  });
});

describe("idempotency_keys", () => {
  const store = (key: string, endpoint: string) =>
    sqlite
      .prepare("INSERT INTO idempotency_keys (key, endpoint, request_hash, response_json) VALUES (?, ?, 'h', '{}')")
      .run(key, endpoint);

  it("rejects the same key on the same endpoint", () => {
    store("k1", "POST /v1/refunds");
    expect(() => store("k1", "POST /v1/refunds")).toThrow(/UNIQUE constraint/);
  });

  it("allows the same key on a different endpoint", () => {
    store("k2", "POST /v1/refunds");
    store("k2", "POST /v1/payment_intents");
  });
});
