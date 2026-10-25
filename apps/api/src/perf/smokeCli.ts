import { appendFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { evaluateBudgets, renderReport } from './report.js';
import { runPerfSmoke } from './smoke.js';

// `npm run perf:smoke` (root, with the local defaults) or `npm run perf:smoke -w @nthstock/api`
// (T-243): seeds PERF_USERS users on DATABASE_URL, measures PIN logins and MARKET order acks,
// reads pg_stat_statements through PERF_STATS_URL (default DATABASE_MIGRATION_URL), writes the
// markdown report to PERF_REPORT_PATH and exits 1 when a budget fails. docs/runbooks/perf-smoke.md.

const PgUrl = z.url({ protocol: /^postgres(ql)?$/ });
const Count = (fallback: number, min: number) => z.coerce.number().int().min(min).default(fallback);

const Env = z.object({
  DATABASE_URL: PgUrl,
  PERF_STATS_URL: PgUrl.optional(),
  DATABASE_MIGRATION_URL: PgUrl.optional(),
  PERF_USERS: Count(10_000, 1),
  PERF_SAMPLES: Count(500, 1),
  PERF_WARMUP: Count(20, 0),
  PERF_CONCURRENCY: Count(4, 1),
  PG_POOL_MAX: z.coerce.number().int().min(1).optional(),
  PERF_REPORT_PATH: z.string().min(1).default('perf-report.md'),
  PERF_SMOKE_ALLOW_REMOTE: z.enum(['true', 'false']).default('false'),
  NODE_ENV: z.string().optional(),
});

const blankToUndefined = Object.fromEntries(
  Object.entries(process.env).map(([key, value]) => [key, value?.trim() || undefined]),
);
const env = Env.safeParse(blankToUndefined);
if (!env.success) {
  process.stderr.write(
    `perf:smoke: ${z.prettifyError(env.error)}\nDATABASE_URL must be a postgres:// URL for the ` +
      'nthstock_app role (the root `npm run perf:smoke` sets the local default).\n',
  );
  process.exit(1);
}
const config = env.data;

// It writes thousands of users with a known PIN: a local or CI database only.
if (config.NODE_ENV === 'production') {
  process.stderr.write('perf:smoke refuses to run with NODE_ENV=production.\n');
  process.exit(1);
}
const host = new URL(config.DATABASE_URL).hostname;
if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host)) {
  if (config.PERF_SMOKE_ALLOW_REMOTE !== 'true') {
    process.stderr.write(
      `perf:smoke only seeds a local database; DATABASE_URL points at ${host}. Set ` +
        'PERF_SMOKE_ALLOW_REMOTE=true for a throwaway database elsewhere.\n',
    );
    process.exit(1);
  }
}

try {
  const result = await runPerfSmoke({
    databaseUrl: config.DATABASE_URL,
    statsUrl: config.PERF_STATS_URL ?? config.DATABASE_MIGRATION_URL ?? null,
    users: config.PERF_USERS,
    samples: config.PERF_SAMPLES,
    warmup: config.PERF_WARMUP,
    concurrency: config.PERF_CONCURRENCY,
    ...(config.PG_POOL_MAX === undefined ? {} : { poolMax: config.PG_POOL_MAX }),
    log: (line) => process.stdout.write(`${line}\n`),
  });
  const budgets = evaluateBudgets(result);
  const report = renderReport(result, budgets);
  const path = resolve(config.PERF_REPORT_PATH);
  writeFileSync(path, report);
  process.stdout.write(`\n${report}\nReport written to ${path}\n`);
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) appendFileSync(summary, `${report}\n`);
  const failed = budgets.filter((budget) => !budget.pass);
  if (failed.length > 0) {
    process.stderr.write(`Budgets failed: ${failed.map((budget) => budget.name).join(', ')}\n`);
    process.exit(1);
  }
} catch (error) {
  // The first line only: a failed Drizzle query appends its parameters, which stay out of logs.
  const firstLine = (value: unknown) =>
    (value instanceof Error ? value.message : String(value)).split('\n')[0] ?? '';
  const cause = error instanceof Error && error.cause ? ` (${firstLine(error.cause)})` : '';
  process.stderr.write(`perf:smoke failed: ${firstLine(error)}${cause}\n`);
  process.exit(1);
}
