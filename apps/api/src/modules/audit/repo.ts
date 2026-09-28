import type { Clock } from '@nthstock/utils';
import type { Tx } from '../../db/client.js';
import { assertAuditDetailAllowed } from './detail.js';
import type { AuditRecord, NewAuditRecord } from './schema.js';

/**
 * The append-only audit log (spec backend-core §8). There is deliberately no way to change or
 * remove an entry; `reset` exists for tests on the memory log only.
 *
 * Every write first checks each entry's detail against the deny list and refuses the whole batch
 * (`AuditDetailRefusedError`, nothing written) when a key is on it. `appendMany` is all or
 * nothing; on Postgres, passing `tx` writes the entries in the caller's transaction, so they
 * commit or roll back with the change they record.
 */
export interface AuditRepo {
  append(entry: NewAuditRecord): Promise<AuditRecord>;
  appendMany(entries: readonly NewAuditRecord[], tx?: Tx): Promise<readonly AuditRecord[]>;
  /** Entries in the order they were written, optionally for one user. */
  list(userId?: string): Promise<readonly AuditRecord[]>;
  /** Tests only: forget every entry. The Postgres log refuses (tests truncate it as the owner). */
  reset(): Promise<void>;
}

/** Refuses the batch if any entry's detail has a denied key. */
export function assertAuditEntriesAllowed(entries: readonly NewAuditRecord[]): void {
  for (const entry of entries) assertAuditDetailAllowed(entry.detail);
}

/** Freezes a JSON value and everything inside it. */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/**
 * Detail as the log stores it: a deep, frozen JSON copy, the same round trip Postgres' jsonb makes
 * (undefined values drop out, dates become strings), so the two implementations cannot differ.
 */
export function storedDetail(detail: NewAuditRecord['detail']): AuditRecord['detail'] {
  return deepFreeze(JSON.parse(JSON.stringify(detail)) as Record<string, unknown>);
}

export function createMemoryAuditRepo({ clock }: { clock: Clock }): AuditRepo {
  const entries: AuditRecord[] = [];
  let lastId = 0;

  // Synchronous inside, so entries land in call order even when callers do not await.
  function write(batch: readonly NewAuditRecord[]): readonly AuditRecord[] {
    assertAuditEntriesAllowed(batch);
    const at = clock.now();
    const records = batch.map((entry) =>
      Object.freeze({
        id: String(++lastId),
        at,
        actor: Object.freeze({ ...entry.actor }),
        userId: entry.userId,
        action: entry.action,
        orderId: entry.orderId,
        outcome: entry.outcome,
        requestId: entry.requestId ?? null,
        detail: storedDetail(entry.detail),
      } satisfies AuditRecord),
    );
    entries.push(...records);
    return records;
  }

  const attempt = <T>(work: () => T): Promise<T> => {
    try {
      return Promise.resolve(work());
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  };

  return {
    append: (entry) =>
      attempt(() => {
        const [record] = write([entry]);
        if (!record) throw new Error('append wrote nothing');
        return record;
      }),
    appendMany: (batch) => attempt(() => write(batch)),
    list: (userId) =>
      Promise.resolve(
        userId === undefined ? [...entries] : entries.filter((entry) => entry.userId === userId),
      ),
    reset: () => {
      entries.length = 0;
      lastId = 0;
      return Promise.resolve();
    },
  };
}
