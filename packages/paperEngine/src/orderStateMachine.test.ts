import { OrderStatus } from '@nthstock/contracts';
import { describe, expect, it } from 'vitest';
import {
  INITIAL_ORDER_STATUSES,
  ORDER_EVENTS,
  OrderTransitionError,
  illegalTransitionReason,
  isTerminalStatus,
  nextOrderStatus,
  transitionOrder,
  type OrderEvent,
} from './orderStateMachine.js';

const LEGAL: [OrderStatus, OrderEvent, OrderStatus][] = [
  ['AMO', 'RELEASE', 'OPEN'],
  ['AMO', 'MODIFY', 'AMO'],
  ['AMO', 'CANCEL', 'CANCELLED'],
  ['AMO', 'REJECT', 'REJECTED'],
  ['OPEN', 'FILL', 'EXECUTED'],
  ['OPEN', 'MODIFY', 'OPEN'],
  ['OPEN', 'CANCEL', 'CANCELLED'],
];

const isLegal = (status: OrderStatus, event: OrderEvent) =>
  LEGAL.some(([s, e]) => s === status && e === event);

// Every (status, event) pair that is not in LEGAL, generated so a new status or event is covered.
const ILLEGAL: [OrderStatus, OrderEvent][] = OrderStatus.options.flatMap((status) =>
  ORDER_EVENTS.filter((event) => !isLegal(status, event)).map(
    (event): [OrderStatus, OrderEvent] => [status, event],
  ),
);

describe('order state machine (T-128)', () => {
  it.each(LEGAL)('%s + %s → %s', (status, event, next) => {
    expect(nextOrderStatus(status, event)).toBe(next);
    expect(transitionOrder(status, event)).toBe(next);
  });

  it('covers all 25 status × event pairs between the two tables', () => {
    expect(LEGAL.length + ILLEGAL.length).toBe(OrderStatus.options.length * ORDER_EVENTS.length);
    expect(ILLEGAL).toHaveLength(18);
  });

  it.each(ILLEGAL)('rejects %s + %s', (status, event) => {
    expect(nextOrderStatus(status, event)).toBeNull();
    expect(() => transitionOrder(status, event)).toThrow(OrderTransitionError);
    try {
      transitionOrder(status, event);
    } catch (error) {
      expect(error).toMatchObject({ name: 'OrderTransitionError', status, event });
      expect((error as Error).message).toBe(illegalTransitionReason(status, event));
    }
  });

  it('allows modify only in AMO or OPEN', () => {
    const modifiable = OrderStatus.options.filter((s) => nextOrderStatus(s, 'MODIFY') !== null);
    expect(modifiable).toEqual(['AMO', 'OPEN']);
  });

  it('explains an illegal transition in plain language', () => {
    expect(illegalTransitionReason('EXECUTED', 'CANCEL')).toBe(
      "This order is already executed, so it can't be cancelled.",
    );
    expect(illegalTransitionReason('AMO', 'FILL')).toBe(
      "This order is waiting for the market to open, so it can't be filled.",
    );
    expect(illegalTransitionReason('REJECTED', 'MODIFY')).toBe(
      "This order is rejected, so it can't be modified.",
    );
    expect(illegalTransitionReason('OPEN', 'RELEASE')).toMatch(/open, so it can't be sent/);
    expect(illegalTransitionReason('CANCELLED', 'REJECT')).toMatch(
      /cancelled, so it can't be rejected/,
    );
  });

  it('knows terminal and initial statuses', () => {
    expect(OrderStatus.options.filter(isTerminalStatus)).toEqual([
      'EXECUTED',
      'CANCELLED',
      'REJECTED',
    ]);
    expect(INITIAL_ORDER_STATUSES).toEqual(['AMO', 'OPEN', 'REJECTED']);
  });
});
