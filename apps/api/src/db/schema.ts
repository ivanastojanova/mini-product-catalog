import { sql } from "drizzle-orm";
import {
  check,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

/** Per-line cart cap — enforced in the API and by a CHECK constraint. Lives here (not a separate config file) because drizzle-kit loads this file through its own CJS loader, which can't resolve our `.js`-suffixed relative imports. */
export const MAX_LINE_QUANTITY = 10;

/** A registered shopper. Lives entirely in apps/api — Payload's Users collection (apps/cms) is unrelated (admin-only). */
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

/**
 * A shopping cart owned by exactly one of: a customer (`customerId`) or an
 * anonymous browser (`guestTokenHash`, SHA-256 of the `cart_token` cookie).
 * Login merges the guest cart into the customer's and deletes it.
 */
export const carts = sqliteTable(
  "carts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    customerId: integer("customer_id")
      .unique()
      .references(() => customers.id, { onDelete: "cascade" }),
    guestTokenHash: text("guest_token_hash").unique(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    // Bumped on every write; guest carts expire 30 days after this.
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    check(
      "carts_exactly_one_owner",
      sql`(${table.customerId} IS NULL) <> (${table.guestTokenHash} IS NULL)`,
    ),
  ],
);

/** One line per (cart, product). Slug + quantity only — prices are looked up from the CMS, not stored here. */
export const cartItems = sqliteTable(
  "cart_items",
  {
    cartId: integer("cart_id")
      .notNull()
      .references(() => carts.id, { onDelete: "cascade" }),
    productSlug: text("product_slug").notNull(),
    quantity: integer("quantity").notNull(),
    addedAt: integer("added_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    primaryKey({ columns: [table.cartId, table.productSlug] }),
    check(
      "cart_items_quantity_range",
      sql.raw(`"quantity" BETWEEN 1 AND ${MAX_LINE_QUANTITY}`),
    ),
  ],
);
