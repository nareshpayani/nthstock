-- Stored candles on TimescaleDB (E25, spec market-data-and-matching §7, NSTOCK-0371 and 0372).
-- Hand-written (drizzle-kit generate --custom): Drizzle cannot express hypertables, continuous
-- aggregates or their policies, so these objects are not in src/db/schema and db:check does not
-- see them; apps/api reads and writes them with SQL in src/modules/candles.
--
-- The extension: the Compose, CI and Testcontainers image is timescale/timescaledb (Apache core plus
-- the free community features). The migration runs as nthstock_owner, the database owner, which may
-- create it; nthstock_app keeps DML only.
CREATE EXTENSION IF NOT EXISTS timescaledb;--> statement-breakpoint

-- One row per instrument and minute. Prices are integer paise (CLAUDE.md §6); `bucket` is the
-- minute's start in UTC; `volume` is the shares traded in that minute.
CREATE TABLE candles_1m (
	token integer NOT NULL,
	bucket timestamp with time zone NOT NULL,
	open bigint NOT NULL,
	high bigint NOT NULL,
	low bigint NOT NULL,
	close bigint NOT NULL,
	volume bigint NOT NULL,
	CONSTRAINT candles_1m_pkey PRIMARY KEY (token, bucket),
	CONSTRAINT candles_1m_prices_check CHECK (low > 0 AND low <= LEAST(open, close) AND high >= GREATEST(open, close)),
	CONSTRAINT candles_1m_volume_check CHECK (volume >= 0)
);--> statement-breakpoint
SELECT create_hypertable('candles_1m', by_range('bucket', INTERVAL '1 day'));--> statement-breakpoint
-- Compressed by instrument, newest first inside a segment: a chart reads one token's recent bars.
ALTER TABLE candles_1m SET (
	timescaledb.compress,
	timescaledb.compress_segmentby = 'token',
	timescaledb.compress_orderby = 'bucket DESC'
);--> statement-breakpoint
SELECT add_compression_policy('candles_1m', INTERVAL '7 days');--> statement-breakpoint
REVOKE ALL ON TABLE candles_1m FROM PUBLIC, nthstock_app, nthstock_purge;--> statement-breakpoint
-- The candle writer upserts closed minutes; nothing deletes a bar but the retention of a later phase.
GRANT SELECT, INSERT, UPDATE ON TABLE candles_1m TO nthstock_app;--> statement-breakpoint

-- Continuous aggregates, bucketed from the NSE open: the origin is 09:15 IST (03:45 UTC) on a
-- Monday, so a 15-minute bar starts at 09:15, 09:30 and so on, an hourly bar at 09:15, 10:15, and a
-- daily bar spans one IST session. Real-time aggregation (materialized_only = false) adds the
-- minutes the policy has not materialised yet, so a read always includes every closed minute.
-- WITH NO DATA: the migration runs in a transaction, and an empty table has nothing to refresh.
CREATE MATERIALIZED VIEW candles_5m WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT token,
	time_bucket(INTERVAL '5 minutes', bucket, TIMESTAMPTZ '2000-01-03 03:45:00+00') AS bucket,
	first(open, bucket) AS open, max(high) AS high, min(low) AS low, last(close, bucket) AS close,
	sum(volume)::bigint AS volume
FROM candles_1m GROUP BY 1, 2 WITH NO DATA;--> statement-breakpoint
CREATE MATERIALIZED VIEW candles_15m WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT token,
	time_bucket(INTERVAL '15 minutes', bucket, TIMESTAMPTZ '2000-01-03 03:45:00+00') AS bucket,
	first(open, bucket) AS open, max(high) AS high, min(low) AS low, last(close, bucket) AS close,
	sum(volume)::bigint AS volume
FROM candles_1m GROUP BY 1, 2 WITH NO DATA;--> statement-breakpoint
CREATE MATERIALIZED VIEW candles_30m WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT token,
	time_bucket(INTERVAL '30 minutes', bucket, TIMESTAMPTZ '2000-01-03 03:45:00+00') AS bucket,
	first(open, bucket) AS open, max(high) AS high, min(low) AS low, last(close, bucket) AS close,
	sum(volume)::bigint AS volume
FROM candles_1m GROUP BY 1, 2 WITH NO DATA;--> statement-breakpoint
CREATE MATERIALIZED VIEW candles_1h WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT token,
	time_bucket(INTERVAL '1 hour', bucket, TIMESTAMPTZ '2000-01-03 03:45:00+00') AS bucket,
	first(open, bucket) AS open, max(high) AS high, min(low) AS low, last(close, bucket) AS close,
	sum(volume)::bigint AS volume
FROM candles_1m GROUP BY 1, 2 WITH NO DATA;--> statement-breakpoint
CREATE MATERIALIZED VIEW candles_1d WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT token,
	time_bucket(INTERVAL '1 day', bucket, TIMESTAMPTZ '2000-01-03 03:45:00+00') AS bucket,
	first(open, bucket) AS open, max(high) AS high, min(low) AS low, last(close, bucket) AS close,
	sum(volume)::bigint AS volume
FROM candles_1m GROUP BY 1, 2 WITH NO DATA;--> statement-breakpoint

-- Refresh policies of one bucket: each runs once per bucket and materialises the buckets that
-- closed since, leaving the forming bucket to real-time aggregation. The window reaches back three
-- buckets so a late or replayed minute (a candle writer restart) is folded in on the next run.
SELECT add_continuous_aggregate_policy('candles_5m', start_offset => INTERVAL '15 minutes', end_offset => INTERVAL '5 minutes', schedule_interval => INTERVAL '5 minutes');--> statement-breakpoint
SELECT add_continuous_aggregate_policy('candles_15m', start_offset => INTERVAL '45 minutes', end_offset => INTERVAL '15 minutes', schedule_interval => INTERVAL '15 minutes');--> statement-breakpoint
SELECT add_continuous_aggregate_policy('candles_30m', start_offset => INTERVAL '90 minutes', end_offset => INTERVAL '30 minutes', schedule_interval => INTERVAL '30 minutes');--> statement-breakpoint
SELECT add_continuous_aggregate_policy('candles_1h', start_offset => INTERVAL '3 hours', end_offset => INTERVAL '1 hour', schedule_interval => INTERVAL '1 hour');--> statement-breakpoint
SELECT add_continuous_aggregate_policy('candles_1d', start_offset => INTERVAL '3 days', end_offset => INTERVAL '1 day', schedule_interval => INTERVAL '1 day');--> statement-breakpoint

REVOKE ALL ON TABLE candles_5m, candles_15m, candles_30m, candles_1h, candles_1d FROM PUBLIC, nthstock_app, nthstock_purge;--> statement-breakpoint
GRANT SELECT ON TABLE candles_5m, candles_15m, candles_30m, candles_1h, candles_1d TO nthstock_app;
