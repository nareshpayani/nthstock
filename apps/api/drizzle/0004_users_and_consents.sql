CREATE TABLE "consents" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"purpose" text NOT NULL,
	"policy_version" text NOT NULL,
	"granted_at" timestamp (3) with time zone NOT NULL,
	"withdrawn_at" timestamp (3) with time zone,
	CONSTRAINT "consents_purpose_check" CHECK ("consents"."purpose" IN ('TERMS_AND_PRIVACY'))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"mobile_enc" "bytea",
	"mobile_hash" "bytea",
	"mobile_last4" char(4),
	"name_enc" "bytea",
	"email_enc" "bytea",
	"kyc_status" text DEFAULT 'NOT_STARTED' NOT NULL,
	"pin_set" boolean DEFAULT false NOT NULL,
	"totp_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	"deleted_at" timestamp (3) with time zone,
	"purge_after" timestamp (3) with time zone,
	"purged_at" timestamp (3) with time zone,
	CONSTRAINT "users_kyc_status_check" CHECK ("users"."kyc_status" IN ('NOT_STARTED', 'PENDING', 'VERIFIED')),
	CONSTRAINT "users_mobile_check" CHECK ("users"."purged_at" IS NOT NULL OR ("users"."mobile_enc" IS NOT NULL AND "users"."mobile_hash" IS NOT NULL AND "users"."mobile_last4" IS NOT NULL)),
	CONSTRAINT "users_mobile_last4_check" CHECK ("users"."mobile_last4" ~ '^[0-9]{4}$'),
	CONSTRAINT "users_mobile_hash_check" CHECK (octet_length("users"."mobile_hash") = 32)
);
--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "consents_user_id_purpose_idx" ON "consents" USING btree ("user_id","purpose");--> statement-breakpoint
CREATE UNIQUE INDEX "users_mobile_hash_live_idx" ON "users" USING btree ("mobile_hash") WHERE "users"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "users_purge_after_idx" ON "users" USING btree ("purge_after") WHERE "users"."purged_at" IS NULL;