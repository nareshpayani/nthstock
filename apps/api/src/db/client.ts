import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

/** The Drizzle handle every Postgres repo uses (ADR 0007). */
export type Db = NodePgDatabase;

/** A transaction handle: the same query API as `Db`, bound to one connection. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** Default `statement_timeout` for every transaction (spec backend-core §5.1). */
export const DEFAULT_STATEMENT_TIMEOUT_MS = 2_000;
/** Default `PG_POOL_MAX`. */
export const DEFAULT_POOL_MAX = 10;

export type DatabaseOptions = {
  /** A postgres:// URL; apps/api uses the DML-only `nthstock_app` role (`DATABASE_URL`). */
  url: string;
  /** Connections in the pool (`PG_POOL_MAX`). */
  poolMax?: number;
  /** A connection idle this long is closed. */
  idleTimeoutMillis?: number;
  /** Waiting this long for a connection fails the query instead of hanging. */
  connectionTimeoutMillis?: number;
  /** `statement_timeout` for `transaction()` unless the call sets its own. */
  statementTimeoutMs?: number;
  /** Shown in `pg_stat_activity`. */
  applicationName?: string;
  /**
   * Errors on idle pooled connections (the server restarted, the network dropped). Without a
   * listener `pg` would crash the process; the pool replaces the connection on next use.
   */
  onIdleError?: (error: Error) => void;
};

export type TransactionOptions = {
  /** Overrides the database's default `statement_timeout` for this transaction. */
  statementTimeoutMs?: number;
};

/** One process's connection to Postgres: one `pg` Pool and its Drizzle handle. */
export type Database = {
  db: Db;
  /**
   * Runs `work` in one READ COMMITTED transaction with a transaction-local `statement_timeout`.
   * Commits when `work` resolves and rolls back when it throws. Nothing outlives the transaction,
   * so this is safe behind PgBouncer in transaction mode (§5.4).
   */
  transaction<T>(work: (tx: Tx) => Promise<T>, options?: TransactionOptions): Promise<T>;
  /** One round trip (`select 1`); throws when Postgres cannot be reached. */
  ping(): Promise<void>;
  /** Ends every pooled connection. */
  close(): Promise<void>;
};

/**
 * Creates the process's one Pool (lazily connected: nothing is opened until the first query).
 * Only unnamed statements are used (Drizzle's default with `pg`), and no session state is set
 * outside a transaction, so the same code works directly or through PgBouncer.
 */
export function createDatabase(options: DatabaseOptions): Database {
  const pool = new Pool({
    connectionString: options.url,
    max: options.poolMax ?? DEFAULT_POOL_MAX,
    idleTimeoutMillis: options.idleTimeoutMillis ?? 30_000,
    connectionTimeoutMillis: options.connectionTimeoutMillis ?? 5_000,
    application_name: options.applicationName ?? 'nthstock-api',
  });
  const onIdleError = options.onIdleError ?? (() => undefined);
  pool.on('error', onIdleError);
  const db = drizzle({ client: pool });
  const defaultTimeout = options.statementTimeoutMs ?? DEFAULT_STATEMENT_TIMEOUT_MS;
  let closed: Promise<void> | null = null;
  return {
    db,
    transaction: (work, transactionOptions = {}) => {
      const timeoutMs = transactionOptions.statementTimeoutMs ?? defaultTimeout;
      if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
        return Promise.reject(new Error(`statementTimeoutMs must be a positive integer`));
      }
      return db.transaction(
        async (tx) => {
          // Equivalent to SET LOCAL statement_timeout, but takes a bound parameter.
          await tx.execute(sql`select set_config('statement_timeout', ${`${timeoutMs}ms`}, true)`);
          return work(tx);
        },
        { isolationLevel: 'read committed' },
      );
    },
    ping: async () => {
      await db.execute(sql`select 1`);
    },
    close: () => {
      closed ??= pool.end();
      return closed;
    },
  };
}
