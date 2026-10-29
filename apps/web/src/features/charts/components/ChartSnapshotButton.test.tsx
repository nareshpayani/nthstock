import { ToastProvider } from '@nthstock/ui';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChartSnapshotButton } from './ChartSnapshotButton';
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

  it('saves on a desktop and shows a toast', async () => {
    snapshot.chartSnapshot.mockResolvedValue(new Blob(['png']));
    snapshot.deliverSnapshot.mockResolvedValue('downloaded');
    render(
      <ToastProvider>
        <ChartSnapshotButton handle={handle} name="INFY" details={['1D']} />
      </ToastProvider>,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save the chart as an image' }));
    });
    expect(snapshot.deliverSnapshot.mock.calls[0]?.[2]).toEqual({ share: false });
    expect(await screen.findByText('Chart image saved')).toBeVisible();
    expect(screen.getAllByText('Chart image saved')).toHaveLength(1);
  });

  it('shows the failure in a toast when delivery throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    snapshot.chartSnapshot.mockResolvedValue(new Blob(['png']));
    snapshot.deliverSnapshot.mockRejectedValue(new Error('denied'));
    render(
      <ToastProvider>
        <ChartSnapshotButton handle={handle} name="INFY" details={[]} touch />
      </ToastProvider>,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Share the chart as an image' }));
    });
    expect(await screen.findByText(/Could not make the chart image/)).toBeVisible();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('says nothing when the share sheet is cancelled', async () => {
    snapshot.chartSnapshot.mockResolvedValue(new Blob(['png']));
    snapshot.deliverSnapshot.mockResolvedValue('cancelled');
    render(<ChartSnapshotButton handle={handle} name="INFY" details={[]} touch />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Share the chart as an image' }));
    });
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('waits for the chart', () => {
    render(<ChartSnapshotButton handle={null} name="INFY" details={[]} />);
    expect(screen.getByRole('button', { name: 'Save the chart as an image' })).toBeDisabled();
  });
});
