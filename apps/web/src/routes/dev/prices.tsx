import { TradingSymbol, WS_MAX_SUBSCRIPTIONS, type Exchange } from '@nthstock/contracts';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { PriceCell } from '@/shared/components/PriceCell';

// A bare test page for live prices (T-078): the Playwright smoke test watches these cells tick.
// Kept outside the app shell so nothing else on the page moves.
//
// `?symbols=A,B,…` (T-170, render-performance test) instead shows one watchlist-style row per NSE
// symbol, up to the 200 a connection may subscribe to, all mounted at once (the real watchlist
// mounts only the rows in view), so every one of them ticks.
const cells: readonly { symbol: string; exchange: Exchange; format: 'inr' | 'index' }[] = [
  { symbol: 'NIFTY50', exchange: 'NSE', format: 'index' },
  { symbol: 'SENSEX', exchange: 'BSE', format: 'index' },
  { symbol: 'INFY', exchange: 'NSE', format: 'inr' },
  { symbol: 'TCS', exchange: 'NSE', format: 'inr' },
  { symbol: 'RELIANCE', exchange: 'NSE', format: 'inr' },
];

const symbolsOf = (value: string | undefined) => [
  ...new Set((value ?? '').split(',').filter(Boolean)),
];

// Kept as the comma-separated string, so the router writes the URL back unchanged.
const pricesSearch = z.object({
  symbols: z
    .string()
    .refine((value) => {
      const symbols = symbolsOf(value);
      return (
        symbols.length <= WS_MAX_SUBSCRIPTIONS &&
        symbols.every((symbol) => TradingSymbol.safeParse(symbol).success)
      );
    })
    .optional()
    .catch(undefined),
});

function StressRows({ symbols }: { symbols: readonly string[] }) {
  return (
    <main className="mx-auto max-w-md p-6">
      <h1 className="mb-4 text-title text-ink">Live prices ({symbols.length})</h1>
      <ul aria-label="Stress watchlist">
        {symbols.map((symbol) => (
          <li
            key={symbol}
            className="flex h-10 items-center justify-between border-b border-line"
            data-testid={`live-${symbol}`}
          >
            <span className="text-label font-semibold text-ink">{symbol}</span>
            <PriceCell symbol={symbol} exchange="NSE" format="inr" />
          </li>
        ))}
      </ul>
    </main>
  );
}

function LivePricesTestPage() {
  const symbols = symbolsOf(Route.useSearch().symbols);
  if (symbols.length > 0) return <StressRows symbols={symbols} />;
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

export const Route = createFileRoute('/dev/prices')({
  validateSearch: (search: Record<string, unknown>) => pricesSearch.parse(search),
  component: LivePricesTestPage,
});
