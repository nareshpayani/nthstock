import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { landscapeChartHeight, phoneChartHeight } from '@/shared/lib/phoneChart';
import { InstrumentSkeleton } from './PageSkeletons';

/** A screen of the given size, answering the width and height media queries. */
function screenOf(width: number, height: number) {
  const matches = (query: string) =>
    query.split(',').some((part) =>
      part.split(' and ').every((feature) => {
        const [, name, value] = /\(([\w-]+):\s*([^)]+)\)/.exec(feature) ?? [];
        const px = Number.parseFloat(value ?? '');
        if (name === 'max-width') return width <= px;
        if (name === 'min-width') return width >= px;
        if (name === 'max-height') return height <= px;
        if (name === 'min-height') return height >= px;
        return false;
      }),
    );
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: matches(query),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  vi.stubGlobal('innerHeight', height);
}

describe('the instrument skeleton (SPEC-CR-1 §5.6)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sizes the chart like the phone page in portrait', () => {
    screenOf(390, 844);
    render(<InstrumentSkeleton />);
    expect(screen.getByTestId('chart-skeleton')).toHaveStyle({
      height: `${String(phoneChartHeight(844))}px`,
    });
  });

  it('sizes the chart like the landscape page, so it does not jump on load', () => {
    screenOf(844, 390);
    render(<InstrumentSkeleton />);
    expect(screen.getByTestId('chart-skeleton')).toHaveStyle({
      height: `${String(landscapeChartHeight(390))}px`,
    });
  });
});
