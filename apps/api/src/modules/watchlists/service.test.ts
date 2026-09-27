import { WATCHLIST_MAX_ITEMS, WATCHLIST_MESSAGES, type Instrument } from '@nthstock/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import { ApiHttpError } from '../../http/apiError.js';
import { manualClock, type ManualClock } from '../../test/manualClock.js';
import { createMemoryWatchlistsRepo, type WatchlistsRepo } from './repo.js';
import { createWatchlistService, type WatchlistService } from './service.js';

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
const MASTER = Array.from({ length: 60 }, (_, i) => instrument(i + 1));

let clock: ManualClock;
let repo: WatchlistsRepo;
let service: WatchlistService;
let listCalls: number;

beforeEach(() => {
  clock = manualClock();
  repo = createMemoryWatchlistsRepo();
  listCalls = 0;
  let next = 0;
  service = createWatchlistService({
    clock,
    repo,
    market: {
      listInstruments: () => {
        listCalls += 1;
        return Promise.resolve(MASTER);
      },
    },
    newId: () => `wl_${String((next += 1))}`,
  });
});

const rejection = async (pending: Promise<unknown>) => {
  const error: unknown = await pending.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ApiHttpError);
  const { status, code, message } = error as ApiHttpError;
  return { status, code, message };
};

describe('watchlist service', () => {
  it('creates "My Watchlist" once, on the first call, per user', async () => {
    const [first] = await service.list('usr_a');
    expect(first).toEqual({
      id: 'wl_1',
      name: 'My Watchlist',
      items: [],
      createdAt: '2026-09-25T04:00:00.000Z',
      updatedAt: '2026-09-25T04:00:00.000Z',
    });
    expect((await service.list('usr_a')).map((l) => l.id)).toEqual(['wl_1']);
    expect((await service.list('usr_b')).map((l) => l.id)).toEqual(['wl_2']);
  });

  it('stamps updatedAt on item changes and keeps createdAt', async () => {
    await service.list('usr_a');
    clock.advance(60_000);
    const added = await service.addItem('usr_a', 'wl_1', 7);
    expect(added.createdAt).toBe('2026-09-25T04:00:00.000Z');
    expect(added.updatedAt).toBe('2026-09-25T04:01:00.000Z');
    expect(added.items[0]).toEqual({
      token: 7,
      symbol: 'SYM7',
      exchange: 'NSE',
      name: 'Company 7',
      addedAt: '2026-09-25T04:01:00.000Z',
    });
  });

  it('reads the symbol master once', async () => {
    await service.list('usr_a');
    await service.addItem('usr_a', 'wl_1', 1);
    await service.addItem('usr_a', 'wl_1', 2);
    expect(listCalls).toBe(1);
  });

  it('holds the 50-stock limit when adds race', async () => {
    await service.list('usr_a');
    const results = await Promise.allSettled(
      MASTER.slice(0, WATCHLIST_MAX_ITEMS + 5).map((i) =>
        service.addItem('usr_a', 'wl_1', i.token),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(WATCHLIST_MAX_ITEMS);
    const [list] = await service.list('usr_a');
    expect(list?.items).toHaveLength(WATCHLIST_MAX_ITEMS);
  });

  it('answers a duplicate before the limit, and an unknown list before an unknown stock', async () => {
    await service.list('usr_a');
    await service.addItem('usr_a', 'wl_1', 1);
    expect(await rejection(service.addItem('usr_a', 'wl_1', 1))).toEqual({
      status: 409,
      code: 'CONFLICT',
      message: WATCHLIST_MESSAGES.duplicateItem('SYM1'),
    });
    expect(await rejection(service.addItem('usr_a', 'wl_nope', 9999))).toMatchObject({
      status: 404,
      message: WATCHLIST_MESSAGES.notFound,
    });
    expect(await rejection(service.addItem('usr_a', 'wl_1', 9999))).toMatchObject({
      status: 404,
      message: WATCHLIST_MESSAGES.unknownStock,
    });
  });

  it('leaves the lists untouched when a change fails', async () => {
    await service.list('usr_a');
    await service.create('usr_a', 'Banks');
    await rejection(service.rename('usr_a', 'wl_2', 'my watchlist'));
    await rejection(service.reorder('usr_a', ['wl_2']));
    const lists = await service.list('usr_a');
    expect(lists.map((l) => [l.id, l.name])).toEqual([
      ['wl_1', 'My Watchlist'],
      ['wl_2', 'Banks'],
    ]);
  });
});

describe('memory watchlists repo', () => {
  it('stores a copy, so a caller holding a record cannot change stored state', async () => {
    await service.list('usr_a');
    const held = await repo.update('usr_a', (lists) => {
      const stored = lists ?? [];
      return { lists: stored, result: stored[0] };
    });
    held?.items.push({
      token: 1,
      symbol: 'SYM1',
      exchange: 'NSE',
      name: 'x',
      addedAt: clock.now(),
    });
    const [list] = await service.list('usr_a');
    expect(list?.items).toEqual([]);
  });

  it('turns a non-Error throw into an Error and resets to empty', async () => {
    await expect(
      repo.update('usr_a', () => {
        throw 'boom';
      }),
    ).rejects.toThrow('boom');
    await service.list('usr_a');
    await repo.reset();
    expect(
      await repo.update('usr_a', (lists) => ({ lists: lists ?? [], result: lists })),
    ).toBeNull();
  });
});
