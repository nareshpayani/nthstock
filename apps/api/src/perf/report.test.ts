import { describe, expect, it } from 'vitest';
import {
  PERF_BUDGETS_MS,
  checkBudget,
  evaluateBudgets,
  normalizeSql,
  percentile,
  queryTimings,
  renderReport,
  statementDeltas,
  summarize,
  type PerfSmokeResult,
  type StatementRow,
} from './report.js';

const oneToHundred = Array.from({ length: 100 }, (_, i) => i + 1);

describe('percentile', () => {
  it('takes the nearest rank', () => {
    expect(percentile(oneToHundred, 50)).toBe(50);
    expect(percentile(oneToHundred, 95)).toBe(95);
    expect(percentile(oneToHundred, 99)).toBe(99);
    expect(percentile(oneToHundred, 100)).toBe(100);
    expect(percentile([7], 95)).toBe(7);
    expect(percentile([1, 2, 3], 0)).toBe(1);
  });

  it('is NaN with no samples', () => {
    expect(percentile([], 95)).toBeNaN();
  });
});

describe('summarize', () => {
  it('sorts before ranking and counts errors apart', () => {
    const shuffled = [...oneToHundred].reverse();
    expect(summarize(shuffled, 3)).toEqual({
      n: 100,
      errors: 3,
      p50: 50,
      p95: 95,
      p99: 99,
      max: 100,
      mean: 50.5,
    });
  });

  it('is NaN throughout when empty', () => {
    const empty = summarize([]);
    expect(empty.n).toBe(0);
    expect(empty.p95).toBeNaN();
    expect(empty.mean).toBeNaN();
    expect(empty.max).toBeNaN();
  });
});

describe('normalizeSql and queryTimings', () => {
  it('collapses whitespace', () => {
    expect(normalizeSql('  select *\n\t from  users ')).toBe('select * from users');
  });

  it('summarises each statement, slowest p95 first', () => {
    const timings = queryTimings(
      new Map([
        ['fast', [1, 1, 2]],
        ['slow', [10, 20, 30]],
      ]),
    );
    expect(timings.map((t) => [t.query, t.p95, t.n])).toEqual([
      ['slow', 30, 3],
      ['fast', 2, 3],
    ]);
  });
});

const row = (queryid: string, times: number[], query = `q${queryid}`): StatementRow => {
  const calls = times.length;
  const total = times.reduce((a, b) => a + b, 0);
  const mean = total / calls;
  const stddev = Math.sqrt(times.reduce((a, t) => a + (t - mean) ** 2, 0) / calls);
  return {
    queryid,
    query,
    calls,
    totalMs: total,
    meanMs: mean,
    stddevMs: stddev,
    maxMs: Math.max(...times),
  };
};

describe('statementDeltas', () => {
  it('recovers the mean and stddev of the calls between two snapshots', () => {
    const early = [100, 100, 100];
    const phase = [2, 4, 4, 4, 5, 5, 7, 9];
    const [delta] = statementDeltas([row('1', early)], [row('1', [...early, ...phase])]);
    expect(delta?.calls).toBe(8);
    expect(delta?.meanMs).toBeCloseTo(5, 9);
    expect(delta?.stddevMs).toBeCloseTo(2, 9);
    // The max covers the early calls too, so it is not the phase's.
    expect(delta?.maxMs).toBeNull();
    expect(delta?.p95EstimateMs).toBeCloseTo(5 + 1.645 * 2, 9);
  });

  it('caps a new statement at its max and drops statements not run in the phase', () => {
    const deltas = statementDeltas(
      [row('idle', [3])],
      [row('idle', [3]), row('new', [1, 1, 1, 9], ' select  1 ')],
    );
    expect(deltas).toHaveLength(1);
    expect(deltas[0]).toMatchObject({ query: 'select 1', calls: 4, maxMs: 9 });
    expect(deltas[0]?.p95EstimateMs).toBeLessThanOrEqual(9);
  });

  it('never takes the square root of a rounding error below zero', () => {
    const constant = row('c', [2, 2]);
    const [delta] = statementDeltas([constant], [{ ...row('c', [2, 2, 2, 2]), stddevMs: 0 }]);
    expect(delta?.stddevMs).toBe(0);
  });

  it('orders the slowest first', () => {
    const deltas = statementDeltas([], [row('a', [1]), row('b', [40]), row('c', [5])]);
    expect(deltas.map((d) => d.query)).toEqual(['qb', 'qc', 'qa']);
  });
});

