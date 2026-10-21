import { defineConfig } from "drizzle-kit";

/** Drizzle Kit config for apps/api's commerce DB (separate from Payload's SQLite file in apps/cms). */
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dialect: "sqlite",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "file:./commerce.db",
  },
});
