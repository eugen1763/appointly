CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_userId_idx` ON `account` (`user_id`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `session_userId_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);--> statement-breakpoint
CREATE TABLE `appointment_managers` (
	`id` text PRIMARY KEY NOT NULL,
	`appointment_id` text NOT NULL,
	`email_normalized` text NOT NULL,
	`user_id` text,
	`role` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "appointment_managers_role_values" CHECK("appointment_managers"."role" IN ('OWNER', 'COORGANIZER'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `appointment_managers_appointment_email_unique` ON `appointment_managers` (`appointment_id`,`email_normalized`);--> statement-breakpoint
CREATE UNIQUE INDEX `appointment_managers_appointment_user_unique` ON `appointment_managers` (`appointment_id`,`user_id`) WHERE "appointment_managers"."user_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `appointment_managers_owner_unique` ON `appointment_managers` (`appointment_id`) WHERE "appointment_managers"."role" = 'OWNER';--> statement-breakpoint
CREATE INDEX `appointment_managers_email_lookup` ON `appointment_managers` (`email_normalized`);--> statement-breakpoint
CREATE INDEX `appointment_managers_user_lookup` ON `appointment_managers` (`user_id`);--> statement-breakpoint
CREATE TABLE `appointment_options` (
	`id` text PRIMARY KEY NOT NULL,
	`appointment_id` text NOT NULL,
	`creator_participant_id` text NOT NULL,
	`start_date` text,
	`end_date` text,
	`start_at` integer,
	`end_at` integer,
	`canonical_key` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`appointment_id`,`creator_participant_id`) REFERENCES `participants`(`appointment_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "appointment_options_shape" CHECK((
        "appointment_options"."start_date" IS NOT NULL
        AND "appointment_options"."end_date" IS NULL
        AND "appointment_options"."start_at" IS NULL
        AND "appointment_options"."end_at" IS NULL
      ) OR (
        "appointment_options"."start_date" IS NOT NULL
        AND "appointment_options"."end_date" IS NOT NULL
        AND "appointment_options"."end_date" >= "appointment_options"."start_date"
        AND "appointment_options"."start_at" IS NULL
        AND "appointment_options"."end_at" IS NULL
      ) OR (
        "appointment_options"."start_date" IS NULL
        AND "appointment_options"."end_date" IS NULL
        AND "appointment_options"."start_at" IS NOT NULL
        AND "appointment_options"."end_at" IS NULL
      ) OR (
        "appointment_options"."start_date" IS NULL
        AND "appointment_options"."end_date" IS NULL
        AND "appointment_options"."start_at" IS NOT NULL
        AND "appointment_options"."end_at" IS NOT NULL
        AND "appointment_options"."end_at" > "appointment_options"."start_at"
      ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `appointment_options_appointment_id_unique` ON `appointment_options` (`appointment_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `appointment_options_appointment_canonical_key_unique` ON `appointment_options` (`appointment_id`,`canonical_key`);--> statement-breakpoint
CREATE INDEX `appointment_options_creator_lookup` ON `appointment_options` (`appointment_id`,`creator_participant_id`);--> statement-breakpoint
CREATE INDEX `appointment_options_order` ON `appointment_options` (`appointment_id`,`start_date`,`start_at`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `appointments` (
	`id` text PRIMARY KEY NOT NULL,
	`public_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`type` text NOT NULL,
	`status` text NOT NULL,
	`option_limit` integer DEFAULT 10 NOT NULL,
	`final_option_id` text,
	`revision` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`final_option_id`) REFERENCES `appointment_options`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "appointments_id_nonempty" CHECK(length("appointments"."id") > 0),
	CONSTRAINT "appointments_public_id_format" CHECK(length("appointments"."public_id") = 24
        AND "appointments"."public_id" NOT GLOB '*[^A-Za-z0-9_-]*'),
	CONSTRAINT "appointments_owner_user_id_nonempty" CHECK(length("appointments"."owner_user_id") > 0),
	CONSTRAINT "appointments_title_length" CHECK(length("appointments"."title") BETWEEN 1 AND 120),
	CONSTRAINT "appointments_description_length" CHECK("appointments"."description" IS NULL OR length("appointments"."description") <= 2000),
	CONSTRAINT "appointments_type_values" CHECK("appointments"."type" IN ('DATE', 'DATE_TIME', 'DATE_RANGE', 'DATE_TIME_RANGE')),
	CONSTRAINT "appointments_status_values" CHECK("appointments"."status" IN ('ACTIVE', 'FINALIZED')),
	CONSTRAINT "appointments_option_limit_bounds" CHECK(typeof("appointments"."option_limit") = 'integer'
        AND "appointments"."option_limit" BETWEEN 1 AND 100),
	CONSTRAINT "appointments_revision_minimum" CHECK(typeof("appointments"."revision") = 'integer' AND "appointments"."revision" >= 1),
	CONSTRAINT "appointments_created_at_integer" CHECK(typeof("appointments"."created_at") = 'integer'),
	CONSTRAINT "appointments_updated_at_integer" CHECK(typeof("appointments"."updated_at") = 'integer'),
	CONSTRAINT "appointments_status_final_option_pair" CHECK((
        "appointments"."status" = 'ACTIVE' AND "appointments"."final_option_id" IS NULL
      ) OR (
        "appointments"."status" = 'FINALIZED' AND "appointments"."final_option_id" IS NOT NULL
      ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `appointments_public_id_unique` ON `appointments` (`public_id`);--> statement-breakpoint
CREATE INDEX `appointments_owner_user_lookup` ON `appointments` (`owner_user_id`);--> statement-breakpoint
CREATE INDEX `appointments_final_option_lookup` ON `appointments` (`final_option_id`);--> statement-breakpoint
CREATE TABLE `guest_session_access` (
	`session_token_hash` blob NOT NULL,
	`participant_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`session_token_hash`, `participant_id`),
	FOREIGN KEY (`session_token_hash`) REFERENCES `guest_sessions`(`token_hash`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`participant_id`) REFERENCES `participants`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "guest_session_access_token_hash_blob_32" CHECK(typeof("guest_session_access"."session_token_hash") = 'blob' AND length("guest_session_access"."session_token_hash") = 32)
);
--> statement-breakpoint
CREATE INDEX `guest_session_access_participant_lookup` ON `guest_session_access` (`participant_id`);--> statement-breakpoint
CREATE TABLE `guest_sessions` (
	`token_hash` blob PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	CONSTRAINT "guest_sessions_token_hash_blob_32" CHECK(typeof("guest_sessions"."token_hash") = 'blob' AND length("guest_sessions"."token_hash") = 32),
	CONSTRAINT "guest_sessions_expiry_order" CHECK("guest_sessions"."expires_at" > "guest_sessions"."created_at")
);
--> statement-breakpoint
CREATE INDEX `guest_sessions_expiry_lookup` ON `guest_sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `participants` (
	`id` text PRIMARY KEY NOT NULL,
	`appointment_id` text NOT NULL,
	`user_id` text,
	`display_name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`edit_token_hash` blob,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "participants_display_name_length" CHECK(length("participants"."display_name") BETWEEN 1 AND 80),
	CONSTRAINT "participants_normalized_name_nonempty" CHECK(length("participants"."normalized_name") > 0),
	CONSTRAINT "participants_edit_token_hash_blob_length" CHECK("participants"."edit_token_hash" IS NULL OR (
        typeof("participants"."edit_token_hash") = 'blob'
        AND length("participants"."edit_token_hash") = 32
      ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `participants_appointment_id_unique` ON `participants` (`appointment_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `participants_appointment_name_unique` ON `participants` (`appointment_id`,`normalized_name`);--> statement-breakpoint
CREATE UNIQUE INDEX `participants_appointment_user_unique` ON `participants` (`appointment_id`,`user_id`) WHERE "participants"."user_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `participants_name_lookup` ON `participants` (`normalized_name`);--> statement-breakpoint
CREATE INDEX `participants_user_lookup` ON `participants` (`user_id`);--> statement-breakpoint
CREATE TABLE `rate_limit_windows` (
	`key` blob PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`window_started_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	CONSTRAINT "rate_limit_windows_key_blob_32" CHECK(typeof("rate_limit_windows"."key") = 'blob' AND length("rate_limit_windows"."key") = 32),
	CONSTRAINT "rate_limit_windows_count_nonnegative" CHECK("rate_limit_windows"."count" >= 0),
	CONSTRAINT "rate_limit_windows_expiry_order" CHECK("rate_limit_windows"."expires_at" > "rate_limit_windows"."window_started_at")
);
--> statement-breakpoint
CREATE INDEX `rate_limit_windows_expiry_lookup` ON `rate_limit_windows` (`expires_at`);--> statement-breakpoint
CREATE TABLE `responses` (
	`appointment_id` text NOT NULL,
	`participant_id` text NOT NULL,
	`option_id` text NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`appointment_id`, `participant_id`, `option_id`),
	FOREIGN KEY (`appointment_id`,`participant_id`) REFERENCES `participants`(`appointment_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`appointment_id`,`option_id`) REFERENCES `appointment_options`(`appointment_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "responses_value_values" CHECK("responses"."value" IN ('YES', 'NO'))
);
--> statement-breakpoint
CREATE INDEX `responses_option_lookup` ON `responses` (`appointment_id`,`option_id`);--> statement-breakpoint
CREATE INDEX `responses_participant_lookup` ON `responses` (`appointment_id`,`participant_id`);