CREATE TABLE `inventory` (
	`product_slug` text PRIMARY KEY NOT NULL,
	`on_hand` integer NOT NULL,
	`reserved` integer DEFAULT 0 NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT "inventory_on_hand_non_negative" CHECK("inventory"."on_hand" >= 0),
	CONSTRAINT "inventory_reserved_non_negative" CHECK("inventory"."reserved" >= 0),
	CONSTRAINT "inventory_reserved_within_on_hand" CHECK("inventory"."reserved" <= "inventory"."on_hand")
);
--> statement-breakpoint
CREATE TABLE `order_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`order_id` integer NOT NULL,
	`from_status` text,
	`to_status` text NOT NULL,
	`reason` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "order_events_from_status_valid" CHECK("from_status" IS NULL OR "from_status" IN ('pending_payment', 'paid', 'fulfilled', 'cancelled', 'expired')),
	CONSTRAINT "order_events_to_status_valid" CHECK("to_status" IN ('pending_payment', 'paid', 'fulfilled', 'cancelled', 'expired'))
);
--> statement-breakpoint
CREATE INDEX `order_events_order_id_idx` ON `order_events` (`order_id`);--> statement-breakpoint
CREATE TABLE `order_items` (
	`order_id` integer NOT NULL,
	`product_slug` text NOT NULL,
	`title` text NOT NULL,
	`unit_price_cents` integer NOT NULL,
	`quantity` integer NOT NULL,
	PRIMARY KEY(`order_id`, `product_slug`),
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "order_items_unit_price_non_negative" CHECK("order_items"."unit_price_cents" >= 0),
	CONSTRAINT "order_items_quantity_range" CHECK("quantity" BETWEEN 1 AND 10)
);
--> statement-breakpoint
CREATE TABLE `orders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`public_id` text NOT NULL,
	`customer_id` integer,
	`guest_token_hash` text,
	`contact_email` text NOT NULL,
	`status` text DEFAULT 'pending_payment' NOT NULL,
	`currency` text NOT NULL,
	`total_cents` integer NOT NULL,
	`ship_name` text NOT NULL,
	`ship_line1` text NOT NULL,
	`ship_line2` text,
	`ship_city` text NOT NULL,
	`ship_postal_code` text NOT NULL,
	`ship_country` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`reservation_expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	`paid_at` integer,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "orders_exactly_one_owner" CHECK(("orders"."customer_id" IS NULL) <> ("orders"."guest_token_hash" IS NULL)),
	CONSTRAINT "orders_status_valid" CHECK("status" IN ('pending_payment', 'paid', 'fulfilled', 'cancelled', 'expired')),
	CONSTRAINT "orders_total_non_negative" CHECK("orders"."total_cents" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orders_public_id_unique` ON `orders` (`public_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `orders_idempotency_key_unique` ON `orders` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `orders_customer_id_idx` ON `orders` (`customer_id`);--> statement-breakpoint
CREATE INDEX `orders_guest_token_hash_idx` ON `orders` (`guest_token_hash`);--> statement-breakpoint
CREATE INDEX `orders_status_expiry_idx` ON `orders` (`status`,`reservation_expires_at`);