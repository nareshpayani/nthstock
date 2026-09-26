import { createFileRoute } from '@tanstack/react-router';
import { FundsPage } from '@/features/funds';

export const Route = createFileRoute('/_app/funds')({ component: FundsPage });
