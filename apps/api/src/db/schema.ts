import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
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

/** Order statuses allowed by the CHECK constraint. Duplicated from `orders/lib/orderStateMachine.ts` for the same drizzle-kit import reason as above; `schema.test.ts` fails if the two lists diverge. */
export const ORDER_STATUS_VALUES = [
  "pending_payment",
  "paid",
  "fulfilled",
  "cancelled",
  "expired",
] as const;

const statusList = ORDER_STATUS_VALUES.map((status) => `'${status}'`).join(", ");

/**
 * Sellable stock per product slug. available = on_hand - reserved. The CHECKs
 * make overselling impossible even if application code is wrong.
 */
export const inventory = sqliteTable(
  "inventory",
  {
    productSlug: text("product_slug").primaryKey(),
    onHand: integer("on_hand").notNull(),
    reserved: integer("reserved").notNull().default(0),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    check("inventory_on_hand_non_negative", sql`${table.onHand} >= 0`),
    check("inventory_reserved_non_negative", sql`${table.reserved} >= 0`),
    check("inventory_reserved_within_on_hand", sql`${table.reserved} <= ${table.onHand}`),
  ],
);

/**
 * A placed order. Owned by exactly one of a customer or a guest browser
 * (`guestTokenHash`, SHA-256 of the `order_token` cookie). `publicId` is only a
 * lookup key in URLs, never a credential. Price and address are snapshots.
 * `status` is written only by `applyTransition`.
 */
export const orders = sqliteTable(
  "orders",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    publicId: text("public_id").notNull().unique(),
    // No cascade: deleting a customer must not silently delete order history.
    customerId: integer("customer_id").references(() => customers.id),
    guestTokenHash: text("guest_token_hash"),
    contactEmail: text("contact_email").notNull(),
    status: text("status").notNull().default("pending_payment"),
    currency: text("currency").notNull(),
    totalCents: integer("total_cents").notNull(),
    shipName: text("ship_name").notNull(),
    shipLine1: text("ship_line1").notNull(),
    shipLine2: text("ship_line2"),
    shipCity: text("ship_city").notNull(),
    shipPostalCode: text("ship_postal_code").notNull(),
    shipCountry: text("ship_country").notNull(),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    reservationExpiresAt: integer("reservation_expires_at", { mode: "timestamp" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    paidAt: integer("paid_at", { mode: "timestamp" }),
  },
  (table) => [
    check("orders_exactly_one_owner", sql`(${table.customerId} IS NULL) <> (${table.guestTokenHash} IS NULL)`),
    check("orders_status_valid", sql.raw(`"status" IN (${statusList})`)),
    check("orders_total_non_negative", sql`${table.totalCents} >= 0`),
    index("orders_customer_id_idx").on(table.customerId),
    index("orders_guest_token_hash_idx").on(table.guestTokenHash),
    // Serves the lazy expiry sweep: pending orders past their deadline.
    index("orders_status_expiry_idx").on(table.status, table.reservationExpiresAt),
  ],
);

/** Order lines. The price snapshot lives here; the quantities are also what a reservation holds. */
export const orderItems = sqliteTable(
  "order_items",
  {
    orderId: integer("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    productSlug: text("product_slug").notNull(),
    title: text("title").notNull(),
    unitPriceCents: integer("unit_price_cents").notNull(),
    quantity: integer("quantity").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.orderId, table.productSlug] }),
    check("order_items_unit_price_non_negative", sql`${table.unitPriceCents} >= 0`),
    check(
      "order_items_quantity_range",
      sql.raw(`"quantity" BETWEEN 1 AND ${MAX_LINE_QUANTITY}`),
    ),
  ],
);

/** Append-only audit trail: one row at creation (`fromStatus` null) and one per transition. */
export const orderEvents = sqliteTable(
  "order_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    orderId: integer("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    fromStatus: text("from_status"),
    toStatus: text("to_status").notNull(),
    reason: text("reason"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    check(
      "order_events_from_status_valid",
      sql.raw(`"from_status" IS NULL OR "from_status" IN (${statusList})`),
    ),
    check("order_events_to_status_valid", sql.raw(`"to_status" IN (${statusList})`)),
    index("order_events_order_id_idx").on(table.orderId),
  ],
);

/** Payment attempt statuses allowed by the CHECK constraint. `refund_pending` means money was taken that must go back (late, duplicate or mismatched payment) and the refund call has not succeeded yet. */
export const PAYMENT_STATUS_VALUES = [
  "pending",
  "succeeded",
  "failed",
  "refund_pending",
  "refunded",
] as const;

/** What happened to a received gateway event. `duplicate` is never stored on its own row (the PK conflict is the duplicate); it exists for logs and responses. */
export const PAYMENT_EVENT_OUTCOME_VALUES = [
  "applied",
  "duplicate",
  "ignored",
  "refund_requested",
] as const;

const paymentStatusList = PAYMENT_STATUS_VALUES.map((status) => `'${status}'`).join(", ");
const paymentOutcomeList = PAYMENT_EVENT_OUTCOME_VALUES.map((outcome) => `'${outcome}'`).join(", ");

/**
 * One row per payment attempt on an order. Amount and currency are copied from
 * the order when the attempt starts, so what the gateway was asked to charge
 * can be compared with what an event reports. No cascade: payment records are
 * financial history and must outlive any cleanup of orders.
 */
export const payments = sqliteTable(
  "payments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    orderId: integer("order_id")
      .notNull()
      .references(() => orders.id),
    // Null only between inserting the row and the gateway answering; unique once set.
    gatewayIntentId: text("gateway_intent_id").unique(),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull(),
    status: text("status").notNull().default("pending"),
    refundId: text("refund_id"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    check("payments_amount_positive", sql`${table.amountCents} > 0`),
    check("payments_status_valid", sql.raw(`"status" IN (${paymentStatusList})`)),
    index("payments_order_id_idx").on(table.orderId),
    // An order has at most one attempt in flight, so a double click can't start two.
    uniqueIndex("payments_one_pending_per_order")
      .on(table.orderId)
      .where(sql`${table.status} = 'pending'`),
  ],
);

/**
 * Every gateway event ever received, keyed by the gateway's event id. The
 * primary key IS the idempotency guarantee: inserting an id that exists fails,
 * and that failure is how a redelivered event is recognised.
 */
export const paymentEvents = sqliteTable(
  "payment_events",
  {
    gatewayEventId: text("gateway_event_id").primaryKey(),
    type: text("type").notNull(),
    payload: text("payload").notNull(),
    outcome: text("outcome").notNull(),
    receivedAt: integer("received_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  () => [
    check("payment_events_outcome_valid", sql.raw(`"outcome" IN (${paymentOutcomeList})`)),
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
