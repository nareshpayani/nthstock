CREATE TABLE "holding_sales" (
	"user_id" text NOT NULL,
	"trade_date" date NOT NULL,
	"token" integer NOT NULL,
	"qty" integer NOT NULL,
	"proceeds" bigint NOT NULL,
	"realised_pnl" bigint NOT NULL,
	CONSTRAINT "holding_sales_pkey" PRIMARY KEY("user_id","trade_date","token"),
	CONSTRAINT "holding_sales_qty_check" CHECK ("holding_sales"."qty" > 0)
);
--> statement-breakpoint
CREATE TABLE "holdings" (
	"user_id" text NOT NULL,
	"token" integer NOT NULL,
	"qty" integer NOT NULL,
	"invested_value" bigint NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "holdings_pkey" PRIMARY KEY("user_id","token"),
	CONSTRAINT "holdings_qty_check" CHECK ("holdings"."qty" > 0),
	CONSTRAINT "holdings_invested_value_check" CHECK ("holdings"."invested_value" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"seq" bigint NOT NULL,
	"type" text NOT NULL,
	"amount" bigint NOT NULL,
	"balance_after" bigint NOT NULL,
	"order_id" text,
	"description" text NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "ledger_entries_seq_check" CHECK ("ledger_entries"."seq" >= 1),
	CONSTRAINT "ledger_entries_type_check" CHECK ("ledger_entries"."type" IN ('OPENING_CREDIT', 'ORDER_BLOCK', 'ORDER_RELEASE', 'TRADE_DEBIT', 'TRADE_CREDIT', 'RESET'))
);
--> statement-breakpoint
CREATE TABLE "paper_accounts" (
	"user_id" text PRIMARY KEY NOT NULL,
	"opening_balance" bigint NOT NULL,
	"version" bigint DEFAULT 0 NOT NULL,
	"synced_to" timestamp (3) with time zone NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "paper_accounts_opening_balance_check" CHECK ("paper_accounts"."opening_balance" >= 0),
	CONSTRAINT "paper_accounts_version_check" CHECK ("paper_accounts"."version" >= 0)
);
--> statement-breakpoint
CREATE TABLE "pnl_snapshots" (
	"user_id" text NOT NULL,
	"trade_date" date NOT NULL,
	"invested" bigint NOT NULL,
	"current_value" bigint NOT NULL,
	"day_pnl" bigint NOT NULL,
	"realised_pnl" bigint NOT NULL,
	"total_pnl" bigint NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "pnl_snapshots_pkey" PRIMARY KEY("user_id","trade_date")
);
--> statement-breakpoint
CREATE TABLE "positions" (
	"user_id" text NOT NULL,
	"trade_date" date NOT NULL,
	"token" integer NOT NULL,
	"product" text NOT NULL,
	"symbol" text NOT NULL,
	"exchange" text NOT NULL,
	"net_qty" integer NOT NULL,
	"open_cost" bigint NOT NULL,
	"buy_qty" integer NOT NULL,
	"sell_qty" integer NOT NULL,
	"buy_value" bigint NOT NULL,
	"sell_value" bigint NOT NULL,
	"realised_pnl" bigint NOT NULL,
	CONSTRAINT "positions_pkey" PRIMARY KEY("user_id","trade_date","token","product"),
	CONSTRAINT "positions_product_check" CHECK ("positions"."product" IN ('INTRADAY', 'DELIVERY')),
	CONSTRAINT "positions_exchange_check" CHECK ("positions"."exchange" IN ('NSE', 'BSE')),
	CONSTRAINT "positions_qty_check" CHECK ("positions"."buy_qty" >= 0 AND "positions"."sell_qty" >= 0)
);
--> statement-breakpoint
ALTER TABLE "holding_sales" ADD CONSTRAINT "holding_sales_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holdings" ADD CONSTRAINT "holdings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_accounts" ADD CONSTRAINT "paper_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pnl_snapshots" ADD CONSTRAINT "pnl_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_entries_user_id_seq_key" ON "ledger_entries" USING btree ("user_id","seq");--> statement-breakpoint
CREATE INDEX "ledger_entries_user_id_seq_desc_idx" ON "ledger_entries" USING btree ("user_id","seq" DESC);