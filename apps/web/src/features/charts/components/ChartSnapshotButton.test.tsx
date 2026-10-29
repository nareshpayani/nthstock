import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChartSnapshotButton } from './ChartSnapshotButton';
import { IstClock } from './IstClock';
import type * as SnapshotModule from '../model/snapshot';
import type { ChartHandle } from './PriceChartCanvas';

const snapshot = vi.hoisted(() => ({
  chartSnapshot: vi.fn(),
  deliverSnapshot: vi.fn(),
}));
vi.mock('../model/snapshot', async (importOriginal) => ({
  ...(await importOriginal<typeof SnapshotModule>()),
  ...snapshot,
}));

const handle = {} as ChartHandle;

describe('ChartSnapshotButton (NSTOCK-0463)', () => {
  afterEach(() => vi.clearAllMocks());

  it('shares on a phone and says so', async () => {
    snapshot.chartSnapshot.mockResolvedValue(new Blob(['png']));
    snapshot.deliverSnapshot.mockResolvedValue('shared');
    render(<ChartSnapshotButton handle={handle} name="INFY" details={['1D']} touch />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Share the chart as an image' }));
    });
    expect(snapshot.chartSnapshot.mock.calls[0]?.[1]).toMatch(/^INFY · 1D · /);
    expect(snapshot.deliverSnapshot.mock.calls[0]?.[2]).toEqual({ share: true });
    expect(screen.getByRole('status')).toHaveTextContent('Chart image shared');
  });

  it('downloads on a desktop, and says when the image could not be made', async () => {
    snapshot.chartSnapshot.mockResolvedValueOnce(null);
    render(<ChartSnapshotButton handle={handle} name="INFY" details={[]} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save the chart as an image' }));
    });
    expect(screen.getByRole('status')).toHaveTextContent('Could not make the chart image');
    expect(snapshot.deliverSnapshot).not.toHaveBeenCalled();
  });

  it('waits for the chart', () => {
    render(<ChartSnapshotButton handle={null} name="INFY" details={[]} />);
    expect(screen.getByRole('button', { name: 'Save the chart as an image' })).toBeDisabled();
  });
});

describe('IstClock (NSTOCK-0463)', () => {
  afterEach(() => vi.useRealTimers());

  it('ticks each second in IST and stops when unmounted', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(new Date('2026-10-29T15:15:12Z'));
    const { unmount } = render(<IstClock />);
    const clock = screen.getByTestId('ist-clock');
    expect(clock).toHaveAttribute('aria-hidden', 'true');
    expect(clock).toHaveTextContent(/08:45:12 pm IST/i);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(clock).toHaveTextContent(/08:45:13 pm IST/i);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
