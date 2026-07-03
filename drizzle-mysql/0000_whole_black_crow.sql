CREATE TABLE `organizations` (
	`id` char(36) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`deleted_at` datetime(3),
	`created_by` char(36),
	`updated_by` char(36),
	`legal_name` varchar(512) NOT NULL,
	`display_name` varchar(512) NOT NULL,
	`gstin` varchar(32),
	`pan` varchar(16),
	`tan` varchar(16),
	`udyam` varchar(32),
	`registered_address` text,
	`secondary_address` text,
	CONSTRAINT `organizations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` char(36) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`deleted_at` datetime(3),
	`role` enum('partner','admin','manager','accountant','employee','viewer') NOT NULL DEFAULT 'employee',
	`full_name` varchar(256) NOT NULL,
	`email` varchar(320) NOT NULL,
	`masked_pan` varchar(32),
	`masked_aadhaar` varchar(32),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_email_unique` UNIQUE(`email`)
);
--> statement-breakpoint
CREATE INDEX `users_email_idx` ON `users` (`email`);--> statement-breakpoint
CREATE INDEX `users_role_idx` ON `users` (`role`);