describe('checkBudget', () => {
  it('passes strictly under the budget only when measured', () => {
    expect(checkBudget('x', 199.9, 200).pass).toBe(true);
    expect(checkBudget('x', 200, 200).pass).toBe(false);
    expect(checkBudget('x', Number.NaN, 200).pass).toBe(false);
    expect(checkBudget('x', 1, 2, 'why')).toMatchObject({ note: 'why' });
    expect(checkBudget('x', 1, 2)).not.toHaveProperty('note');
  });
});

const result = (overrides: Partial<PerfSmokeResult> = {}): PerfSmokeResult => ({
  startedAt: new Date('2026-10-25T10:00:00.000Z'),
  config: { 'Requests in flight': 4 },
  seed: { users: 10_000, created: 10_000, ms: 12_345 },
  orderAck: summarize([10, 20, 30]),
  pinLogin: summarize([40, 50, 60]),
  pgStatStatements: {
    available: true,
    statements: statementDeltas([], [row('1', [1, 2, 3], 'select | from `users`')]),
  },
  clientQueries: queryTimings(new Map([['select 1', [4, 5]]])),
  failures: [],
  ...overrides,
});

describe('evaluateBudgets', () => {
  it('passes a result inside every budget, judging queries on pg_stat_statements', () => {
    const budgets = evaluateBudgets(result());
    expect(budgets.map((b) => [b.name, b.pass])).toEqual([
      ['MARKET order ack p95', true],
      ['PIN login p95', true],
      ['Slowest query p95', true],
    ]);
    expect(budgets[2]?.note).toContain('pg_stat_statements');
    expect(budgets.map((b) => b.budgetMs)).toEqual([
      PERF_BUDGETS_MS.orderAckP95,
      PERF_BUDGETS_MS.pinLoginP95,
      PERF_BUDGETS_MS.slowestQueryP95,
    ]);
  });

  it('fails a slow route, and a route with failed requests whatever its p95', () => {
    const budgets = evaluateBudgets(
      result({ orderAck: summarize([10, 400]), pinLogin: summarize([1], 2) }),
    );
    expect(budgets[0]?.pass).toBe(false);
    expect(budgets[1]).toMatchObject({ pass: false, note: '2 requests failed' });
  });

  it('falls back to the client-side timings without pg_stat_statements', () => {
    const budgets = evaluateBudgets(
      result({
        pgStatStatements: { available: false, reason: 'not preloaded' },
        clientQueries: queryTimings(new Map([['slow', [80]]])),
      }),
    );
    expect(budgets[2]).toMatchObject({ actualMs: 80, pass: false });
    expect(budgets[2]?.note).toContain('client-side');
  });

  it('fails the query budget when nothing was measured', () => {
    const budgets = evaluateBudgets(
      result({ pgStatStatements: { available: true, statements: [] }, clientQueries: [] }),
    );
    expect(budgets[2]?.pass).toBe(false);
  });
});

describe('renderReport', () => {
  it('prints the verdict, budgets, routes, both query tables and the set-up', () => {
    const report = renderReport(result());
    expect(report).toContain('# Performance smoke (T-243)');
    expect(report).toContain('**PASS**');
    expect(report).toContain('| MARKET order ack p95 | 30.0 ms | < 300 ms | pass |');
    expect(report).toContain('| PIN login (`POST /v1/auth/pin/verify`) | 3 | 0 | 50.0 ms |');
    // Pipes and backticks in SQL cannot break the table.
    expect(report).toContain("`select \\| from 'users'`");
    expect(report).toContain('| `select 1` | 2 |');
    expect(report).toContain('| Seeded users | 10000 (10000 created this run, 12345.0 ms) |');
    expect(report).toContain('| Requests in flight | 4 |');
    expect(report).not.toContain('First failures');
  });

  it('says FAIL, lists failures, explains a missing pg_stat_statements and shortens long SQL', () => {
    const report = renderReport(
      result({
        orderAck: summarize([], 1),
        failures: ['MARKET order: 400 MARKET_CLOSED'],
        pgStatStatements: { available: false, reason: 'not in shared_preload_libraries' },
        clientQueries: queryTimings(new Map([[`select ${'x, '.repeat(100)}1`, [1]]])),
      }),
    );
    expect(report).toContain('**FAIL**');
    expect(report).toContain('| MARKET order ack p95 | — | < 300 ms | FAIL | 1 requests failed |');
    expect(report).toContain('- MARKET order: 400 MARKET_CLOSED');
    expect(report).toContain('Unavailable: not in shared_preload_libraries');
    expect(report).toContain('…`');
  });

  it('notes an empty pg_stat_statements phase', () => {
    const report = renderReport(result({ pgStatStatements: { available: true, statements: [] } }));
    expect(report).toContain('No statements were recorded.');
  });
});
