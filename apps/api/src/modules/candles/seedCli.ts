import { parseArgs } from 'node:util';
import { generateSymbolMaster } from '@nthstock/marketData';
import { fixedClock, systemClock } from '@nthstock/utils';
import { z } from 'zod';
import { createDatabase } from '../../db/client.js';
import { refreshWithOwner, seedCandles } from './seed.js';
import { createPgCandleStore } from './store.js';

// `npm run db:seed:candles -w @nthstock/api [-- --all] [-- --as-of=2026-10-23T12:00:00Z]`
// (NSTOCK-0374): writes the candle history as the app role (DATABASE_URL), then refreshes the
// continuous aggregates as their owner when DATABASE_MIGRATION_URL is set (the app role may not).

const PgUrl = z.url({ protocol: /^postgres(ql)?$/ });

const { values } = parseArgs({
  options: {
    all: { type: 'boolean', default: false },
    'as-of': { type: 'string' },
  },
});

const appUrl = PgUrl.safeParse(process.env.DATABASE_URL?.trim());
if (!appUrl.success) {
  process.stderr.write(
    'DATABASE_URL must be a postgres:// URL for the nthstock_app role (see apps/api/.env.example).\n',
  );
  process.exit(1);
}
const ownerRaw = process.env.DATABASE_MIGRATION_URL?.trim();
const ownerUrl = ownerRaw ? PgUrl.safeParse(ownerRaw) : null;
if (ownerUrl && !ownerUrl.success) {
  process.stderr.write('DATABASE_MIGRATION_URL must be a postgres:// URL when set.\n');
  process.exit(1);
}
const asOf = values['as-of'] === undefined ? null : new Date(values['as-of']);
if (asOf && Number.isNaN(asOf.getTime())) {
  process.stderr.write(`--as-of must be an ISO date-time, got ${values['as-of'] ?? ''}\n`);
  process.exit(1);
}

const database = createDatabase({
  url: appUrl.data,
  poolMax: 2,
  statementTimeoutMs: 60_000,
  applicationName: 'nthstock-seed',
});
try {
  const started = Date.now();
  const summary = await seedCandles({
    store: createPgCandleStore({ database }),
    master: generateSymbolMaster(),
    clock: asOf ? fixedClock(asOf) : systemClock,
    symbols: values.all ? 'all' : 'default',
    ...(ownerUrl?.success ? { refresh: refreshWithOwner(ownerUrl.data) } : {}),
    onProgress: (done, total) => {
      if (done % 250 === 0 || done === total) {
        process.stdout.write(`  ${String(done)}/${String(total)} instruments\n`);
      }
    },
  });
  const day = (date: Date) => date.toISOString().slice(0, 10);
  process.stdout.write(
    `Seeded ${String(summary.rows)} candle rows for ${String(summary.symbols)} instruments ` +
      `(${String(summary.minuteSymbols)} with 1-minute bars), sessions ${day(summary.from)} to ` +
      `${day(summary.to)}, in ${String(Math.round((Date.now() - started) / 1000))} s.\n` +
      (summary.refreshed
        ? 'Continuous aggregates refreshed.\n'
        : 'DATABASE_MIGRATION_URL not set: aggregates not refreshed; reads use real-time aggregation.\n'),
  );
} catch (error) {
  process.stderr.write(
    `Candle seed failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
} finally {
  await database.close();
}
