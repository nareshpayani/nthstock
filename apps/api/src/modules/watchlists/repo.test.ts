import { WATCHLIST_MAX_ITEMS, type Instrument } from '@nthstock/contracts';
import { expect, it } from 'vitest';
import { createPiiCrypto, devPiiKeys } from '../../db/crypto.js';
import { ApiHttpError } from '../../http/apiError.js';
import { describeRepoConformance } from '../../test/conformance.js';
import { manualClock } from '../../test/manualClock.js';
import { createPgUsersRepo } from '../users/pgRepo.js';
import { DEMO_USER } from '../users/repo.js';
import { UnknownWatchlistUserError, createPgWatchlistsRepo } from './pgRepo.js';
import { createMemoryWatchlistsRepo, type WatchlistsRepo } from './repo.js';
import type { WatchlistItemRecord, WatchlistRecord } from './schema.js';
import { createWatchlistService } from './service.js';

// The watchlists repo conformance suite (T-197): the memory repo and the Postgres repo behave the
// same, including the 50-stock limit under 20 concurrent adds.

const clock = manualClock('2026-09-28T04:30:00.000Z');
const at = (iso: string) => new Date(iso);
const USERS = ['usr_a', 'usr_b'] as const;

const item = (token: number, addedAt = '2026-09-28T04:30:00.000Z'): WatchlistItemRecord => ({
  token,
  symbol: `SYM${String(token)}`,
  exchange: token % 2 === 0 ? 'BSE' : 'NSE',
  name: `Company ${String(token)}`,
  addedAt: at(addedAt),
});

const list = (
  id: string,
  name: string,
  tokens: number[] = [],
  userId: string = 'usr_a',
): WatchlistRecord => ({
  id,
  userId,
  name,
  items: tokens.map((token) => item(token)),
  createdAt: at('2026-09-28T04:30:00.000Z'),
  updatedAt: at('2026-09-28T04:31:00.000Z'),
});

/** Stores `lists` as the user's lists. */
const store = (repo: WatchlistsRepo, userId: string, lists: WatchlistRecord[]) =>
  repo.update(userId, () => ({ lists, result: undefined }));

/** The user's stored lists (null when they never had any), without changing them. */
const read = (repo: WatchlistsRepo, userId: string) =>
  repo.update(userId, (lists) => ({ lists: lists ?? [], result: lists }));

const instrument = (token: number): Instrument => ({
  token,
  symbol: `SYM${String(token)}`,
  exchange: 'NSE',
  name: `Company ${String(token)}`,
  type: 'EQUITY',
  isin: null,
  sector: null,
  lotSize: 1,
  tickSize: 5,
});

