import { createFileRoute } from '@tanstack/react-router';
import { PositionsPage } from '@/features/positions';

export const Route = createFileRoute('/_app/positions')({ component: PositionsPage });
