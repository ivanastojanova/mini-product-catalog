import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";

import { MIGRATIONS_FOLDER } from "../../db/client.js";
import { migrate } from "../../db/migrate.js";
import { createIntent, getIntent, newIntentId } from "./intents.js";

const PUBLIC = "http://localhost:4100";
const input = {
  amountCents: 132000,
  currency: "EUR",
  orderId: "order_abc",
  returnUrl: "http://localhost:3000/en/orders/order_abc",
};

let sqlite: Database.Database;

beforeEach(() => {
  sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  migrate(sqlite, MIGRATIONS_FOLDER);
});

const create = (idempotencyKey: string, over: Partial<typeof input> = {}) =>
  createIntent(sqlite, { publicUrl: PUBLIC, idempotencyKey, input: { ...input, ...over } });

const count = (table: string) =>
  (sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

describe("newIntentId", () => {
  it("is pi_ plus 32 hex characters and never repeats", () => {
    const ids = new Set(Array.from({ length: 200 }, newIntentId));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(/^pi_[0-9a-f]{32}$/);
  });
});

describe("createIntent", () => {
  it("creates a requires_payment intent with a pay URL built from the public URL", () => {
    const result = create("k1");
    if (result.outcome !== "created") throw new Error("expected created");

    expect(result.intent.status).toBe("requires_payment");
    expect(result.intent.payUrl).toBe(`${PUBLIC}/pay/${result.intent.id}`);
    expect(getIntent(sqlite, PUBLIC, result.intent.id)).toMatchObject({
      status: "requires_payment",
      amountCents: 132000,
      currency: "EUR",
      orderId: "order_abc",
      returnUrl: input.returnUrl,
    });
  });

  it("replays the same key and request: same intent, nothing new stored", () => {
    const first = create("k1");
    const second = create("k1");

    expect(first.outcome).toBe("created");
    expect(second.outcome).toBe("replayed");
    expect((second as { intent: unknown }).intent).toEqual((first as { intent: unknown }).intent);
    expect(count("payment_intents")).toBe(1);
    expect(count("idempotency_keys")).toBe(1);
  });

  it.each([
    ["amount", { amountCents: 1 }],
    ["currency", { currency: "USD" }],
    ["order", { orderId: "order_other" }],
    ["return URL", { returnUrl: "http://localhost:3000/en/orders/other" }],
  ])("refuses the same key with a different %s, and creates nothing", (_label, change) => {
    create("k1");

    expect(create("k1", change)).toEqual({ outcome: "key_reused_with_different_request" });
    expect(count("payment_intents")).toBe(1);
  });

  it("creates separate intents for separate keys, even for the same order", () => {
    const a = create("k1");
    const b = create("k2");

    expect((a as { intent: { id: string } }).intent.id).not.toBe((b as { intent: { id: string } }).intent.id);
    expect(count("payment_intents")).toBe(2);
  });

  it("is atomic: if storing the key fails, the intent is not left behind (so a retry can't find a half-made one)", () => {
    // The lookup works, the intent insert works, and only the key insert fails.
    sqlite.exec(
      "CREATE TRIGGER fail_key_insert BEFORE INSERT ON idempotency_keys BEGIN SELECT RAISE(ABORT, 'disk full'); END",
    );

    expect(() => create("k1")).toThrow(/disk full/);
    expect(count("payment_intents")).toBe(0);

    sqlite.exec("DROP TRIGGER fail_key_insert");
    expect(create("k1").outcome).toBe("created");
    expect(count("payment_intents")).toBe(1);
  });

  it("keeps the replay answer even after the intent changes state", () => {
    const first = create("k1") as { intent: { id: string } };
    sqlite.prepare("UPDATE payment_intents SET status = 'succeeded' WHERE id = ?").run(first.intent.id);

    expect(create("k1")).toMatchObject({ outcome: "replayed", intent: { status: "requires_payment" } });
  });
});

describe("getIntent", () => {
  it("returns null for an unknown id", () => {
    expect(getIntent(sqlite, PUBLIC, "pi_nope")).toBeNull();
  });

  it("reflects the current status", () => {
    const { intent } = create("k1") as { intent: { id: string } };
    sqlite.prepare("UPDATE payment_intents SET status = 'failed' WHERE id = ?").run(intent.id);
    expect(getIntent(sqlite, PUBLIC, intent.id)?.status).toBe("failed");
  });
});
