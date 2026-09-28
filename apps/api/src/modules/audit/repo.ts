import { randomUUID } from 'node:crypto';
import type { Clock } from '@nthstock/utils';
import type { AuditRecord, NewAuditRecord } from './schema.js';

/**
 * The append-only audit log. There is deliberately no way to change or remove an entry; `reset`
 * exists for tests only. Appends are synchronous so an entry is written in the same step as the
 * change it records; the Postgres version writes it in the same transaction.
 */
export interface AuditRepo {
  append(entry: NewAuditRecord): AuditRecord;
  /** Entries in the order they were written, optionally for one user. */
  list(userId?: string): Promise<readonly AuditRecord[]>;
  /** Tests only: forget every entry. */
  reset(): Promise<void>;
}

export function createMemoryAuditRepo({ clock }: { clock: Clock }): AuditRepo {
  const entries: AuditRecord[] = [];
  return {
    append(entry) {
      const record: AuditRecord = Object.freeze({
        ...entry,
        id: `aud_${randomUUID().replaceAll('-', '')}`,
        at: clock.now(),
        requestId: entry.requestId ?? null,
        detail: Object.freeze({ ...entry.detail }),
      });
      entries.push(record);
      return record;
    },
    list: (userId) =>
      Promise.resolve(
        userId === undefined ? [...entries] : entries.filter((entry) => entry.userId === userId),
      ),
    reset: () => {
      entries.length = 0;
      return Promise.resolve();
    },
  };
}
