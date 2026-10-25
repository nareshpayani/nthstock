import {
  NOTIFICATION_EVENT_VERSION,
  notifyChannel,
  type NotificationEvent,
} from '@nthstock/contracts';
import { describe, expect, it, vi } from 'vitest';
import { manualClock } from '../../test/manualClock.js';
import type { Publisher } from '../../ticks/publisher.js';
import { createNotifier } from './notifier.js';
import { OUTBOX_RELAY_MS, startNotificationPublisher } from './publisher.js';
import { createMemoryNotificationsRepo } from './repo.js';
import type { NewNotification } from './schema.js';

// Publishing notifications and the outbox relay (NSTOCK-0380).

const note = (userId: string): NewNotification => ({
  userId,
  kind: 'PRICE_ALERT',
  refId: 'al_1',
  title: 'INFY crossed above ₹1,530.00',
  body: 'Now ₹1,531.20',
  symbol: 'INFY',
  exchange: 'NSE',
});

function recorder(fail = () => false) {
  const sent: { channel: string; event: NotificationEvent }[] = [];
  const publisher: Publisher = {
    publish(channel, message) {
      if (fail()) return Promise.reject(new Error('redis down'));
      sent.push({ channel, event: JSON.parse(message) as NotificationEvent });
      return Promise.resolve();
    },
    close: () => Promise.resolve(),
  };
  return { publisher, sent };
}

const setup = (fail?: () => boolean) => {
  const clock = manualClock('2026-10-25T04:30:00.000Z');
  const repo = createMemoryNotificationsRepo({ clock });
  const notifier = createNotifier({ repo });
  const { publisher, sent } = recorder(fail);
  const log = { info: vi.fn(), warn: vi.fn() };
  const now = () => clock.now().getTime();
  return { clock, repo, notifier, publisher, sent, log, now };
};

describe('notification publisher (NSTOCK-0380)', () => {
  it("publishes a committed notification on its user's channel and clears its outbox row", async () => {
    const { repo, notifier, publisher, sent, log, now } = setup();
    const running = startNotificationPublisher({ notifier, publisher, log, relayMs: null, now });
    const [stored] = await notifier.raise([note('usr_a')]);

    await vi.waitFor(async () => {
      expect(await repo.outboxSize()).toBe(0);
    });
    expect(sent).toEqual([
      {
        channel: notifyChannel('usr_a'),
        event: {
          v: NOTIFICATION_EVENT_VERSION,
          userId: 'usr_a',
          notification: stored?.notification,
        },
      },
    ]);
    running.stop();
  });

  it('relays what a crash between commit and publish left in the outbox', async () => {
    const { clock, repo, notifier, publisher, sent, log, now } = setup();
    // No publisher is listening: the process "crashed" after the commit.
    await notifier.raise([note('usr_a'), note('usr_b')]);
    const running = startNotificationPublisher({ notifier, publisher, log, relayMs: null, now });

    expect(await running.relay()).toBe(0); // too young: the writer may still publish them
    clock.advance(OUTBOX_RELAY_MS + 1);
    expect(await running.relay()).toBe(2);
    expect(sent.map((s) => s.event.userId)).toEqual(['usr_a', 'usr_b']);
    expect(await repo.outboxSize()).toBe(0);
    expect(await running.relay()).toBe(0);
    running.stop();
  });

  it('keeps rows through a Redis outage, logs it once, and relays them after it', async () => {
    let down = true;
    const { clock, repo, notifier, publisher, sent, log, now } = setup(() => down);
    const running = startNotificationPublisher({ notifier, publisher, log, relayMs: null, now });
    await notifier.raise([note('usr_a')]);
    await notifier.raise([note('usr_a')]);
    clock.advance(OUTBOX_RELAY_MS + 1);
    expect(await running.relay()).toBe(0);
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(await repo.outboxSize()).toBe(2);

    down = false;
    expect(await running.relay()).toBe(2);
    expect(sent).toHaveLength(2);
    expect(log.info).toHaveBeenCalledWith('Notification publishing recovered');
    running.stop();
  });

  it('stops publishing once stopped', async () => {
    const { notifier, publisher, sent, log, now } = setup();
    startNotificationPublisher({ notifier, publisher, log, relayMs: null, now }).stop();
    await notifier.raise([note('usr_a')]);
    await Promise.resolve();
    expect(sent).toEqual([]);
  });
});
