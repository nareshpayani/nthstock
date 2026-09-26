import { fromIst, fixedClock } from '@nthstock/utils';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { marketStatusView } from '../model/marketStatusText';
import { MarketStatusPill } from './MarketStatusPill';

// 2026-09-25 is a Friday; 2026-10-02 (Friday) is Gandhi Jayanti.
const at = (day: number, month: number, minuteOfDay: number) =>
  fixedClock(fromIst(2026, month, day, minuteOfDay));

describe('marketStatusView (fixed IST clocks)', () => {
  it('open during the session', () => {
    expect(marketStatusView(at(25, 9, 10 * 60))).toEqual({
      tone: 'open',
      label: 'Market open',
      detail: 'closes 3:30 pm IST',
    });
  });

  it('pre-open between 9:00 and 9:15', () => {
    expect(marketStatusView(at(25, 9, 9 * 60 + 5))).toEqual({
      tone: 'preOpen',
      label: 'Pre-open',
      detail: 'opens today 9:15 am IST',
    });
  });

  it('closed before hours opens today', () => {
    expect(marketStatusView(at(25, 9, 8 * 60)).detail).toBe('opens today 9:15 am IST');
  });

  it('closed after hours on a Thursday opens tomorrow', () => {
    expect(marketStatusView(at(24, 9, 16 * 60))).toEqual({
      tone: 'closed',
      label: 'Market closed',
      detail: 'opens tomorrow 9:15 am IST',
    });
  });

  it('closed on Friday evening opens Monday', () => {
    expect(marketStatusView(at(25, 9, 15 * 60 + 31)).detail).toBe('opens Mon 9:15 am IST');
  });

  it('closed on a weekend', () => {
    expect(marketStatusView(at(26, 9, 11 * 60))).toMatchObject({
      tone: 'closed',
      detail: 'opens Mon 9:15 am IST',
    });
  });

  it('holiday shows its name and the next open', () => {
    expect(marketStatusView(at(2, 10, 11 * 60))).toEqual({
      tone: 'holiday',
      label: 'Holiday: Mahatma Gandhi Jayanti',
      detail: 'opens Mon 9:15 am IST',
    });
  });
});

describe('MarketStatusPill', () => {
  it('renders text for the state, not only a colour', () => {
    render(<MarketStatusPill clock={at(25, 9, 10 * 60)} />);
    const pill = screen.getByRole('status', {
      name: 'NSE market status: Market open, closes 3:30 pm IST',
    });
    expect(pill).toHaveTextContent('Market open');
    expect(pill).toHaveTextContent('closes 3:30 pm IST');
  });

  it('compact hides the detail visually but keeps it in the label', () => {
    render(<MarketStatusPill clock={at(2, 10, 11 * 60)} compact />);
    const pill = screen.getByRole('status');
    expect(pill).toHaveTextContent('Holiday: Mahatma Gandhi Jayanti');
    expect(pill).not.toHaveTextContent('opens');
    expect(pill).toHaveAccessibleName(/opens Mon 9:15 am IST/);
  });
});
