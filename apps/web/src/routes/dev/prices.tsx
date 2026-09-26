import type { Exchange } from '@nthstock/contracts';
import { createFileRoute } from '@tanstack/react-router';
import { PriceCell } from '@/shared/components/PriceCell';

// A bare test page for live prices (T-078): the Playwright smoke test watches these cells tick.
// Kept outside the app shell so nothing else on the page moves.
const cells: readonly { symbol: string; exchange: Exchange; format: 'inr' | 'index' }[] = [
  { symbol: 'NIFTY50', exchange: 'NSE', format: 'index' },
  { symbol: 'SENSEX', exchange: 'BSE', format: 'index' },
  { symbol: 'INFY', exchange: 'NSE', format: 'inr' },
  { symbol: 'TCS', exchange: 'NSE', format: 'inr' },
  { symbol: 'RELIANCE', exchange: 'NSE', format: 'inr' },
];

function LivePricesTestPage() {
  return (
    <main className="mx-auto max-w-md p-6">
      <h1 className="mb-4 text-title text-ink">Live prices</h1>
      <dl className="grid grid-cols-[auto_1fr] items-center gap-x-6 gap-y-2">
        {cells.map((cell) => (
          <div key={cell.symbol} className="contents" data-testid={`live-${cell.symbol}`}>
            <dt className="text-label font-semibold text-ink-muted">{cell.symbol}</dt>
            <dd className="text-right">
              <PriceCell symbol={cell.symbol} exchange={cell.exchange} format={cell.format} />
            </dd>
          </div>
        ))}
      </dl>
    </main>
  );
}

export const Route = createFileRoute('/dev/prices')({ component: LivePricesTestPage });
