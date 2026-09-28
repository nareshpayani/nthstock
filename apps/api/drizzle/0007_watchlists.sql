CREATE TABLE "watchlist_items" (
	"watchlist_id" text NOT NULL,
	"token" integer NOT NULL,
	"symbol" text NOT NULL,
	"exchange" text NOT NULL,
	"name" text NOT NULL,
	"position" smallint NOT NULL,
	"added_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "watchlist_items_pkey" PRIMARY KEY("watchlist_id","token"),
	CONSTRAINT "watchlist_items_exchange_check" CHECK ("watchlist_items"."exchange" IN ('NSE', 'BSE')),
	CONSTRAINT "watchlist_items_position_check" CHECK ("watchlist_items"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "watchlists" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"position" smallint NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "watchlists_position_check" CHECK ("watchlists"."position" >= 0)
);
--> statement-breakpoint
ALTER TABLE "watchlist_items" ADD CONSTRAINT "watchlist_items_watchlist_id_watchlists_id_fk" FOREIGN KEY ("watchlist_id") REFERENCES "public"."watchlists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlists" ADD CONSTRAINT "watchlists_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "watchlists_user_id_name_idx" ON "watchlists" USING btree ("user_id",lower("name"));