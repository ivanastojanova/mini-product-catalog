import { beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "../../db/schema.js";
import {
  commitStock,
  getAvailability,
  releaseStock,
  reserveStock,
  seedInventory,
} from "./inventoryRepo.js";

const sqlite = new Database(":memory:");
sqlite.pragma("foreign_keys = ON");
const db = drizzle(sqlite, { schema });
migrate(db, { migrationsFolder: "./src/db/migrations" });

function seed(rows: Array<[slug: string, onHand: number, reserved?: number]>) {
  for (const [productSlug, onHand, reserved = 0] of rows) {
    db.insert(schema.inventory).values({ productSlug, onHand, reserved }).run();
  }
}

function stock(slug: string) {
  const row = db.select().from(schema.inventory).all().find((r) => r.productSlug === slug);
  return row ? { onHand: row.onHand, reserved: row.reserved } : undefined;
}

beforeEach(() => {
  db.delete(schema.inventory).run();
});

describe("seedInventory", () => {
  it("adds a row with the given stock for each new slug", () => {
    expect(seedInventory(db, ["a", "b"], 10)).toEqual(["a", "b"]);
    expect(stock("a")).toEqual({ onHand: 10, reserved: 0 });
    expect(stock("b")).toEqual({ onHand: 10, reserved: 0 });
  });

  it("never overwrites an existing row: live stock and reservations survive a re-run", () => {
    seed([["a", 3, 2]]);
    expect(seedInventory(db, ["a", "b"], 10)).toEqual(["b"]);
    expect(stock("a")).toEqual({ onHand: 3, reserved: 2 });
    expect(stock("b")).toEqual({ onHand: 10, reserved: 0 });
  });

  it("is idempotent", () => {
    seedInventory(db, ["a"], 10);
    expect(seedInventory(db, ["a"], 10)).toEqual([]);
  });

  it("tolerates duplicate slugs in the input", () => {
    expect(seedInventory(db, ["a", "a"], 10)).toEqual(["a"]);
  });

  it("allows seeding 0 (out of stock) but rejects negative or fractional stock", () => {
    expect(seedInventory(db, ["a"], 0)).toEqual(["a"]);
    expect(() => seedInventory(db, ["b"], -1)).toThrow(RangeError);
    expect(() => seedInventory(db, ["b"], 1.5)).toThrow(RangeError);
    expect(stock("b")).toBeUndefined();
  });
});

describe("getAvailability", () => {
  it("is on_hand minus reserved, and 0 for a slug with no row", () => {
    seed([["a", 10, 3]]);
    const available = getAvailability(db, ["a", "ghost"]);
    expect(available.get("a")).toBe(7);
    expect(available.get("ghost")).toBe(0);
  });

  it("handles an empty slug list", () => {
    expect(getAvailability(db, []).size).toBe(0);
  });
});

describe("reserveStock", () => {
  it("holds units without changing on_hand", () => {
    seed([["a", 5]]);
    expect(reserveStock(db, [{ slug: "a", quantity: 2 }])).toEqual({ ok: true });
    expect(stock("a")).toEqual({ onHand: 5, reserved: 2 });
  });

  it("reserves exactly the last unit, then refuses the next request for it", () => {
    seed([["a", 1]]);
    expect(reserveStock(db, [{ slug: "a", quantity: 1 }])).toEqual({ ok: true });
    expect(reserveStock(db, [{ slug: "a", quantity: 1 }])).toEqual({
      ok: false,
      short: [{ slug: "a", requested: 1, available: 0 }],
    });
    expect(stock("a")).toEqual({ onHand: 1, reserved: 1 });
  });

  it("two orders racing for the last unit: exactly one succeeds", () => {
    seed([["a", 1]]);
    const results = [
      reserveStock(db, [{ slug: "a", quantity: 1 }]),
      reserveStock(db, [{ slug: "a", quantity: 1 }]),
    ];
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(stock("a")).toEqual({ onHand: 1, reserved: 1 });
  });

  it("refuses more than is available and reports how many are", () => {
    seed([["a", 5, 4]]);
    expect(reserveStock(db, [{ slug: "a", quantity: 2 }])).toEqual({
      ok: false,
      short: [{ slug: "a", requested: 2, available: 1 }],
    });
    expect(stock("a")).toEqual({ onHand: 5, reserved: 4 });
  });

  it("treats a slug with no inventory row as out of stock", () => {
    expect(reserveStock(db, [{ slug: "ghost", quantity: 1 }])).toEqual({
      ok: false,
      short: [{ slug: "ghost", requested: 1, available: 0 }],
    });
  });

  it("is all-or-nothing: line 2 short rolls back line 1's hold", () => {
    seed([
      ["a", 5],
      ["b", 1],
    ]);
    const result = reserveStock(db, [
      { slug: "a", quantity: 3 },
      { slug: "b", quantity: 2 },
    ]);
    expect(result).toEqual({ ok: false, short: [{ slug: "b", requested: 2, available: 1 }] });
    expect(stock("a")).toEqual({ onHand: 5, reserved: 0 });
    expect(stock("b")).toEqual({ onHand: 1, reserved: 0 });
  });

  it("reports every short line, not just the first", () => {
    seed([
      ["a", 1],
      ["b", 1],
      ["c", 9],
    ]);
    const result = reserveStock(db, [
      { slug: "a", quantity: 2 },
      { slug: "b", quantity: 2 },
      { slug: "c", quantity: 2 },
    ]);
    expect(result).toEqual({
      ok: false,
      short: [
        { slug: "a", requested: 2, available: 1 },
        { slug: "b", requested: 2, available: 1 },
      ],
    });
  });

  it("keeps a failed reservation from undoing the caller's earlier work in the same transaction", () => {
    seed([
      ["a", 5],
      ["b", 0],
    ]);
    db.transaction((tx) => {
      expect(reserveStock(tx, [{ slug: "a", quantity: 2 }])).toEqual({ ok: true });
      expect(reserveStock(tx, [{ slug: "b", quantity: 1 }]).ok).toBe(false);
    });
    expect(stock("a")).toEqual({ onHand: 5, reserved: 2 });
  });

  it("is undone with the caller's transaction when the caller aborts", () => {
    seed([["a", 5]]);
    expect(() =>
      db.transaction((tx) => {
        reserveStock(tx, [{ slug: "a", quantity: 2 }]);
        throw new Error("order insert failed");
      }),
    ).toThrow("order insert failed");
    expect(stock("a")).toEqual({ onHand: 5, reserved: 0 });
  });

  it.each([0, -1, 1.5, Number.NaN])("rejects an invalid quantity (%s) instead of reserving it", (quantity) => {
    seed([["a", 5, 2]]);
    expect(() => reserveStock(db, [{ slug: "a", quantity }])).toThrow(RangeError);
    expect(stock("a")).toEqual({ onHand: 5, reserved: 2 });
  });

  it("rejects duplicate slugs in one call", () => {
    seed([["a", 5]]);
    expect(() =>
      reserveStock(db, [
        { slug: "a", quantity: 1 },
        { slug: "a", quantity: 1 },
      ]),
    ).toThrow(RangeError);
  });
});

describe("releaseStock", () => {
  it("returns held units to available without touching on_hand", () => {
    seed([["a", 5, 3]]);
    releaseStock(db, [{ slug: "a", quantity: 2 }]);
    expect(stock("a")).toEqual({ onHand: 5, reserved: 1 });
  });

  it("reserve then release restores the original availability", () => {
    seed([["a", 5]]);
    reserveStock(db, [{ slug: "a", quantity: 4 }]);
    releaseStock(db, [{ slug: "a", quantity: 4 }]);
    expect(getAvailability(db, ["a"]).get("a")).toBe(5);
  });

  it("throws rather than letting reserved go negative (releasing what was never held)", () => {
    seed([["a", 5, 1]]);
    expect(() => releaseStock(db, [{ slug: "a", quantity: 2 }])).toThrow(/CHECK constraint/);
    expect(stock("a")).toEqual({ onHand: 5, reserved: 1 });
  });

  it("throws for a slug with no inventory row", () => {
    expect(() => releaseStock(db, [{ slug: "ghost", quantity: 1 }])).toThrow(/ghost/);
  });
});

describe("commitStock", () => {
  it("removes the units from both reserved and on_hand (the hold becomes a sale)", () => {
    seed([["a", 5, 3]]);
    commitStock(db, [{ slug: "a", quantity: 3 }]);
    expect(stock("a")).toEqual({ onHand: 2, reserved: 0 });
  });

  it("leaves availability unchanged: it was already unavailable while held", () => {
    seed([["a", 5]]);
    reserveStock(db, [{ slug: "a", quantity: 2 }]);
    const before = getAvailability(db, ["a"]).get("a");
    commitStock(db, [{ slug: "a", quantity: 2 }]);
    expect(getAvailability(db, ["a"]).get("a")).toBe(before);
  });

  it("throws rather than selling units that were not held", () => {
    seed([["a", 5, 1]]);
    expect(() => commitStock(db, [{ slug: "a", quantity: 2 }])).toThrow(/CHECK constraint/);
    expect(stock("a")).toEqual({ onHand: 5, reserved: 1 });
  });

  it("throws for a slug with no inventory row", () => {
    expect(() => commitStock(db, [{ slug: "ghost", quantity: 1 }])).toThrow(/ghost/);
  });
});
