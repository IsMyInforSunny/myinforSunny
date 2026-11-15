ALTER TABLE `request_budget` ADD `group_id` text;
--> statement-breakpoint
CREATE INDEX `request_budget_actor_group_time` ON `request_budget` (`actor`,`group_id`,`created_at`);
