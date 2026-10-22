CREATE TABLE `cart_items` (
	`cart_id` integer NOT NULL,
	`product_slug` text NOT NULL,
	`quantity` integer NOT NULL,
	`added_at` integer DEFAULT (unixepoch()) NOT NULL,
	PRIMARY KEY(`cart_id`, `product_slug`),
	FOREIGN KEY (`cart_id`) REFERENCES `carts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "cart_items_quantity_range" CHECK("quantity" BETWEEN 1 AND 10)
);
--> statement-breakpoint
CREATE TABLE `carts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`customer_id` integer,
	`guest_token_hash` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "carts_exactly_one_owner" CHECK(("carts"."customer_id" IS NULL) <> ("carts"."guest_token_hash" IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `carts_customer_id_unique` ON `carts` (`customer_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `carts_guest_token_hash_unique` ON `carts` (`guest_token_hash`);