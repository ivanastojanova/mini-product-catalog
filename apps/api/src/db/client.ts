import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";

/**
 * Drizzle client for apps/api's commerce DB (`commerce.db`) — a separate
 * SQLite file from apps/cms's `payload.db`, per
 * docs/adr/0001-monorepo-content-commerce-split.md and
 * docs/adr/0004-standalone-commerce-api-service.md.
 *
 * No globalThis caching needed here (unlike the old apps/web version) —
 * apps/api is a single long-running Node process, not a dev server that
 * reloads modules per-request.
 */
function dbPath(): string {
  const url = process.env.DATABASE_URL ?? "file:./commerce.db";
  return url.replace(/^file:/, "");
}

const sqlite = new Database(dbPath());

export const db = drizzle(sqlite, { schema });

