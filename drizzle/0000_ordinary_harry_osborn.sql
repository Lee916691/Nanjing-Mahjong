CREATE TABLE `cloud_commands` (
	`session` text NOT NULL,
	`id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`body` text NOT NULL,
	`room_id` text NOT NULL,
	`created` integer NOT NULL,
	PRIMARY KEY(`session`, `id`)
);
--> statement-breakpoint
CREATE TABLE `cloud_rooms` (
	`id` text PRIMARY KEY NOT NULL,
	`body` text NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`operation` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `cloud_sessions` (
	`token` text PRIMARY KEY NOT NULL,
	`created` integer NOT NULL,
	`room_id` text,
	`peer` text,
	`last_seen` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `cloud_sessions_room` ON `cloud_sessions` (`room_id`);