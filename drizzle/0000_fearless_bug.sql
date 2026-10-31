CREATE TABLE `request_budget` (
	`id` text PRIMARY KEY NOT NULL,
	`actor` text NOT NULL,
	`day` text NOT NULL,
	`created_at` integer NOT NULL,
	`reserved` integer NOT NULL,
	`consumed` integer,
	`active` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `request_budget_actor_time` ON `request_budget` (`actor`,`created_at`);--> statement-breakpoint
CREATE INDEX `request_budget_day` ON `request_budget` (`day`);