import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** A registered shopper. Lives entirely in apps/web — Payload's Users collection is unrelated (admin-only). */
export const customers = sqliteTable("customers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/**
 * A logged-in browser. The `id` here is never the raw cookie value — it's a
 * SHA-256 hash of it, so a DB leak alone can't be replayed as a valid session.
 */
export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(), // hash of the random token stored in the cookie
  customerId: integer("customer_id")
    .notNull()
    .references(() => customers.id, { onDelete: "cascade" }),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  // Captured at login for a future "active sessions / log out other devices" UI.
  userAgent: text("user_agent"),
  ipAddress: text("ip_address"),
});
