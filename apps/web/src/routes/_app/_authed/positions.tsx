import { createFileRoute } from '@tanstack/react-router';
import { PositionsPage } from '@/features/positions';

export const Route = createFileRoute('/_app/_authed/positions')({ component: PositionsPage });
