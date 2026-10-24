import { describe, expect, it } from 'vitest';
import {
  CreatePriceAlertRequest,
  MarkNotificationsReadRequest,
  Notification,
  PriceAlert,
} from './alerts.js';
import { WsServerMessage } from './ws.js';

const alert = {
  id: 'alert-1',
  token: 1594,
  symbol: 'INFY',
  exchange: 'NSE',
  condition: 'ABOVE',
  price: 153_000,
  note: null,
  status: 'ACTIVE',
  createdAt: '2026-10-24T05:00:00.000Z',
  createdLtp: 152_340,
  triggeredAt: null,
  triggeredLtp: null,
} as const;

describe('price alerts (NSTOCK-0344)', () => {
  it('round-trips an alert and fills in NSE', () => {
    expect(PriceAlert.parse(alert)).toEqual(alert);
    expect(
      CreatePriceAlertRequest.parse({ symbol: 'INFY', condition: 'BELOW', price: 150_000 }),
    ).toEqual({ symbol: 'INFY', exchange: 'NSE', condition: 'BELOW', price: 150_000 });
  });

  it('needs a price on the 5-paise tick and a short note', () => {
    const base = { symbol: 'INFY', condition: 'ABOVE' };
    expect(CreatePriceAlertRequest.safeParse({ ...base, price: 153_002 }).success).toBe(false);
    expect(CreatePriceAlertRequest.safeParse({ ...base, price: 0 }).success).toBe(false);
    expect(
      CreatePriceAlertRequest.safeParse({ ...base, price: 153_000, note: 'x'.repeat(81) }).success,
    ).toBe(false);
  });

  it('marks all notifications read when no ids are given, never an empty list', () => {
    expect(MarkNotificationsReadRequest.parse({})).toEqual({});
    expect(MarkNotificationsReadRequest.safeParse({ ids: [] }).success).toBe(false);
  });

  it('carries a notification and its alert over the socket', () => {
    const notification = {
      id: 'n-1',
      kind: 'PRICE_ALERT',
      title: 'INFY crossed above ₹1,530.00',
      body: 'Now ₹1,531.20',
      symbol: 'INFY',
      exchange: 'NSE',
      at: '2026-10-24T05:10:00.000Z',
      read: false,
    } as const;
    expect(Notification.parse(notification)).toEqual(notification);
    const message = WsServerMessage.parse({
      v: 1,
      type: 'notification',
      notification,
      alert: { ...alert, status: 'TRIGGERED', triggeredAt: notification.at, triggeredLtp: 153_120 },
    });
    expect(message.type).toBe('notification');
  });
});
