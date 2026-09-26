import { afterEach, describe, expect, it } from 'vitest';
import { initialTicketIntentState, useTicketIntentStore } from './ticketIntentStore';

afterEach(() => {
  useTicketIntentStore.setState(initialTicketIntentState);
});

describe('ticketIntent store (T-106)', () => {
  it('starts closed, opens with the symbol and side, and closes', () => {
    expect(useTicketIntentStore.getState().intent).toBeNull();
    useTicketIntentStore.getState().openTicket({ symbol: 'INFY', exchange: 'NSE', side: 'BUY' });
    expect(useTicketIntentStore.getState().intent).toEqual({
      symbol: 'INFY',
      exchange: 'NSE',
      side: 'BUY',
    });
    useTicketIntentStore.getState().openTicket({ symbol: 'INFY', exchange: 'NSE', side: 'SELL' });
    expect(useTicketIntentStore.getState().intent?.side).toBe('SELL');
    useTicketIntentStore.getState().closeTicket();
    expect(useTicketIntentStore.getState().intent).toBeNull();
  });
});
