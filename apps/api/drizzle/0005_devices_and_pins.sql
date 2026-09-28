CREATE TABLE "device_tokens" (
	"token_hash" "bytea" PRIMARY KEY NOT NULL,
	"device_id" text NOT NULL,
	"expires_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "device_tokens_device_id_unique" UNIQUE("device_id"),
	CONSTRAINT "device_tokens_token_hash_check" CHECK (octet_length("device_tokens"."token_hash") = 32)
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"label" text NOT NULL,
	"trusted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"last_seen_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pins" (
	"user_id" text PRIMARY KEY NOT NULL,
	"hash" text NOT NULL,
	"failures" smallint DEFAULT 0 NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "pins_failures_check" CHECK ("pins"."failures" >= 0)
);
--> statement-breakpoint
ALTER TABLE "device_tokens" ADD CONSTRAINT "device_tokens_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pins" ADD CONSTRAINT "pins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "device_tokens_expires_at_idx" ON "device_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "devices_user_id_idx" ON "devices" USING btree ("user_id");