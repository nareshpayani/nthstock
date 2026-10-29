import type { Candle } from '@nthstock/contracts';
import { describe, expect, it } from 'vitest';
import { formatVolume, legendContent } from './chartLegend';

const bars: Candle[] = [
  { t: '2026-10-28T04:00:00Z', o: 10000, h: 10100, l: 9900, c: 10000, v: 1_234_567 },
  { t: '2026-10-28T04:05:00Z', o: 10000, h: 10300, l: 10000, c: 10200, v: 4_200 },
];

describe('chart legend (NSTOCK-0460)', () => {
  it('shows the bar, its change on the bar before, volume and studies', () => {
    const content = legendContent(
      bars,
      1,
      [{ key: 'sma20', study: 'sma20', values: [null, 10100] }],
      { format: 'inr', volume: true },
    );
    expect(content?.values.map((v) => v.value)).toEqual(['100.00', '103.00', '100.00', '102.00']);
    expect(content?.change).toMatchObject({ text: '▲ 2.00%', direction: 'up' });
    expect(content?.volume).toBe('4.2K');
    expect(content?.studies).toEqual([{ key: 'sma20', label: 'SMA 20', value: '101.00' }]);
  });

  it('leaves out volume when asked, and studies with no value yet', () => {
    const content = legendContent(
      bars,
      0,
      [{ key: 'sma20', study: 'sma20', values: [null, 10100] }],
      { format: 'inr', volume: false },
    );
    expect(content?.volume).toBeNull();
    expect(content?.studies).toEqual([]);
    expect(content?.change.direction).toBe('flat');
  });

  it('is null past the bars', () => {
    expect(legendContent(bars, 5, [], { format: 'inr', volume: true })).toBeNull();
  });

  it('shortens volume in K, lakh and crore', () => {
    expect(formatVolume(950)).toBe('950');
    expect(formatVolume(1_234_567)).toBe('12.35L');
    expect(formatVolume(25_000_000)).toBe('2.5Cr');
  });
});
