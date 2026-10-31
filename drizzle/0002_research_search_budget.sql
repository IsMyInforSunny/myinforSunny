CREATE TABLE `research_search_budget` (
	`id` text PRIMARY KEY NOT NULL,
	`actor` text NOT NULL,
	`day` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `research_search_actor_time` ON `research_search_budget` (`actor`,`created_at`);--> statement-breakpoint
CREATE INDEX `research_search_day` ON `research_search_budget` (`day`);