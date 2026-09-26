import { createFileRoute } from '@tanstack/react-router';
import { PortfolioPage } from '@/features/holdings';

export const Route = createFileRoute('/_app/_authed/portfolio')({ component: PortfolioPage });
