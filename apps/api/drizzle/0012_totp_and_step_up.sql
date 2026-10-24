CREATE TABLE "totp_factors" (
	"user_id" text PRIMARY KEY NOT NULL,
	"secret_enc" "bytea" NOT NULL,
	"status" text NOT NULL,
	"last_used_step" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"confirmed_at" timestamp (3) with time zone,
	CONSTRAINT "totp_factors_status_check" CHECK ("totp_factors"."status" IN ('PENDING', 'ACTIVE')),
	CONSTRAINT "totp_factors_confirmed_check" CHECK (("totp_factors"."status" = 'ACTIVE') = ("totp_factors"."confirmed_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "totp_recovery_codes" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"hash" text NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_log" DROP CONSTRAINT "audit_log_action_check";--> statement-breakpoint
ALTER TABLE "totp_factors" ADD CONSTRAINT "totp_factors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "totp_recovery_codes" ADD CONSTRAINT "totp_recovery_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "totp_recovery_codes_user_id_idx" ON "totp_recovery_codes" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_action_check" CHECK ("audit_log"."action" IN ('ORDER_PLACE', 'ORDER_MODIFY', 'ORDER_CANCEL', 'ORDER_UPDATE', 'FUNDS_MOVEMENT', 'FUNDS_RESET', 'LOGIN_SUCCESS', 'LOGIN_FAILED', 'PIN_SET', 'PIN_LOCKED', 'LOGOUT', 'REFRESH_REUSE_DETECTED', 'SESSION_REVOKED', 'STEP_UP', 'TOTP_ENABLED', 'TOTP_DISABLED', 'RECOVERY_CODE_USED', 'RECOVERY_CODES_REGENERATED'));