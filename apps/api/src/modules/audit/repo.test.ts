import { describe, expect, it } from 'vitest';
import { describeRepoConformance } from '../../test/conformance.js';
import { manualClock, type ManualClock } from '../../test/manualClock.js';
import { AuditDetailRefusedError, assertAuditDetailAllowed } from './detail.js';
import { createPgAuditRepo } from './pgRepo.js';
import { createMemoryAuditRepo } from './repo.js';
import type { NewAuditRecord } from './schema.js';

// The audit repo conformance suite (T-187): the memory log and the Postgres log behave the same.

let clock: ManualClock = manualClock('2026-09-28T04:30:00.000Z');
const freshClock = () => {
  clock = manualClock('2026-09-28T04:30:00.000Z');
  return clock;
};

const place: NewAuditRecord = {
  actor: { type: 'user', userId: 'usr_a' },
  userId: 'usr_a',
  action: 'ORDER_PLACE',
  orderId: 'o1',
  outcome: 'OK',
  detail: { request: { instrument: 2885, side: 'BUY', qty: 1 }, status: 'OPEN' },
};

const fill: NewAuditRecord = {
  actor: { type: 'system' },
  userId: 'usr_b',
  action: 'ORDER_UPDATE',
  orderId: 'o2',
  outcome: 'OK',
  detail: {},
};

describeRepoConformance(
  'audit repo',
  {
    memory: () => createMemoryAuditRepo({ clock: freshClock() }),
    postgres: (database) => createPgAuditRepo({ database, clock: freshClock() }),
  },
  ({ driver, repo }) => {
    it('appends timestamped, frozen entries and lists them in order, per user', async () => {
      const first = await repo().append(place);
      clock.advance(1_000);
      const second = await repo().append({ ...fill, requestId: 'req-7' });

      expect(first).toEqual({
        ...place,
        id: expect.any(String) as string,
        at: new Date('2026-09-28T04:30:00.000Z'),
        requestId: null,
      });
      expect(second).toMatchObject({ actor: { type: 'system' }, requestId: 'req-7' });
      expect(second.at.toISOString()).toBe('2026-09-28T04:30:01.000Z');
      expect(Number(second.id)).toBeGreaterThan(Number(first.id));
      expect(Object.isFrozen(first)).toBe(true);
      expect(Object.isFrozen(first.detail)).toBe(true);
      expect(Object.isFrozen(first.detail['request'])).toBe(true);
      expect(() => {
        (first as { outcome: string }).outcome = 'REFUSED';
      }).toThrow(TypeError);

      expect(await repo().list()).toEqual([first, second]);
      expect(await repo().list('usr_b')).toEqual([second]);
      expect(await repo().list('usr_nobody')).toEqual([]);
    });

    it('keeps an entry with no user out of every per-user list', async () => {
      const failed = await repo().append({
        actor: { type: 'system' },
        userId: null,
        action: 'ORDER_UPDATE',
        orderId: null,
        outcome: 'REFUSED',
        detail: { reason: 'UNKNOWN' },
      });

      expect(failed.userId).toBeNull();
      expect(await repo().list()).toEqual([failed]);
      expect(await repo().list('usr_a')).toEqual([]);
    });

    it('stores detail as JSON: nested values survive, undefined drops out', async () => {
      const entry = await repo().append({
        ...fill,
        detail: { a: [1, 'two', null, { b: true }], price: 123_450, gone: undefined },
      });

      expect(entry.detail).toEqual({ a: [1, 'two', null, { b: true }], price: 123_450 });
      expect((await repo().list())[0]?.detail).toEqual(entry.detail);
    });

    it('appends a batch in order, with increasing ids, and an empty batch writes nothing', async () => {
      expect(await repo().appendMany([])).toEqual([]);

      const records = await repo().appendMany([place, fill, { ...place, orderId: 'o3' }]);

      expect(records.map((record) => record.orderId)).toEqual(['o1', 'o2', 'o3']);
      const ids = records.map((record) => Number(record.id));
      expect(ids).toEqual(ids.toSorted((a, b) => a - b));
      expect(new Set(ids).size).toBe(3);
      expect(await repo().list()).toEqual(records);
    });

    it('keeps every one of 20 concurrent appends, each with its own id', async () => {
      const records = await Promise.all(
        Array.from({ length: 20 }, (_, i) => repo().append({ ...place, orderId: `o${String(i)}` })),
      );

      expect(new Set(records.map((record) => record.id)).size).toBe(20);
      expect((await repo().list('usr_a')).length).toBe(20);
    });

    it('refuses a detail with a mobile key and writes nothing', async () => {
      await expect(
        repo().append({ ...place, detail: { mobile: '9876543210' } }),
      ).rejects.toMatchObject({ name: 'AuditDetailRefusedError', path: 'detail.mobile' });

      expect(await repo().list()).toEqual([]);
    });

    it('refuses denied keys at any depth, in any case, and the whole batch with them', async () => {
      const refused = [
        { request: { otp: '123456' } },
        { steps: [{ ok: true }, { refreshToken: 'x' }] },
        { PIN: '1234' },
        { totp_code: '000000' },
        { firstName: 'A' },
        { userEmail: 'a@b.c' },
        { clientSecret: 's' },
      ];
      for (const detail of refused) {
        await expect(repo().append({ ...place, detail })).rejects.toBeInstanceOf(
          AuditDetailRefusedError,
        );
      }
      await expect(
        repo().appendMany([place, { ...fill, detail: { device: { token: 't' } } }]),
      ).rejects.toMatchObject({ path: 'detail.device.token' });

      expect(await repo().list()).toEqual([]);
    });

    if (driver === 'memory') {
      it('forgets every entry on reset (memory only)', async () => {
        await repo().append(place);
        await repo().reset();

        expect(await repo().list()).toEqual([]);
        expect((await repo().append(fill)).id).toBe('1');
      });
    } else {
      it('refuses reset: nthstock_app cannot delete audit rows', async () => {
        await repo().append(place);

        await expect(repo().reset()).rejects.toThrow(/append-only/);
        expect((await repo().list()).length).toBe(1);
      });
    }
  },
);

describe('audit detail deny list', () => {
  it('allows the keys the order, funds and auth entries use', () => {
    expect(() => {
      assertAuditDetailAllowed({
        request: { instrument: 2885, side: 'BUY', type: 'LIMIT', qty: 1, price: 100 },
        status: 'OPEN',
        filledQty: 0,
        reason: 'PIN_INVALID',
        entryId: 'le_1',
        amount: -100,
        balanceAfter: 1,
        method: 'OTP',
        sessionId: 'ses_1',
        deviceId: 'dev_1',
        failures: 5,
      });
    }).not.toThrow();
  });

  it('names where the refused key is, never its value', () => {
    let error: unknown;
    try {
      assertAuditDetailAllowed({ request: [{}, { mobile: '9876543210' }] });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(AuditDetailRefusedError);
    expect((error as AuditDetailRefusedError).path).toBe('detail.request[1].mobile');
    expect((error as Error).message).not.toContain('9876543210');
  });
});
