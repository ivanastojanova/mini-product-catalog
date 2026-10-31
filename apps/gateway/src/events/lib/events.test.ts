import type Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";

import { insertIntent, memoryDb } from "../../testing.js";
import { settleIntent } from "./events.js";

let sqlite: Database.Database;
beforeEach(() => {
  sqlite = memoryDb();
});

const status = (id: string) =>
  (sqlite.prepare("SELECT status FROM payment_intents WHERE id = ?").get(id) as { status: string }).status;
const events = () => sqlite.prepare("SELECT * FROM events").all() as Array<{ id: string; type: string; intent_id: string; payload: string }>;

describe("settleIntent", () => {
  it("succeed: marks the intent succeeded and records ONE succeeded event", () => {
    const id = insertIntent(sqlite);
    const result = settleIntent(sqlite, id, "succeed", 1767000000);

    expect(result).toMatchObject({ outcome: "settled", sends: 1, returnUrl: "http://localhost:3000/en/orders/order_abc" });
    expect(status(id)).toBe("succeeded");
    expect(events()).toHaveLength(1);
    expect(events()[0]).toMatchObject({ type: "payment_intent.succeeded", intent_id: id });
  });

  it("builds the event body apps/api reads: id, type, created, data.object.{id, amount, currency, metadata.orderId}", () => {
    const id = insertIntent(sqlite);
    const result = settleIntent(sqlite, id, "succeed", 1767000000);
    if (result.outcome !== "settled") throw new Error("expected settled");

    expect(JSON.parse(events()[0].payload)).toEqual({
      id: result.eventId,
      type: "payment_intent.succeeded",
      created: 1767000000,
      data: { object: { id, amount: 132000, currency: "EUR", metadata: { orderId: "order_abc" } } },
    });
    expect(result.eventId).toMatch(/^evt_[0-9a-f]{32}$/);
  });

  it("succeed_twice: still ONE event, but asks for two deliveries", () => {
    const id = insertIntent(sqlite);
    const result = settleIntent(sqlite, id, "succeed_twice");

    expect(result).toMatchObject({ outcome: "settled", sends: 2 });
    expect(events()).toHaveLength(1);
    expect(status(id)).toBe("succeeded");
  });

  it("decline: marks the intent failed and records a payment_failed event", () => {
    const id = insertIntent(sqlite);
    const result = settleIntent(sqlite, id, "decline");

    expect(result).toMatchObject({ outcome: "settled", sends: 1 });
    expect(status(id)).toBe("failed");
    expect(events()[0].type).toBe("payment_intent.payment_failed");
  });

  it.each(["succeeded", "failed", "refunded"])(
    "an intent that is already %s creates no event and changes nothing",
    (current) => {
      const id = insertIntent(sqlite, { status: current });
      for (const outcome of ["succeed", "succeed_twice", "decline"] as const) {
        expect(settleIntent(sqlite, id, outcome)).toEqual({
          outcome: "already_settled",
          returnUrl: "http://localhost:3000/en/orders/order_abc",
        });
      }
      expect(status(id)).toBe(current);
      expect(events()).toHaveLength(0);
    },
  );

  it("a second click after paying does not produce a second event", () => {
    const id = insertIntent(sqlite);
    settleIntent(sqlite, id, "succeed");
    expect(settleIntent(sqlite, id, "succeed").outcome).toBe("already_settled");
    expect(settleIntent(sqlite, id, "decline").outcome).toBe("already_settled");
    expect(events()).toHaveLength(1);
    expect(status(id)).toBe("succeeded");
  });

  it("reports an unknown intent", () => {
    expect(settleIntent(sqlite, "pi_nope", "succeed")).toEqual({ outcome: "not_found" });
    expect(events()).toHaveLength(0);
  });

  it("is atomic: if recording the event fails, the status change is rolled back", () => {
    const id = insertIntent(sqlite);
    sqlite.exec("CREATE TRIGGER fail_event BEFORE INSERT ON events BEGIN SELECT RAISE(ABORT, 'disk full'); END");

    expect(() => settleIntent(sqlite, id, "succeed")).toThrow(/disk full/);
    expect(status(id)).toBe("requires_payment");
  });
});
