import Database from "better-sqlite3";

import { MIGRATIONS_FOLDER } from "./db/client.js";
import { migrate } from "./db/migrate.js";

/** A fresh in-memory gateway DB with every migration applied. */
export function memoryDb(): Database.Database {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  migrate(sqlite, MIGRATIONS_FOLDER);
  return sqlite;
}

let counter = 0;

/** Inserts an intent directly and returns its id. */
export function insertIntent(
  sqlite: Database.Database,
  over: { status?: string; amount?: number; currency?: string; returnUrl?: string } = {},
): string {
  counter += 1;
  const id = `pi_test_${counter}`;
  sqlite
    .prepare(
      "INSERT INTO payment_intents (id, amount_cents, currency, status, metadata_order_id, return_url) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(
      id,
      over.amount ?? 132000,
      over.currency ?? "EUR",
      over.status ?? "requires_payment",
      "order_abc",
      over.returnUrl ?? "http://localhost:3000/en/orders/order_abc",
    );
  return id;
}
