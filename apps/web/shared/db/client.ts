import "server-only";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

/**
 * Singleton Drizzle client for apps/web's own commerce DB (`web.db`) — a
 * separate SQLite file from apps/cms's `payload.db`, per
 * docs/adr/0001-monorepo-content-commerce-split.md.
 *
 * Cached on `globalThis` so Next.js dev's module-reload-on-every-request
 * doesn't open a fresh `better-sqlite3` connection each time.
 *
 * Server-only: never import this from a client component.
 */
const globalForDb = globalThis as unknown as {
  sqlite?: Database.Database;
};

/** better-sqlite3 wants a plain filesystem path — strip the `file:` prefix used by DATABASE_URL / drizzle-kit. */
function dbPath(): string {
  const url = process.env.DATABASE_URL ?? "file:./web.db";
  return url.replace(/^file:/, "");
}

const sqlite = globalForDb.sqlite ?? new Database(dbPath());

if (process.env.NODE_ENV !== "production") {
  globalForDb.sqlite = sqlite;
}

export const db = drizzle(sqlite, { schema });
