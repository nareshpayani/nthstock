-- orders and order_events, range-partitioned by IST trade_date (T-201, spec backend-core §4.3).
-- Hand-written (drizzle-kit generate --custom): Drizzle cannot express PARTITION BY, so these
-- tables are not in src/db/schema and db:check does not see them.
--
-- trade_date is the IST trading day the order belongs to (an AMO placed at 20:00 IST belongs to the
-- next session's date); the app computes it. The partition key must be in the primary key, so there
-- are no foreign keys into orders, and orders.user_id has none either: the purge job deletes a
-- purged user's rows explicitly (spec §8).
-- A DEFAULT partition catches a date with no daily partition, so an insert never fails.
-- Everything here creates new objects, so it takes no lock on a table the running app uses.
CREATE TABLE orders (
	id text NOT NULL,
	trade_date date NOT NULL,
	user_id text NOT NULL,
	client_order_id text,
	token integer NOT NULL,
	symbol text NOT NULL,
	exchange text NOT NULL,
	side text NOT NULL,
	type text NOT NULL,
	product text NOT NULL,
	qty integer NOT NULL,
	price bigint,
	filled_qty integer NOT NULL DEFAULT 0,
	avg_fill_price bigint,
	status text NOT NULL,
	status_reason text,
	reject_code text,
	placed_at timestamp (3) with time zone NOT NULL,
	updated_at timestamp (3) with time zone NOT NULL,
	CONSTRAINT orders_pkey PRIMARY KEY (trade_date, id),
	CONSTRAINT orders_exchange_check CHECK (exchange IN ('NSE', 'BSE')),
	CONSTRAINT orders_side_check CHECK (side IN ('BUY', 'SELL')),
	CONSTRAINT orders_type_check CHECK (type IN ('MARKET', 'LIMIT')),
	CONSTRAINT orders_product_check CHECK (product IN ('DELIVERY', 'INTRADAY')),
	CONSTRAINT orders_status_check CHECK (status IN ('AMO', 'OPEN', 'EXECUTED', 'CANCELLED', 'REJECTED')),
	CONSTRAINT orders_qty_check CHECK (qty >= 1),
	CONSTRAINT orders_filled_qty_check CHECK (filled_qty >= 0 AND filled_qty <= qty),
	CONSTRAINT orders_price_check CHECK (price IS NULL OR (price > 0 AND price % 5 = 0))
) PARTITION BY RANGE (trade_date);--> statement-breakpoint
CREATE TABLE orders_default PARTITION OF orders DEFAULT;--> statement-breakpoint
CREATE INDEX orders_user_id_placed_at_idx ON orders (user_id, placed_at DESC, id DESC);--> statement-breakpoint
CREATE INDEX orders_user_id_live_idx ON orders (user_id) WHERE status IN ('AMO', 'OPEN');--> statement-breakpoint
CREATE TABLE order_events (
	id bigserial NOT NULL,
	trade_date date NOT NULL,
	order_id text NOT NULL,
	user_id text NOT NULL,
	seq smallint NOT NULL,
	event text NOT NULL,
	status text NOT NULL,
	at timestamp (3) with time zone NOT NULL,
	qty integer NOT NULL,
	type text NOT NULL,
	price bigint,
	fill_price bigint,
	note text,
	CONSTRAINT order_events_pkey PRIMARY KEY (trade_date, id),
	CONSTRAINT order_events_order_seq_key UNIQUE (trade_date, order_id, seq),
	CONSTRAINT order_events_event_check CHECK (event IN ('PLACED', 'MODIFIED', 'RELEASED', 'EXECUTED', 'CANCELLED', 'REJECTED')),
	CONSTRAINT order_events_status_check CHECK (status IN ('AMO', 'OPEN', 'EXECUTED', 'CANCELLED', 'REJECTED')),
	CONSTRAINT order_events_type_check CHECK (type IN ('MARKET', 'LIMIT')),
	CONSTRAINT order_events_qty_check CHECK (qty >= 1),
	CONSTRAINT order_events_seq_check CHECK (seq >= 1)
) PARTITION BY RANGE (trade_date);--> statement-breakpoint
CREATE TABLE order_events_default PARTITION OF order_events DEFAULT;--> statement-breakpoint
CREATE INDEX order_events_user_id_idx ON order_events (user_id, trade_date);--> statement-breakpoint
-- Creates the daily partitions of orders and order_events for `days` days starting at `from_date`
-- (an IST trade date) and returns how many days got new partitions. Idempotent. SECURITY DEFINER
-- because the app role cannot run DDL: it runs as its owner (nthstock_owner), so new partitions get
-- the owner's default privileges, and only the app role may call it. If DEFAULT already holds rows
-- for a date in the range, Postgres refuses that partition; move the rows out first.
CREATE FUNCTION ensure_order_partitions(from_date date, days integer) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
	day date;
	suffix text;
	created integer := 0;
BEGIN
	IF days < 1 OR days > 400 THEN
		RAISE EXCEPTION 'days must be between 1 and 400, got %', days USING ERRCODE = '22023';
	END IF;
	FOR day IN SELECT d::date FROM generate_series(from_date, from_date + (days - 1), interval '1 day') AS d LOOP
		suffix := to_char(day, 'YYYYMMDD');
		IF to_regclass('public.orders_' || suffix) IS NULL THEN
			EXECUTE format('CREATE TABLE public.%I PARTITION OF public.orders FOR VALUES FROM (%L) TO (%L)',
				'orders_' || suffix, day, day + 1);
			created := created + 1;
		END IF;
		IF to_regclass('public.order_events_' || suffix) IS NULL THEN
			EXECUTE format('CREATE TABLE public.%I PARTITION OF public.order_events FOR VALUES FROM (%L) TO (%L)',
				'order_events_' || suffix, day, day + 1);
		END IF;
	END LOOP;
	RETURN created;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION ensure_order_partitions(date, integer) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION ensure_order_partitions(date, integer) TO nthstock_app;
