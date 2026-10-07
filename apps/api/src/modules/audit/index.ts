// Public API of the audit module (append-only audit log). Other modules and the app wiring import
// it only through this file; tests may import internals.
export { createPgAuditRepo } from './pgRepo.js';
export { createMemoryAuditRepo, type AuditRepo } from './repo.js';
export type { AuditAction, AuditActor, NewAuditRecord } from './schema.js';
