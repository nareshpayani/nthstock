import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SectionBoundary } from './SectionBoundary';

let shouldThrow = true;
function Flaky() {
  if (shouldThrow) throw new Error('render failed');
  return <p>Movers loaded</p>;
}

const copy = { title: 'Section failed', description: 'Try again.', retryLabel: 'Try again' };

beforeEach(() => {
  shouldThrow = true;
  // React logs caught render errors; keep the test output clean.
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('SectionBoundary (T-099)', () => {
  it('keeps a crash inside its section and retries it', () => {
    render(
      <>
        <SectionBoundary label="Stocks lists" {...copy}>
          <p>Lists loaded</p>
        </SectionBoundary>
        <SectionBoundary label="Market movers" {...copy}>
          <Flaky />
        </SectionBoundary>
      </>,
    );
    const alert = screen.getByRole('alert');
    expect(screen.getByRole('region', { name: 'Market movers' })).toContainElement(alert);
    expect(alert).toHaveTextContent('Section failed');
    expect(screen.getByText('Lists loaded')).toBeInTheDocument();

    shouldThrow = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByText('Movers loaded')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('renders its children untouched when nothing fails', () => {
    shouldThrow = false;
    render(
      <SectionBoundary label="Market movers" {...copy}>
        <Flaky />
      </SectionBoundary>,
    );
    expect(screen.getByText('Movers loaded')).toBeInTheDocument();
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });
});
