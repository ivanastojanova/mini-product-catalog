import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

import { migrate } from "./migrate.js";

/** Where the SQL files live, resolved from this file so it works from `src/` (tsx) and `dist/` alike. */
export const MIGRATIONS_FOLDER = fileURLToPath(new URL("../../migrations", import.meta.url));

/** Opens (creating if needed) the gateway's own SQLite file and brings it up to date. Separate from apps/api's commerce.db: the gateway is a different system. */
export function openDatabase(path: string): Database.Database {
  const sqlite = new Database(path);
  sqlite.pragma("foreign_keys = ON");
  migrate(sqlite, MIGRATIONS_FOLDER);
  return sqlite;
}
