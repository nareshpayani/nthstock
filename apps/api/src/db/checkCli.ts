import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

// `npm run db:check -w @nthstock/api` (T-179, run in CI by T-181): fails when the schema files and
// the committed migrations disagree.
//   1. `drizzle-kit check`: the migration folder and its snapshots are consistent.
//   2. `drizzle-kit generate` into a scratch copy of ./drizzle must produce nothing: a schema edit
//      without `npm run db:generate` and a committed migration fails here.
// drizzle-kit exits 0 even when it throws, so each step also needs its success message.

const MIGRATIONS = 'drizzle';

function drizzleKit(args: string[]): string {
  const result = spawnSync('drizzle-kit', args, { encoding: 'utf8', shell: false });
  const output = `${result.stdout}${result.stderr}`;
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`drizzle-kit ${args[0] ?? ''} exited with ${String(result.status)}\n${output}`);
  }
  return output;
}

function listFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)))
    .sort();
}

/** Returns why the check failed, or null when migrations match the schema. */
function check(): string | null {
  const checked = drizzleKit(['check']);
  if (!checked.includes("Everything's fine")) return `drizzle-kit check did not pass\n${checked}`;

  const scratch = mkdtempSync(join(tmpdir(), 'nthstock-db-check-'));
  try {
    cpSync(MIGRATIONS, scratch, { recursive: true });
    const before = listFiles(scratch);
    // drizzle-kit resolves --out against the working directory, so pass a relative path.
    const generated = drizzleKit([
      'generate',
      '--dialect',
      'postgresql',
      '--schema',
      './src/db/schema',
      '--out',
      relative(process.cwd(), scratch),
    ]);
    const added = listFiles(scratch).filter((file) => !before.includes(file));
    const journalChanged =
      readFileSync(join(scratch, 'meta/_journal.json'), 'utf8') !==
      readFileSync(join(MIGRATIONS, 'meta/_journal.json'), 'utf8');
    if (added.length > 0 || journalChanged) {
      const sql = added
        .filter((file) => file.endsWith('.sql'))
        .map((file) => `--- ${file}\n${readFileSync(join(scratch, file), 'utf8')}`)
        .join('\n');
      return (
        'the schema files have changes with no migration. Run ' +
        `\`npm run db:generate -w @nthstock/api\` and commit the result.\n${sql}`
      );
    }
    if (!generated.includes('No schema changes')) {
      return `drizzle-kit generate did not confirm the schema is unchanged\n${generated}`;
    }
    return null;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

const problem = check();
if (problem) {
  process.stderr.write(`db:check failed: ${problem}\n`);
  process.exit(1);
}
process.stdout.write('db:check: migrations match the schema.\n');
