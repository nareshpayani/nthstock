import type { Time } from 'lightweight-charts';
import { describe, expect, it } from 'vitest';
import { tooltipContent } from './chartTooltip';

// 2026-09-25 14:05 IST.
const time = (Date.parse('2026-09-25T08:35:00.000Z') / 1000) as Time;

describe('chart tooltip (T-107)', () => {
  it('shows an area point as en-IN grouped rupees with the IST time', () => {
    expect(tooltipContent({ time, value: 12345678 }, { format: 'inr', intraday: true })).toEqual({
      time: '25 Sept, 14:05',
      rows: [{ label: 'Price', value: '₹1,23,456.78' }],
    });
  });

  it('shows a candle as open, high, low and close, dated without a time for daily bars', () => {
    expect(
      tooltipContent(
        { time, open: 150000, high: 152500, low: 149050, close: 151235 },
        { format: 'inr', intraday: false },
      ),
    ).toEqual({
      time: '25 Sept 2026',
      rows: [
        { label: 'Open', value: '₹1,500.00' },
        { label: 'High', value: '₹1,525.00' },
        { label: 'Low', value: '₹1,490.50' },
        { label: 'Close', value: '₹1,512.35' },
      ],
    });
  });

  it('labels index levels as points and skips gaps', () => {
    expect(
      tooltipContent({ time, value: 2541860 }, { format: 'index', intraday: true })?.rows,
    ).toEqual([{ label: 'Level', value: '25,418.60' }]);
    expect(tooltipContent({ time }, { format: 'inr', intraday: true })).toBeNull();
  });
});
