import { createFileRoute } from '@tanstack/react-router';
import { StockDetailPage } from '@/features/stockDetail';

function StockRoute() {
  const { symbol } = Route.useParams();
  return <StockDetailPage symbol={symbol.toUpperCase()} />;
}

export const Route = createFileRoute('/_app/stocks/$symbol')({ component: StockRoute });
