import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ChartSkeleton } from './ChartSkeleton';

describe('ChartSkeleton (CR-T17)', () => {
  it('announces loading at the chart’s own height, with a plot, a price axis and a time axis', () => {
    render(<ChartSkeleton height={338} label="Loading chart" />);
    const status = screen.getByRole('status', { name: 'Loading chart' });
    expect(status).toHaveStyle({ height: '338px' });
    // Five grid rows in the plot and five price stubs down the axis, three time stubs.
    expect(status.querySelectorAll('[data-skeleton]')).toHaveLength(8);
  });
});
