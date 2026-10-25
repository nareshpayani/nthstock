CREATE TABLE "trailing_stops" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token" integer NOT NULL,
	"symbol" text NOT NULL,
	"exchange" text NOT NULL,
	"product" text NOT NULL,
	"direction" text NOT NULL,
	"trail_unit" text NOT NULL,
	"trail_amount" bigint,
	"trail_basis_points" integer,
	"activation_price" bigint,
	"exit_order_type" text NOT NULL,
	"exit_limit_offset" bigint,
	"status" text NOT NULL,
	"status_reason" text,
	"watermark_price" bigint,
	"stop_price" bigint,
	"protected_qty" integer NOT NULL,
	"entry_order_id" text,
	"exit_order_id" text,
	"client_request_id" text,
	"seq" bigint NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "trailing_stops_status_check" CHECK ("trailing_stops"."status" IN ('PENDING_ENTRY', 'ARMED', 'TRAILING', 'TRIGGERED', 'EXECUTED', 'CANCELLED', 'REJECTED')),
	CONSTRAINT "trailing_stops_product_check" CHECK ("trailing_stops"."product" IN ('INTRADAY', 'DELIVERY')),
	CONSTRAINT "trailing_stops_exchange_check" CHECK ("trailing_stops"."exchange" IN ('NSE', 'BSE')),
	CONSTRAINT "trailing_stops_direction_check" CHECK ("trailing_stops"."direction" IN ('LONG', 'SHORT')),
	CONSTRAINT "trailing_stops_trail_check" CHECK (("trailing_stops"."trail_unit" = 'AMOUNT' AND "trailing_stops"."trail_amount" > 0 AND "trailing_stops"."trail_basis_points" IS NULL) OR ("trailing_stops"."trail_unit" = 'PERCENT' AND "trailing_stops"."trail_basis_points" > 0 AND "trailing_stops"."trail_amount" IS NULL)),
	CONSTRAINT "trailing_stops_exit_check" CHECK ("trailing_stops"."exit_order_type" IN ('MARKET', 'LIMIT')),
	CONSTRAINT "trailing_stops_qty_check" CHECK ("trailing_stops"."protected_qty" >= 0),
	CONSTRAINT "trailing_stops_prices_check" CHECK (("trailing_stops"."activation_price" IS NULL OR "trailing_stops"."activation_price" > 0) AND ("trailing_stops"."stop_price" IS NULL OR "trailing_stops"."stop_price" > 0) AND ("trailing_stops"."watermark_price" IS NULL OR "trailing_stops"."watermark_price" >= 0) AND ("trailing_stops"."exit_limit_offset" IS NULL OR "trailing_stops"."exit_limit_offset" >= 0)),
	CONSTRAINT "trailing_stops_seq_check" CHECK ("trailing_stops"."seq" >= 0)
);
--> statement-breakpoint
ALTER TABLE "audit_log" DROP CONSTRAINT "audit_log_action_check";--> statement-breakpoint
ALTER TABLE "paper_accounts" ADD COLUMN "seq" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "paper_accounts" ADD COLUMN "exit_order_ids" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "trailing_stops" ADD CONSTRAINT "trailing_stops_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trailing_stops_user_id_updated_at_idx" ON "trailing_stops" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "trailing_stops_active_user_id_idx" ON "trailing_stops" USING btree ("user_id") WHERE "trailing_stops"."status" IN ('PENDING_ENTRY', 'ARMED', 'TRAILING', 'TRIGGERED');--> statement-breakpoint
CREATE UNIQUE INDEX "trailing_stops_user_id_client_request_id_key" ON "trailing_stops" USING btree ("user_id","client_request_id");--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_action_check" CHECK ("audit_log"."action" IN ('ORDER_PLACE', 'ORDER_MODIFY', 'ORDER_CANCEL', 'ORDER_UPDATE', 'FUNDS_MOVEMENT', 'FUNDS_RESET', 'LOGIN_SUCCESS', 'LOGIN_FAILED', 'PIN_SET', 'PIN_LOCKED', 'LOGOUT', 'REFRESH_REUSE_DETECTED', 'SESSION_REVOKED', 'STEP_UP', 'TOTP_ENABLED', 'TOTP_DISABLED', 'RECOVERY_CODE_USED', 'RECOVERY_CODES_REGENERATED', 'CONSENT_GRANTED', 'ACCOUNT_DELETION_REQUESTED', 'TRAILING_STOP_PLACE', 'TRAILING_STOP_MODIFY', 'TRAILING_STOP_CANCEL', 'TRAILING_STOP_UPDATE', 'POSITION_CLOSE'));--> statement-breakpoint
ALTER TABLE "paper_accounts" ADD CONSTRAINT "paper_accounts_seq_check" CHECK ("paper_accounts"."seq" >= 0);