/**
 * Stored shape of the audit log (CLAUDE.md §4: an append-only audit log for logins, orders and
 * fund movements). In memory in the mock phase; an append-only Postgres table (no UPDATE or DELETE
 * grants) replaces it in Phase 3 (ADR 0004 §3).
 */

/** Who did it: the signed-in user, or the system (fills, AMO release, end of day). */
export type AuditActor = { type: 'user'; userId: string } | { type: 'system' };

export type AuditAction =
  | 'ORDER_PLACE'
  | 'ORDER_MODIFY'
  | 'ORDER_CANCEL'
  /** Any change to an order's state: stored, opened, filled, rejected, cancelled. */
  | 'ORDER_UPDATE'
  /** A funds ledger entry: opening credit, block, release, trade debit or credit, reset. */
  | 'FUNDS_MOVEMENT'
  /** The user reset their paper balance (T-155). */
  | 'FUNDS_RESET';

export type AuditOutcome = 'OK' | 'REFUSED';

/** One audit entry. Frozen once written. */
export type AuditRecord = {
  id: string;
  at: Date;
  actor: AuditActor;
  /** Whose account it concerns. */
  userId: string;
  action: AuditAction;
  orderId: string | null;
  outcome: AuditOutcome;
  /** What was asked and what came of it (request body, status, reason code). No PII. */
  detail: Readonly<Record<string, unknown>>;
};

export type NewAuditRecord = Omit<AuditRecord, 'id' | 'at'>;
