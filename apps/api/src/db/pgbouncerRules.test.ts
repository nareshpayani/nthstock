import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// PgBouncer rules (T-184, spec backend-core §5.4, infra/README.md "PgBouncer rules"). In
// transaction mode a server connection is handed to another client after every transaction, so
// apps/api must never rely on session state. This test greps every non-test source file in
// apps/api/src for the forms that would break that. Test files are exempt: some run such SQL on
// purpose (e.g. to prove the app role cannot create temp tables).

type Rule = { name: string; pattern: RegExp };

const RULES: Rule[] = [
  {
    name: 'LISTEN/UNLISTEN (no notifications through PgBouncer)',
    pattern: /\b(UN)?LISTEN\s+["\w*]/i,
  },
  { name: 'NOTIFY / pg_notify', pattern: /\bNOTIFY\s+["\w]|\bpg_notify\s*\(/i },
  {
    name: 'session advisory lock (use pg_advisory_xact_lock)',
    pattern: /\bpg_(try_)?advisory_(un)?lock(_shared|_all)?\s*\(/i,
  },
  {
    name: 'SET or RESET outside a transaction (use SET LOCAL / set_config(…, true))',
    pattern: /(^|[`'";(]\s*)(SET\s+(?!LOCAL\b)(SESSION\s+)?\w+\s*(=|TO\b)|RESET\s+\w)/im,
  },
  { name: 'session-level set_config', pattern: /\bset_config\s*\([^)]*,\s*false\s*\)/i },
  { name: 'temporary table', pattern: /\bCREATE\s+(GLOBAL\s+|LOCAL\s+)?TEMP(ORARY)?\s+TABLE/i },
  {
    name: 'named prepared statement (Drizzle .prepare(), SQL PREPARE)',
    pattern: /\.prepare\s*\(|(^|[`'";]\s*)PREPARE\s+\w/im,
  },
];

/** Comments may describe the rules; only code counts. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function findViolations(source: string): string[] {
  const code = stripComments(source);
  return RULES.filter((rule) => rule.pattern.test(code)).map((rule) => rule.name);
}

const SRC = fileURLToPath(new URL('..', import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .filter((entry) => !entry.name.endsWith('.test.ts'))
    .map((entry) => join(entry.parentPath, entry.name));
}

describe('PgBouncer rules (T-184)', () => {
  it('finds no session-state SQL in apps/api/src', () => {
    const files = sourceFiles(SRC);
    const violations = files.flatMap((file) =>
      findViolations(readFileSync(file, 'utf8')).map((rule) => `${relative(SRC, file)}: ${rule}`),
    );

    expect(files.length).toBeGreaterThan(50);
    expect(violations).toEqual([]);
  });

  it.each([
    ["await client.query('LISTEN order_updates')", 'LISTEN'],
    ['await db.execute(sql`unlisten *`)', 'LISTEN'],
    ["await client.query(`NOTIFY ticks, 'x'`)", 'NOTIFY'],
    ["await db.execute(sql`select pg_notify('ticks', ${payload})`)", 'NOTIFY'],
    ['await db.execute(sql`select pg_advisory_lock(42)`)', 'advisory'],
    ['await db.execute(sql`select pg_try_advisory_lock(42)`)', 'advisory'],
    ["await db.execute(sql`SET statement_timeout = '5s'`)", 'SET or RESET'],
    ["await client.query('SET SESSION search_path TO app')", 'SET or RESET'],
    ["await client.query('RESET statement_timeout')", 'SET or RESET'],
    ["await db.execute(sql`select set_config('search_path', 'x', false)`)", 'set_config'],
    ['await db.execute(sql`CREATE TEMP TABLE scratch (id int)`)', 'temporary'],
    ["const q = db.select().from(users).prepare('usersById')", 'prepared'],
    ["await client.query('PREPARE q AS SELECT 1')", 'prepared'],
  ])('flags a planted violation: %s', (source, rule) => {
    expect(findViolations(source)).toEqual([expect.stringContaining(rule)]);
  });

  it.each([
    "await tx.execute(sql`select set_config('statement_timeout', ${ms}, true)`)",
    "await tx.execute(sql`SET LOCAL statement_timeout = '2s'`)",
    'await db.execute(sql`select pg_advisory_xact_lock(42)`)',
    'await db.update(users).set({ name }).where(eq(users.id, id))',
    'await db.execute(sql`UPDATE pins SET failures = failures + 1 WHERE user_id = ${id}`)',
    'await app.listen({ port: 4000 })',
    '// LISTEN ticks is not allowed; this comment explains why',
    "const url = 'postgres://127.0.0.1/nthstock'; // SET x = 1 in a comment",
  ])('allows %s', (source) => {
    expect(findViolations(source)).toEqual([]);
  });
});
