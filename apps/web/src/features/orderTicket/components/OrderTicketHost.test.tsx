import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initialTicketIntentState, useTicketIntentStore } from '@/shared/lib/ticketIntentStore';
import { SUCCESS_HOLD_MS, useSuccessHold } from '@/shared/motion/orderCues';
import { renderWithProviders } from '@/test/renderWithProviders';
import { resetSession, signIn } from '@/test/session';
import { OrderTicketHost } from './OrderTicketHost';

// The real ticket is a heavy chunk; a stand-in that holds its tick then closes is enough here.
vi.mock('./OrderTicket', () => ({
  OrderTicket: function FakeTicket({
    intent,
    onClose,
  }: {
    intent: { symbol: string };
    onClose: () => void;
  }) {
    const [, hold] = useSuccessHold();
    return (
      <button type="button" onClick={() => hold(onClose)}>
        place {intent.symbol}
      </button>
    );
  },
}));

describe('OrderTicketHost close after the success hold', () => {
  beforeEach(() => {
    signIn();
  });
  afterEach(() => {
    useTicketIntentStore.setState(initialTicketIntentState);
    resetSession();
    vi.useRealTimers();
  });

  it('closes its own ticket when the hold ends', async () => {
    renderWithProviders(<OrderTicketHost />);
    act(() =>
      useTicketIntentStore.getState().openTicket({ symbol: 'INFY', exchange: 'NSE', side: 'BUY' }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'place INFY' }));
    expect(useTicketIntentStore.getState().intent).not.toBeNull();
    await waitFor(() => expect(useTicketIntentStore.getState().intent).toBeNull(), {
      timeout: SUCCESS_HOLD_MS * 3,
    });
  });

  it('does not close a ticket opened for another symbol during the hold', async () => {
    renderWithProviders(<OrderTicketHost />);
    act(() =>
      useTicketIntentStore.getState().openTicket({ symbol: 'INFY', exchange: 'NSE', side: 'BUY' }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'place INFY' }));
    // The old ticket unmounts (its key changes), which runs its held close at once.
    act(() =>
      useTicketIntentStore.getState().openTicket({ symbol: 'TCS', exchange: 'NSE', side: 'SELL' }),
    );
    expect(await screen.findByRole('button', { name: 'place TCS' })).toBeInTheDocument();
    expect(useTicketIntentStore.getState().intent?.symbol).toBe('TCS');
  });
});
