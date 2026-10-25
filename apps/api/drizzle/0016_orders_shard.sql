-- orders.shard: the matcher shard of the order's instrument, shardOf(token, QUOTE_SHARDS) (NSTOCK-0366,
-- spec market-data-and-matching §5.3). Hand-written (drizzle-kit generate --custom): orders is
-- partitioned, so it is not in src/db/schema (see 0011).
--
-- apps/api sets it on insert when QUOTE_SHARDS is set. It is nullable, so rows from before this
-- migration, or from an API without shards, stay valid: the matcher's reconcile also reads the live
-- orders whose shard is NULL and keeps those of its own shard by token.
-- ADD COLUMN without a default changes only the catalog. The partial index covers only live orders
-- (a day's worth at most), so building it is short; it takes a SHARE lock that blocks order writes
-- while it builds.
ALTER TABLE orders ADD COLUMN shard smallint;--> statement-breakpoint
CREATE INDEX orders_shard_live_idx ON orders (shard) WHERE status IN ('AMO', 'OPEN');
