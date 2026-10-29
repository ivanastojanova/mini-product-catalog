import { and, eq, inArray, sql } from "drizzle-orm";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import type Database from "better-sqlite3";

import { inventory } from "../../db/schema.js";
import type * as schema from "../../db/schema.js";

/**
 * Either the top-level db or a transaction handle. These functions take it as
 * an argument (rather than importing `db`) so order creation and
 * `applyTransition` can run them inside their own transaction: "reserve stock
 * and create the order" must be all-or-nothing.
 */
export type DbHandle = BaseSQLiteDatabase<"sync", Database.RunResult, typeof schema>;

export type StockLine = { slug: string; quantity: number };

export type ShortLine = { slug: string; requested: number; available: number };

export type ReserveResult = { ok: true } | { ok: false; short: ShortLine[] };

function assertValidLines(lines: StockLine[]): void {
  for (const line of lines) {
    if (!Number.isInteger(line.quantity) || line.quantity < 1) {
      throw new RangeError(`Invalid stock quantity for "${line.slug}": ${String(line.quantity)}`);
    }
  }
  if (new Set(lines.map((line) => line.slug)).size !== lines.length) {
    throw new RangeError("Duplicate slugs in stock lines");
  }
}

class ReservationShortError extends Error {}

/**
 * Creates an inventory row (`onHand` units, none reserved) for each slug that
 * doesn't have one. Never overwrites an existing row, so re-running the seed
 * can't reset live stock or wipe out reservations. Returns the slugs it added.
 */
export function seedInventory(db: DbHandle, slugs: string[], onHand: number): string[] {
  if (!Number.isInteger(onHand) || onHand < 0) {
    throw new RangeError(`Invalid seed stock: ${String(onHand)}`);
  }

  const added: string[] = [];
  for (const slug of new Set(slugs)) {
    const { changes } = db
      .insert(inventory)
      .values({ productSlug: slug, onHand })
      .onConflictDoNothing()
      .run();

    if (changes > 0) {
      added.push(slug);
    }
  }
  return added;
}

/**
 * One slug's sellable units plus when the row last changed, for the public
 * stock endpoint. Null when the slug has no inventory row (callers report that
 * as 0 available, same as `getAvailability`).
 */
export function getStockLevel(
  db: DbHandle,
  slug: string,
): { available: number; updatedAt: Date } | null {
  const row = db
    .select({
      onHand: inventory.onHand,
      reserved: inventory.reserved,
      updatedAt: inventory.updatedAt,
    })
    .from(inventory)
    .where(eq(inventory.productSlug, slug))
    .get();

  return row ? { available: row.onHand - row.reserved, updatedAt: row.updatedAt } : null;
}

/** Units that can still be reserved per slug (on_hand - reserved). A slug with no inventory row is 0. */
export function getAvailability(db: DbHandle, slugs: string[]): Map<string, number> {
  const available = new Map<string, number>(slugs.map((slug) => [slug, 0]));
  if (slugs.length === 0) {
    return available;
  }

  const rows = db
    .select({ slug: inventory.productSlug, onHand: inventory.onHand, reserved: inventory.reserved })
    .from(inventory)
    .where(inArray(inventory.productSlug, slugs))
    .all();

  for (const row of rows) {
    available.set(row.slug, row.onHand - row.reserved);
  }
  return available;
}

/**
 * Holds `quantity` of each line for an unpaid order. All-or-nothing: if any
 * line is short, none are held and the short lines are returned.
 *
 * Each line is one conditional UPDATE (`... WHERE on_hand - reserved >= q`),
 * not read-then-write, so the check and the hold can't be separated. If the
 * code is ever wrong, the table's CHECKs still refuse to oversell.
 */
export function reserveStock(db: DbHandle, lines: StockLine[]): ReserveResult {
  assertValidLines(lines);

  try {
    // Nested transaction = savepoint: a partial hold is undone even when the caller's transaction goes on.
    db.transaction((tx) => {
      for (const line of lines) {
        const { changes } = tx
          .update(inventory)
          .set({
            reserved: sql`${inventory.reserved} + ${line.quantity}`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(inventory.productSlug, line.slug),
              sql`${inventory.onHand} - ${inventory.reserved} >= ${line.quantity}`,
            ),
          )
          .run();

        if (changes === 0) {
          throw new ReservationShortError();
        }
      }
    });
  } catch (error) {
    if (!(error instanceof ReservationShortError)) {
      throw error;
    }

    const available = getAvailability(db, lines.map((line) => line.slug));
    const short = lines
      .filter((line) => (available.get(line.slug) ?? 0) < line.quantity)
      .map((line) => ({
        slug: line.slug,
        requested: line.quantity,
        available: available.get(line.slug) ?? 0,
      }));
    return { ok: false, short };
  }

  return { ok: true };
}

/**
 * Gives held units back (cancel / expiry). Throws if a line has no inventory
 * row or would drive `reserved` below zero: releasing what was never held is a
 * bug to surface, not to clamp. Callers must only call this in the same
 * transaction as the status change that guards against a double release.
 */
export function releaseStock(db: DbHandle, lines: StockLine[]): void {
  assertValidLines(lines);

  for (const line of lines) {
    const { changes } = db
      .update(inventory)
      .set({
        reserved: sql`${inventory.reserved} - ${line.quantity}`,
        updatedAt: new Date(),
      })
      .where(eq(inventory.productSlug, line.slug))
      .run();

    if (changes === 0) {
      throw new Error(`No inventory row for "${line.slug}"`);
    }
  }
}

/**
 * Turns held units into a sale (payment): they leave both `reserved` and
 * `on_hand`. Same strictness and same transaction rule as `releaseStock`.
 */
export function commitStock(db: DbHandle, lines: StockLine[]): void {
  assertValidLines(lines);

  for (const line of lines) {
    const { changes } = db
      .update(inventory)
      .set({
        reserved: sql`${inventory.reserved} - ${line.quantity}`,
        onHand: sql`${inventory.onHand} - ${line.quantity}`,
        updatedAt: new Date(),
      })
      .where(eq(inventory.productSlug, line.slug))
      .run();

    if (changes === 0) {
      throw new Error(`No inventory row for "${line.slug}"`);
    }
  }
}
