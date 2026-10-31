CREATE TABLE `payment_events` (
	`gateway_event_id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`outcome` text NOT NULL,
	`received_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT "payment_events_outcome_valid" CHECK("outcome" IN ('applied', 'duplicate', 'ignored', 'refund_requested'))
);
--> statement-breakpoint
CREATE TABLE `payments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`order_id` integer NOT NULL,
	`gateway_intent_id` text,
	`amount_cents` integer NOT NULL,
	`currency` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`refund_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "payments_amount_positive" CHECK("payments"."amount_cents" > 0),
	CONSTRAINT "payments_status_valid" CHECK("status" IN ('pending', 'succeeded', 'failed', 'refund_pending', 'refunded'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payments_gateway_intent_id_unique` ON `payments` (`gateway_intent_id`);--> statement-breakpoint
CREATE INDEX `payments_order_id_idx` ON `payments` (`order_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `payments_one_pending_per_order` ON `payments` (`order_id`) WHERE "payments"."status" = 'pending';