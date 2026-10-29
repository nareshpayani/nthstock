import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TicketRuler, type TicketRulerProps } from './TicketRuler';

function setup(extra: Partial<TicketRulerProps> = {}) {
  const onQty = vi.fn();
  const onPrice = vi.fn();
  render(
    <TicketRuler
      field="qty"
      qty={10}
      onQty={onQty}
      price={150_000}
      onPrice={onPrice}
      fallbackPrice={149_000}
      tickSize={5}
      priceEnabled
      {...extra}
    />,
  );
  return { onQty, onPrice };
}

describe('TicketRuler (A8)', () => {
  it('sets quantity by default, one share per arrow', () => {
    const { onQty } = setup();
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Adjust quantity' }), {
      key: 'ArrowRight',
    });
    expect(onQty).toHaveBeenCalledWith(11);
  });

  it('sets price when price is the focused field, one tick per arrow', () => {
    const { onPrice } = setup({ field: 'price' });
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Adjust price' }), { key: 'ArrowRight' });
    expect(onPrice).toHaveBeenCalledWith(150_005);
  });

  it('keeps the ruler on quantity for a market order, even with price focused', () => {
    setup({ field: 'price', priceEnabled: false });
    expect(screen.getByRole('slider', { name: 'Adjust quantity' })).toBeInTheDocument();
    expect(screen.queryByRole('slider', { name: 'Adjust price' })).toBeNull();
  });

  it('starts the price ruler at the quote when no price is typed', () => {
    setup({ field: 'price', price: null });
    expect(screen.getByRole('slider', { name: 'Adjust price' })).toHaveAttribute(
      'aria-valuenow',
      '149000',
    );
  });

  it('shows a disabled price ruler, never the quantity one, with no price and no quote', () => {
    const { onQty, onPrice } = setup({ field: 'price', price: null, fallbackPrice: null });
    const slider = screen.getByRole('slider', { name: 'Adjust price' });
    expect(screen.queryByRole('slider', { name: 'Adjust quantity' })).toBeNull();
    expect(slider).toHaveAttribute('aria-disabled', 'true');
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(onQty).not.toHaveBeenCalled();
    expect(onPrice).not.toHaveBeenCalled();
  });
});
