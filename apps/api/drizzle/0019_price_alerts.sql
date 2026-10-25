CREATE TABLE "price_alerts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token" integer NOT NULL,
	"symbol" text NOT NULL,
	"exchange" text NOT NULL,
	"condition" text NOT NULL,
	"price" bigint NOT NULL,
	"note" text,
	"status" text NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"created_ltp" bigint NOT NULL,
	"triggered_at" timestamp (3) with time zone,
	"triggered_ltp" bigint,
	CONSTRAINT "price_alerts_condition_check" CHECK ("price_alerts"."condition" IN ('ABOVE', 'BELOW')),
	CONSTRAINT "price_alerts_status_check" CHECK ("price_alerts"."status" IN ('ACTIVE', 'TRIGGERED', 'CANCELLED')),
	CONSTRAINT "price_alerts_exchange_check" CHECK ("price_alerts"."exchange" IN ('NSE', 'BSE')),
	CONSTRAINT "price_alerts_price_check" CHECK ("price_alerts"."price" > 0 AND "price_alerts"."created_ltp" >= 0)
);
--> statement-breakpoint
ALTER TABLE "price_alerts" ADD CONSTRAINT "price_alerts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "price_alerts_user_id_created_at_idx" ON "price_alerts" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "price_alerts_active_token_idx" ON "price_alerts" USING btree ("token") WHERE "price_alerts"."status" = 'ACTIVE';