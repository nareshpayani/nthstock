CREATE TABLE "notification_outbox" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"notification_id" bigint NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"ref_id" text,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"symbol" text,
	"exchange" text,
	"created_at" timestamp (3) with time zone NOT NULL,
	"read_at" timestamp (3) with time zone,
	CONSTRAINT "notifications_kind_check" CHECK ("notifications"."kind" IN ('PRICE_ALERT', 'ORDER_FILLED', 'TRAILING_STOP', 'ORDER_REJECTED', 'AMO_RELEASED', 'SQUARED_OFF', 'SECURITY')),
	CONSTRAINT "notifications_exchange_check" CHECK ("notifications"."exchange" IS NULL OR "notifications"."exchange" IN ('NSE', 'BSE'))
);
--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_outbox_created_at_idx" ON "notification_outbox" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "notification_outbox_notification_id_idx" ON "notification_outbox" USING btree ("notification_id");--> statement-breakpoint
CREATE INDEX "notification_outbox_user_id_idx" ON "notification_outbox" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "notifications_user_id_id_idx" ON "notifications" USING btree ("user_id","id" DESC NULLS LAST);