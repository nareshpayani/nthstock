/**
 * The pure half of the performance smoke (T-243, spec backend-core §13 perf check): percentiles,
 * the pg_stat_statements arithmetic, the budgets and the markdown report. `smoke.ts` measures;
 * this file only computes and prints, so it is unit tested without a database.
 */

/** The budgets the smoke must meet (docs/specs/backend-core-tasks.md T-243). */
export const PERF_BUDGETS_MS = {
  orderAckP95: 300,
  pinLoginP95: 200,
  slowestQueryP95: 50,
} as const;

/** z for the 95th percentile of a normal distribution, for the pg_stat_statements estimate. */
const Z_95 = 1.645;

export type LatencySummary = {
  n: number;
  /** Requests that did not answer 200 (left out of the percentiles). */
  errors: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  mean: number;
};

/** The nearest-rank percentile (`p` from 0 to 100) of ascending `sorted`; NaN when empty. */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return Number.NaN;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1] ?? Number.NaN;
}

export function summarize(samples: readonly number[], errors = 0): LatencySummary {
  const sorted = [...samples].sort((a, b) => a - b);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  return {
    n: sorted.length,
    errors,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted.at(-1) ?? Number.NaN,
    mean: sorted.length === 0 ? Number.NaN : total / sorted.length,
  };
}

/** Collapses whitespace so one statement's samples group together. */
export const normalizeSql = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** One row of `pg_stat_statements`, as the smoke reads it (times in ms). */
export type StatementRow = {
  queryid: string;
  query: string;
  calls: number;
  totalMs: number;
  meanMs: number;
  stddevMs: number;
  maxMs: number;
};

/** A statement's calls during the measured phase only. */
export type StatementDelta = {
  query: string;
  calls: number;
  meanMs: number;
  stddevMs: number;
  /** Known only for a statement first seen in the measured phase; null otherwise. */
  maxMs: number | null;
  /** mean + 1.645 × stddev, capped at the max when it is known: an estimate, not a percentile. */
  p95EstimateMs: number;
};

/** Sum of squared times, recovered from pg_stat_statements' (population) mean and stddev. */
const sumOfSquares = (row: StatementRow) => (row.stddevMs ** 2 + row.meanMs ** 2) * row.calls;

/**
 * The statements run between two snapshots, slowest first. pg_stat_statements is cumulative and
 * resetting it needs a superuser, so the measured phase is the difference: calls, total time and
 * the sum of squares subtract exactly, which gives the phase's mean and stddev.
 */
export function statementDeltas(
  before: readonly StatementRow[],
  after: readonly StatementRow[],
): StatementDelta[] {
  const earlier = new Map(before.map((row) => [row.queryid, row]));
  const deltas: StatementDelta[] = [];
  for (const row of after) {
    const prior = earlier.get(row.queryid);
    const calls = row.calls - (prior?.calls ?? 0);
    if (calls <= 0) continue;
    const total = row.totalMs - (prior?.totalMs ?? 0);
    const meanMs = total / calls;
    const squares = sumOfSquares(row) - (prior ? sumOfSquares(prior) : 0);
    const stddevMs = Math.sqrt(Math.max(0, squares / calls - meanMs ** 2));
    const maxMs = prior ? null : row.maxMs;
    const estimate = meanMs + Z_95 * stddevMs;
    deltas.push({
      query: normalizeSql(row.query),
      calls,
      meanMs,
      stddevMs,
      maxMs,
      p95EstimateMs: maxMs === null ? estimate : Math.min(estimate, maxMs),
    });
  }
  return deltas.sort((a, b) => b.p95EstimateMs - a.p95EstimateMs);
}

/** Client-side timings of one statement (from send to result, on the API's pool). */
export type QueryTiming = { query: string } & LatencySummary;

/** Summarises raw per-statement samples, slowest p95 first. */
export function queryTimings(samples: ReadonlyMap<string, readonly number[]>): QueryTiming[] {
  return [...samples]
    .map(([query, times]) => ({ query, ...summarize(times) }))
    .sort((a, b) => b.p95 - a.p95);
}

export type BudgetResult = {
  name: string;
  /** NaN when nothing was measured, which fails. */
  actualMs: number;
  budgetMs: number;
  pass: boolean;
  note?: string;
};

/** Passes when the value was measured and is strictly under the budget. */
export function checkBudget(
  name: string,
  actualMs: number,
  budgetMs: number,
  note?: string,
): BudgetResult {
  return {
    name,
    actualMs,
    budgetMs,
    pass: Number.isFinite(actualMs) && actualMs < budgetMs,
    ...(note === undefined ? {} : { note }),
  };
}

export type PgStatStatements =
  { available: true; statements: StatementDelta[] } | { available: false; reason: string };

export type PerfSmokeResult = {
  startedAt: Date;
  config: Record<string, string | number>;
  /** How long seeding took, and how many users were created now (the rest already existed). */
  seed: { users: number; created: number; ms: number };
  orderAck: LatencySummary;
  pinLogin: LatencySummary;
  pgStatStatements: PgStatStatements;
  clientQueries: QueryTiming[];
  /** The first few failed requests (route, status, error code): never tokens or bodies with PII. */
  failures: string[];
};

/**
 * The budgets for a result. The slowest query is judged on pg_stat_statements (server time)
 * when it is there, else on the client-side timings (which also count the network round trip).
 * A route with any failed request fails, whatever its percentiles.
 */
