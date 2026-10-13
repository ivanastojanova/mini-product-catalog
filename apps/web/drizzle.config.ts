import { defineConfig } from "drizzle-kit";

/** Drizzle Kit config for apps/web's own commerce DB (separate from Payload's SQLite file in apps/cms). */
export default defineConfig({
  schema: "./shared/db/schema.ts",
  out: "./shared/db/migrations",
  dialect: "sqlite",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "file:./web.db",
  },
});
