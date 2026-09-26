import { colors } from '@nthstock/tokens';
import { TickMarkType, type TickMarkFormatter, type Time } from 'lightweight-charts';
import { describe, expect, it } from 'vitest';
import { formatChartValue } from './chartFormat';
import {
  areaSeriesOptions,
  candleSeriesOptions,
  chartOptions,
  formatCrosshairTime,
  formatTickMark,
  withAlpha,
} from './chartTheme';

const customFormat = (format: unknown) =>
  (format as { formatter: (value: number) => string }).formatter;

// 2026-09-25 09:15 IST.
const open = (Date.parse('2026-09-25T03:45:00.000Z') / 1000) as Time;

describe('chart theme (T-094)', () => {
  it('turns token hex colours into rgba and rejects anything else', () => {
    expect(withAlpha(colors.up, 0.2)).toMatch(/^rgba\(\d+, \d+, \d+, 0\.2\)$/);
    expect(() => withAlpha('red', 1)).toThrow(RangeError);
  });

  it('labels integer values as rupees or index points, never floats', () => {
    expect(formatChartValue(151235, 'inr')).toBe('₹1,512.35');
    expect(formatChartValue(2541860.4, 'index')).toBe('25,418.60');
  });

  it('formats every tick mark and the crosshair in IST', () => {
    expect(formatTickMark(open, TickMarkType.Time)).toBe('09:15');
    expect(formatTickMark(open, TickMarkType.DayOfMonth)).toBe('25 Sept');
    expect(formatTickMark(open, TickMarkType.Month)).toBe('Sept');
    expect(formatTickMark(open, TickMarkType.Year)).toBe('2026');
    expect(formatCrosshairTime(open, true)).toBe('25 Sept, 09:15');
    expect(formatCrosshairTime(open, false)).toBe('25 Sept 2026');
  });

  it('builds chart options from tokens with an en-IN price formatter', () => {
    const options = chartOptions({ format: 'inr', intraday: true });
    const priceFormatter = options.localization?.priceFormatter as (value: number) => string;
    const timeFormatter = options.localization?.timeFormatter as (time: Time) => string;
    const tickMarks = options.timeScale?.tickMarkFormatter as TickMarkFormatter;
    expect(options.layout?.textColor).toBe(colors['ink-muted']);
    expect(options.grid?.horzLines?.color).toBe(colors.line);
    expect(options.timeScale?.timeVisible).toBe(true);
    expect(priceFormatter(250050)).toBe('₹2,500.50');
    expect(timeFormatter(open)).toBe('25 Sept, 09:15');
    expect(tickMarks(open, TickMarkType.Time, 'en-IN')).toBe('09:15');
    expect(chartOptions({ format: 'index', intraday: false }).timeScale?.timeVisible).toBe(false);
  });

  it('colours the area by direction and candles by up/down tokens', () => {
    expect(areaSeriesOptions('up', 'inr').lineColor).toBe(colors.up);
    expect(areaSeriesOptions('down', 'inr').lineColor).toBe(colors.down);
    expect(areaSeriesOptions('flat', 'inr').lineColor).toBe(colors.brand);
    expect(customFormat(areaSeriesOptions('up', 'index').priceFormat)(2541860)).toBe('25,418.60');
    const candles = candleSeriesOptions('inr');
    expect([candles.upColor, candles.downColor]).toEqual([colors.up, colors.down]);
    expect(customFormat(candles.priceFormat)(100)).toBe('₹1.00');
  });
});
