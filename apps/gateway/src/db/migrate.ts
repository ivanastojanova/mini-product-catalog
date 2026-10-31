import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type Database from "better-sqlite3";

/**
 * Applies every `NNNN_name.sql` file in `folder` that hasn't run yet, in name
 * order, each in its own transaction together with its bookkeeping row. A file
 * that fails changes nothing and stops the run, so a half-applied migration
 * can't exist. Already-applied files are skipped, never re-run. This is the
 * whole migration tool: the gateway is plain SQL on purpose (no ORM).
 * Returns the names it applied.
 */
export function migrate(sqlite: Database.Database, folder: string): string[] {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY NOT NULL,
      applied_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  const applied = new Set(
    (sqlite.prepare("SELECT name FROM schema_migrations").all() as Array<{ name: string }>).map(
      (row) => row.name,
    ),
  );

  const files = readdirSync(folder)
    .filter((file) => /^\d{4}_.+\.sql$/.test(file))
    .sort();

  const ran: string[] = [];

  for (const file of files) {
    if (applied.has(file)) continue;

    const sql = readFileSync(join(folder, file), "utf8");
    sqlite.transaction(() => {
      sqlite.exec(sql);
      sqlite.prepare("INSERT INTO schema_migrations (name) VALUES (?)").run(file);
    })();
    ran.push(file);
  }

  return ran;
}
