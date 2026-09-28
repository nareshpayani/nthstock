import { sql } from 'drizzle-orm';
import { customType, timestamp } from 'drizzle-orm/pg-core';

/** `'A', 'B'` for a CHECK … IN (…) list. The values are compile-time constants, never input. */
export const sqlList = (values: readonly string[]) =>
  sql.raw(values.map((value) => `'${value.replaceAll("'", "''")}'`).join(', '));

/** `bytea` (ciphertexts, blind indexes, token hashes), read and written as a Buffer. */
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

/** `timestamptz(3)`: UTC instants at the millisecond precision of a JS Date. */
export const instant = (name: string) => timestamp(name, { withTimezone: true, precision: 3 });