export function evaluateBudgets(result: PerfSmokeResult): BudgetResult[] {
  const errorsNote = (summary: LatencySummary) =>
    summary.errors > 0 ? `${String(summary.errors)} requests failed` : undefined;
  const route = (name: string, summary: LatencySummary, budget: number) => {
    const checked = checkBudget(name, summary.p95, budget, errorsNote(summary));
    return summary.errors > 0 ? { ...checked, pass: false } : checked;
  };
  const statements = result.pgStatStatements;
  const slowest =
    statements.available && statements.statements.length > 0
      ? checkBudget(
          'Slowest query p95',
          statements.statements[0]?.p95EstimateMs ?? Number.NaN,
          PERF_BUDGETS_MS.slowestQueryP95,
          'pg_stat_statements, estimated from mean and stddev',
        )
      : checkBudget(
          'Slowest query p95',
          result.clientQueries[0]?.p95 ?? Number.NaN,
          PERF_BUDGETS_MS.slowestQueryP95,
          'client-side timing (pg_stat_statements unavailable)',
        );
  return [
    route('MARKET order ack p95', result.orderAck, PERF_BUDGETS_MS.orderAckP95),
    route('PIN login p95', result.pinLogin, PERF_BUDGETS_MS.pinLoginP95),
    slowest,
  ];
}

const ms = (value: number | null) =>
  value === null || !Number.isFinite(value) ? '—' : `${value.toFixed(1)} ms`;

/** A statement for a table cell: one line, no pipes, at most `max` characters. */
const sqlCell = (query: string, max = 140) => {
  const flat = normalizeSql(query).replaceAll('|', '\\|').replaceAll('`', "'");
  return `\`${flat.length > max ? `${flat.slice(0, max - 1)}…` : flat}\``;
};

/** The markdown report, budgets first. */
export function renderReport(
  result: PerfSmokeResult,
  budgets: readonly BudgetResult[] = evaluateBudgets(result),
  top = 10,
): string {
  const passed = budgets.every((budget) => budget.pass);
  const lines: string[] = [
    '# Performance smoke (T-243)',
    '',
    `Run ${result.startedAt.toISOString()}: **${passed ? 'PASS' : 'FAIL'}**.`,
    '',
    '## Budgets',
    '',
    '| Check | Result | Budget | Status | Note |',
    '| --- | --- | --- | --- | --- |',
    ...budgets.map(
      (budget) =>
        `| ${budget.name} | ${ms(budget.actualMs)} | < ${String(budget.budgetMs)} ms | ${budget.pass ? 'pass' : 'FAIL'} | ${budget.note ?? ''} |`,
    ),
    '',
    '## Routes',
    '',
    '| Route | n | Errors | p50 | p95 | p99 | Max | Mean |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...(
      [
        ['MARKET order ack (`POST /v1/orders`)', result.orderAck],
        ['PIN login (`POST /v1/auth/pin/verify`)', result.pinLogin],
      ] as const
    ).map(
      ([name, s]) =>
        `| ${name} | ${String(s.n)} | ${String(s.errors)} | ${ms(s.p50)} | ${ms(s.p95)} | ${ms(s.p99)} | ${ms(s.max)} | ${ms(s.mean)} |`,
    ),
    ...(result.failures.length > 0
      ? ['', 'First failures:', '', ...result.failures.map((failure) => `- ${failure}`)]
      : []),
    '',
    '## Slowest queries (pg_stat_statements)',
    '',
  ];
  const statements = result.pgStatStatements;
  if (statements.available) {
    lines.push(
      'Server execution time of the statements apps/api ran while measuring (the difference of two',
      'snapshots). pg_stat_statements keeps no percentiles: p95 is mean + 1.645 × stddev, capped at',
      'the max when the statement is new.',
      '',
      '| Query | Calls | Mean | Stddev | Max | p95 (est.) |',
      '| --- | --- | --- | --- | --- | --- |',
      ...statements.statements
        .slice(0, top)
        .map(
          (s) =>
            `| ${sqlCell(s.query)} | ${String(s.calls)} | ${ms(s.meanMs)} | ${ms(s.stddevMs)} | ${ms(s.maxMs)} | ${ms(s.p95EstimateMs)} |`,
        ),
    );
    if (statements.statements.length === 0) lines.push('', 'No statements were recorded.');
  } else {
    lines.push(`Unavailable: ${statements.reason}`);
  }
  lines.push(
    '',
    '## Slowest queries (client-side)',
    '',
    'Time from send to result on the API’s connections (includes the network round trip).',
    '',
    '| Query | n | p50 | p95 | p99 | Max |',
    '| --- | --- | --- | --- | --- | --- |',
    ...result.clientQueries
      .slice(0, top)
      .map(
        (q) =>
          `| ${sqlCell(q.query)} | ${String(q.n)} | ${ms(q.p50)} | ${ms(q.p95)} | ${ms(q.p99)} | ${ms(q.max)} |`,
      ),
    '',
    '## Set-up',
    '',
    '| Setting | Value |',
    '| --- | --- |',
    `| Seeded users | ${String(result.seed.users)} (${String(result.seed.created)} created this run, ${ms(result.seed.ms)}) |`,
    ...Object.entries(result.config).map(([key, value]) => `| ${key} | ${String(value)} |`),
    '',
  );
  return lines.join('\n');
}
