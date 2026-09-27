import { describe, expect, it } from 'vitest';
import { manualClock } from '../../test/manualClock.js';
import { createMemoryAuditRepo } from './repo.js';

describe('in-memory audit log', () => {
  it('appends frozen, timestamped entries and lists them in order, per user', async () => {
    const clock = manualClock('2026-09-28T04:30:00.000Z');
    const audit = createMemoryAuditRepo({ clock });
    const first = audit.append({
      actor: { type: 'user', userId: 'usr_a' },
      userId: 'usr_a',
      action: 'ORDER_PLACE',
      orderId: 'o1',
      outcome: 'OK',
      detail: { status: 'OPEN' },
    });
    clock.advance(1_000);
    audit.append({
      actor: { type: 'system' },
      userId: 'usr_b',
      action: 'ORDER_UPDATE',
      orderId: 'o2',
      outcome: 'OK',
      detail: {},
    });

    expect(first.id).toMatch(/^aud_[0-9a-f]{32}$/);
    expect(first.at.toISOString()).toBe('2026-09-28T04:30:00.000Z');
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.detail)).toBe(true);
    expect(() => {
      (first as { outcome: string }).outcome = 'REFUSED';
    }).toThrow(TypeError);
    expect((await audit.list()).map((e) => e.orderId)).toEqual(['o1', 'o2']);
    expect((await audit.list('usr_b')).map((e) => e.orderId)).toEqual(['o2']);

    await audit.reset();
    expect(await audit.list()).toEqual([]);
  });
});