describeRepoConformance(
  'watchlists repo',
  {
    memory: () => createMemoryWatchlistsRepo(),
    postgres: async (database) => {
      // Lists belong to users (foreign key).
      const users = createPgUsersRepo({ database, clock, pii: createPiiCrypto(devPiiKeys()) });
      for (const [index, id] of USERS.entries()) {
        await users.ensureSeeded({ ...DEMO_USER, id, mobile: `900000020${String(index)}` });
      }
      return createPgWatchlistsRepo({ database });
    },
  },
  ({ driver, repo }) => {
    it('gives null to a user who never had lists and resolves to the change result', async () => {
      const result = await repo().update('usr_a', (lists) => ({
        lists: [],
        result: { seen: lists },
      }));
      expect(result).toEqual({ seen: null });
    });

    it('stores lists and stocks in order with their times', async () => {
      const lists = [list('wl_1', 'My Watchlist', [5, 3, 9]), list('wl_2', 'Banks', [2])];
      await store(repo(), 'usr_a', lists);

      expect(await read(repo(), 'usr_a')).toEqual(lists);
    });

    it('keeps each user’s lists apart', async () => {
      await store(repo(), 'usr_a', [list('wl_1', 'Mine', [1])]);
      await store(repo(), 'usr_b', [list('wl_2', 'Mine', [2], 'usr_b')]);

      expect(await read(repo(), 'usr_a')).toEqual([list('wl_1', 'Mine', [1])]);
      expect(await read(repo(), 'usr_b')).toEqual([list('wl_2', 'Mine', [2], 'usr_b')]);
    });

    it('reorders lists and stocks, renames, and adds and removes stocks', async () => {
      await store(repo(), 'usr_a', [
        list('wl_1', 'One', [1, 2, 3, 4]),
        list('wl_2', 'Two', [5]),
        list('wl_3', 'Three'),
      ]);
      const next = [
        list('wl_3', 'three', [8]),
        { ...list('wl_1', 'One', [4, 1, 3, 7]), updatedAt: at('2026-09-28T05:00:00.000Z') },
        list('wl_2', 'Two', [5]),
      ];
      await store(repo(), 'usr_a', next);

      expect(await read(repo(), 'usr_a')).toEqual(next);
    });

    it('deletes a list with its stocks, and its name can be reused at once', async () => {
      await store(repo(), 'usr_a', [list('wl_1', 'One', [1, 2]), list('wl_2', 'Banks', [3])]);
      const next = [list('wl_1', 'One', [1, 2]), list('wl_3', 'BANKS', [3])];
      await store(repo(), 'usr_a', next);

      expect(await read(repo(), 'usr_a')).toEqual(next);
    });

    it('stores nothing and rejects with the error when the change throws', async () => {
      const before = [list('wl_1', 'One', [1])];
      await store(repo(), 'usr_a', before);
      const failure = new Error('refused');

      await expect(
        repo().update('usr_a', (lists) => {
          lists?.[0]?.items.push(item(2));
          throw failure;
        }),
      ).rejects.toBe(failure);
      expect(await read(repo(), 'usr_a')).toEqual(before);
    });

    it('hands the change a copy: a record held after the call cannot change storage', async () => {
      await store(repo(), 'usr_a', [list('wl_1', 'One')]);
      const held = await repo().update('usr_a', (lists) => ({
        lists: lists ?? [],
        result: lists?.[0],
      }));
      held?.items.push(item(1));

      expect(await read(repo(), 'usr_a')).toEqual([list('wl_1', 'One')]);
    });

    it('holds the 50-stock limit under 20 concurrent adds to a list of 45', async () => {
      const master = Array.from({ length: 80 }, (_, i) => instrument(i + 1));
      const service = createWatchlistService({
        clock,
        repo: repo(),
        market: { listInstruments: () => Promise.resolve(master) },
        newId: () => 'wl_race',
      });
      await store(repo(), 'usr_a', [
        list(
          'wl_race',
          'Race',
          Array.from({ length: 45 }, (_, i) => i + 1),
        ),
      ]);

      const results = await Promise.allSettled(
        Array.from({ length: 20 }, (_, i) => service.addItem('usr_a', 'wl_race', 46 + i)),
      );

      const refused = results.flatMap((r) => (r.status === 'rejected' ? [r.reason] : []));
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(5);
      expect(refused).toHaveLength(15);
      for (const reason of refused) {
        expect(reason).toBeInstanceOf(ApiHttpError);
        expect(reason).toMatchObject({ status: 409, code: 'LIMIT_REACHED' });
      }
      const [stored] = (await read(repo(), 'usr_a')) ?? [];
      expect(stored?.items).toHaveLength(WATCHLIST_MAX_ITEMS);
      expect(new Set(stored?.items.map((i) => i.token)).size).toBe(WATCHLIST_MAX_ITEMS);
    });

    if (driver === 'postgres') {
      it('refuses lists for a user that is not stored', async () => {
        await expect(store(repo(), 'usr_missing', [list('wl_1', 'One')])).rejects.toBeInstanceOf(
          UnknownWatchlistUserError,
        );
      });

      it('refuses two lists whose names differ only in case, storing neither change', async () => {
        await store(repo(), 'usr_a', [list('wl_1', 'One')]);
        await expect(
          store(repo(), 'usr_a', [list('wl_1', 'One'), list('wl_2', 'ONE')]),
        ).rejects.toThrow();
        expect(await read(repo(), 'usr_a')).toEqual([list('wl_1', 'One')]);
      });

      it('does not reset (tests truncate instead)', async () => {
        await expect(repo().reset()).rejects.toThrow('truncate');
      });
    }
  },
);
