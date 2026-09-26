import type { User } from '@nthstock/contracts';
import type { UserRecord } from './repo.js';

/** `9876543210` → `******3210`. */
export const maskMobile = (mobile: string): string => `******${mobile.slice(-4)}`;

/** The public view of a user: masked mobile, UTC timestamp. */
export function toUser(record: UserRecord): User {
  return {
    id: record.id,
    mobileMasked: maskMobile(record.mobile),
    name: record.name,
    email: record.email,
    kycStatus: record.kycStatus,
    pinSet: record.pinSet,
    totpEnabled: record.totpEnabled,
    createdAt: record.createdAt.toISOString(),
  };
}
