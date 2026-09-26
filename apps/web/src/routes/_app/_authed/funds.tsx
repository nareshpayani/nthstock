import { createFileRoute } from '@tanstack/react-router';
import { FundsPage } from '@/features/funds';

export const Route = createFileRoute('/_app/_authed/funds')({ component: FundsPage });
