/**
 * Stored shape of the audit log (CLAUDE.md §4: an append-only audit log for logins, orders and
 * fund movements; spec backend-core §4.4 and §8). The Postgres table is `audit_log`
 * (`src/db/schema/audit.ts`): no UPDATE or DELETE grants, and a trigger that rejects both.
 */

/** Who did it: the signed-in user, or the system (fills, AMO release, end of day). */
export type AuditActor = { type: 'user'; userId: string } | { type: 'system' };

/**
 * Every action the log accepts. The `audit_log.action` CHECK constraint is built from this list,
 * so adding an action means a migration (`npm run db:generate`); `db:check` fails CI otherwise.
 *
 * - `ORDER_PLACE`, `ORDER_MODIFY`, `ORDER_CANCEL`: the user's order actions.
 * - `ORDER_UPDATE`: any change to an order's state: stored, opened, filled, rejected, cancelled.
 * - `FUNDS_MOVEMENT`: a funds ledger entry: opening credit, block, release, trade debit or credit,
 *   reset.
 * - `FUNDS_RESET`: the user reset their paper balance (T-155).
 */
export const AUDIT_ACTIONS = [
  'ORDER_PLACE',
  'ORDER_MODIFY',
  'ORDER_CANCEL',
  'ORDER_UPDATE',
  'FUNDS_MOVEMENT',
  'FUNDS_RESET',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_OUTCOMES = ['OK', 'REFUSED'] as const;

export type AuditOutcome = (typeof AUDIT_OUTCOMES)[number];

/** One audit entry. Frozen once written. */
export type AuditRecord = {
  /** Assigned by the log, increasing in the order entries were written. */
  id: string;
  at: Date;
  actor: AuditActor;
  /** Whose account it concerns; null when there is none (a failed login for an unknown mobile). */
  userId: string | null;
  action: AuditAction;
  orderId: string | null;
  outcome: AuditOutcome;
  /** The HTTP request that caused it, when there was one. */
  requestId: string | null;
  /**
   * What was asked and what came of it (request body, status, reason). Never PII or secrets: the
   * repo refuses keys on the deny list (see `assertAuditDetailAllowed`).
   */
  detail: Readonly<Record<string, unknown>>;
};

export type NewAuditRecord = Omit<AuditRecord, 'id' | 'at' | 'requestId'> & {
  requestId?: string | null;
};
