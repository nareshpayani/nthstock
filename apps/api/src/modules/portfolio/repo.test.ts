import { expect, it } from 'vitest';
import { createPiiCrypto, devPiiKeys } from '../../db/crypto.js';
import { describeRepoConformance } from '../../test/conformance.js';
import { manualClock } from '../../test/manualClock.js';
import { createPgUsersRepo } from '../users/pgRepo.js';
import { DEMO_USER } from '../users/repo.js';
import { createPgPnlSnapshotRepo } from './pgRepo.js';
import { createMemoryPnlSnapshotRepo, type PnlSnapshot, type PnlSnapshotRepo } from './repo.js';

// The P&L snapshot repo conformance suite (T-209): memory and Postgres upsert on
// (user_id, trade_date) the same way.

const clock = manualClock('2026-09-28T10:15:00.000Z');
const USERS = ['usr_a', 'usr_b'] as const;

const snapshot = (overrides: Partial<PnlSnapshot> = {}): PnlSnapshot => ({
  userId: 'usr_a',
  tradeDate: '2026-09-28',
  invested: 7_000_00,
  currentValue: 7_250_50,
  dayPnl: -120_25,
  realisedPnl: 50_00,
  totalPnl: 250_50,
  createdAt: new Date('2026-09-28T10:15:00.000Z'),
  ...overrides,
});

describeRepoConformance<PnlSnapshotRepo>(
  'P&L snapshot repo',
  {
    memory: () => createMemoryPnlSnapshotRepo(),
    postgres: async (database) => {
      // Snapshots belong to users (foreign key).
      const users = createPgUsersRepo({ database, clock, pii: createPiiCrypto(devPiiKeys()) });
      for (const [index, id] of USERS.entries()) {
        await users.ensureSeeded({ ...DEMO_USER, id, mobile: `900000040${String(index)}` });
      }
      return createPgPnlSnapshotRepo({ database });
    },
  },
  ({ repo }) => {
    it('finds nothing before a snapshot is written', async () => {
      expect(await repo().find('usr_a', '2026-09-28')).toBeNull();
    });

    it('writes a snapshot and reads it back', async () => {
      await repo().upsert(snapshot());
      expect(await repo().find('usr_a', '2026-09-28')).toEqual(snapshot());
    });

    it('replaces the row for the same user and trade date, and keeps others apart', async () => {
      await repo().upsert(snapshot());
      await repo().upsert(snapshot({ tradeDate: '2026-09-29', invested: 1_00 }));
      await repo().upsert(snapshot({ userId: 'usr_b', invested: 2_00 }));
      const rerun = snapshot({
        currentValue: 7_300_00,
        dayPnl: 10_00,
        realisedPnl: 0,
        totalPnl: 300_00,
        createdAt: new Date('2026-09-28T10:16:00.000Z'),
      });
      await repo().upsert(rerun);

      expect(await repo().find('usr_a', '2026-09-28')).toEqual(rerun);
      expect(await repo().find('usr_a', '2026-09-29')).toMatchObject({ invested: 1_00 });
      expect(await repo().find('usr_b', '2026-09-28')).toMatchObject({ invested: 2_00 });
    });
  },
);
