CREATE TABLE `firecrawl_credit_budget` (
	`id` text PRIMARY KEY NOT NULL,
	`month` text NOT NULL,
	`operation` text NOT NULL,
	`credits` integer NOT NULL,
	`created_at` integer NOT NULL
);
