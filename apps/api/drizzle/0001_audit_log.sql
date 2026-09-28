CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"actor_type" text NOT NULL,
	"actor_user_id" text,
	"user_id" text,
	"action" text NOT NULL,
	"order_id" text,
	"outcome" text NOT NULL,
	"request_id" text,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "audit_log_action_check" CHECK ("audit_log"."action" IN ('ORDER_PLACE', 'ORDER_MODIFY', 'ORDER_CANCEL', 'ORDER_UPDATE', 'FUNDS_MOVEMENT', 'FUNDS_RESET')),
	CONSTRAINT "audit_log_outcome_check" CHECK ("audit_log"."outcome" IN ('OK', 'REFUSED')),
	CONSTRAINT "audit_log_actor_check" CHECK (("audit_log"."actor_type" = 'user' AND "audit_log"."actor_user_id" IS NOT NULL) OR ("audit_log"."actor_type" = 'system' AND "audit_log"."actor_user_id" IS NULL)),
	CONSTRAINT "audit_log_detail_check" CHECK (jsonb_typeof("audit_log"."detail") = 'object')
);
--> statement-breakpoint
CREATE INDEX "audit_log_user_id_at_idx" ON "audit_log" USING btree ("user_id","at");--> statement-breakpoint
CREATE INDEX "audit_log_action_at_idx" ON "audit_log" USING btree ("action","at");