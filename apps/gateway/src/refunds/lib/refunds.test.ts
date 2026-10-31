import type Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";

import { insertIntent, memoryDb } from "../../testing.js";
import { refundIntent } from "./refunds.js";

let sqlite: Database.Database;
beforeEach(() => {
  sqlite = memoryDb();
});

const refund = (paymentIntentId: string, idempotencyKey = "k1") => refundIntent(sqlite, { idempotencyKey, paymentIntentId });
const refundCount = () => (sqlite.prepare("SELECT COUNT(*) AS n FROM refunds").get() as { n: number }).n;
const status = (id: string) =>
  (sqlite.prepare("SELECT status FROM payment_intents WHERE id = ?").get(id) as { status: string }).status;

describe("refundIntent", () => {
  it("refunds the full amount of a succeeded intent and marks it refunded", () => {
    const id = insertIntent(sqlite, { status: "succeeded", amount: 4200 });
    const result = refund(id);

    expect(result).toMatchObject({ outcome: "created", refund: { paymentIntentId: id, amountCents: 4200 } });
    expect((result as { refund: { id: string } }).refund.id).toMatch(/^re_[0-9a-f]{32}$/);
    expect(status(id)).toBe("refunded");
    expect(refundCount()).toBe(1);
  });

  it("the same key again returns the same refund", () => {
    const id = insertIntent(sqlite, { status: "succeeded" });
    const first = refund(id) as { refund: unknown };
    const second = refund(id);

    expect(second).toEqual({ outcome: "replayed", refund: first.refund });
    expect(refundCount()).toBe(1);
  });

  it("a NEW key for an already-refunded intent still returns the original refund: money goes back once", () => {
    const id = insertIntent(sqlite, { status: "succeeded" });
    const first = refund(id, "k1") as { refund: unknown };
    const second = refund(id, "k2");

    expect(second).toEqual({ outcome: "replayed", refund: first.refund });
    expect(refundCount()).toBe(1);
  });

  it.each(["requires_payment", "failed"])("refuses a %s intent and writes nothing", (current) => {
    const id = insertIntent(sqlite, { status: current });

    expect(refund(id)).toEqual({ outcome: "not_refundable", status: current });
    expect(status(id)).toBe(current);
    expect(refundCount()).toBe(0);
  });

  it("does not burn the key on a refusal: once the intent has succeeded the same key works", () => {
    const id = insertIntent(sqlite);
    expect(refund(id).outcome).toBe("not_refundable");
    sqlite.prepare("UPDATE payment_intents SET status = 'succeeded' WHERE id = ?").run(id);

    expect(refund(id).outcome).toBe("created");
  });

  it("reports an unknown intent", () => {
    expect(refund("pi_nope")).toEqual({ outcome: "intent_not_found" });
  });

  it("refuses a key reused for a different intent, and refunds neither", () => {
    const a = insertIntent(sqlite, { status: "succeeded" });
    const b = insertIntent(sqlite, { status: "succeeded" });
    refund(a, "shared");

    expect(refund(b, "shared")).toEqual({ outcome: "key_reused_with_different_request" });
    expect(status(b)).toBe("succeeded");
    expect(refundCount()).toBe(1);
  });

  it("is atomic: if storing the key fails, no refund and no status change remain", () => {
    const id = insertIntent(sqlite, { status: "succeeded" });
    sqlite.exec("CREATE TRIGGER fail_key BEFORE INSERT ON idempotency_keys BEGIN SELECT RAISE(ABORT, 'disk full'); END");

    expect(() => refund(id)).toThrow(/disk full/);
    expect(refundCount()).toBe(0);
    expect(status(id)).toBe("succeeded");
  });
});
