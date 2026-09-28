/**
 * Detail keys the audit log refuses in every environment (spec backend-core §8, ASVS 7.1.1 and
 * 7.1.2): no mobile, OTP, PIN, TOTP code, token, secret, name or email ever reaches `detail`.
 */
export const AUDIT_DETAIL_DENY_LIST = [
  'mobile',
  'otp',
  'pin',
  'code',
  'token',
  'secret',
  'name',
  'email',
] as const;

/** Thrown before anything is written when an entry's detail has a key on the deny list. */
export class AuditDetailRefusedError extends Error {
  /** Where the key is, e.g. `detail.request.mobile`. Never the value. */
  readonly path: string;

  constructor(path: string) {
    super(`Audit detail may not contain "${path}": it is on the deny list (PII or a secret).`);
    this.name = 'AuditDetailRefusedError';
    this.path = path;
  }
}

/** The first denied word inside `key`, case-insensitively, or null. */
function deniedWordIn(key: string): string | null {
  const lower = key.toLowerCase();
  return AUDIT_DETAIL_DENY_LIST.find((word) => lower.includes(word)) ?? null;
}

function check(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      check(item, `${path}[${String(index)}]`);
    });
    return;
  }
  if (value === null || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (deniedWordIn(key)) throw new AuditDetailRefusedError(childPath);
    check(child, childPath);
  }
}

/**
 * Throws `AuditDetailRefusedError` when any key in `detail`, at any depth (nested objects and
 * arrays included), contains a word on the deny list, case-insensitively: `mobile`, `userMobile`,
 * `OTP`, `refresh_token` and `firstName` are all refused. Matching inside words is deliberate: a
 * false positive fails loudly in a test and the key gets a clearer name (an instrument token is
 * `instrument`, a reason code is `reason`), while a miss would put PII in a log nobody can edit.
 */
export function assertAuditDetailAllowed(detail: Readonly<Record<string, unknown>>): void {
  check(detail, 'detail');
}
