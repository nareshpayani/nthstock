import { useOptionalToast } from '@nthstock/ui';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { useCallback } from 'react';
import { useApiClient } from '@/shared/lib/apiClientContext';
import { ensureSession } from '@/shared/lib/sessionClient';
import { useTicketIntentStore, type TicketIntent } from '@/shared/lib/ticketIntentStore';

/**
 * `opened`: the intent is set for the ticket. `login`: sent to log in first, intent kept.
 * `failed`: the session check or the navigation failed; the intent is cleared and a toast says so.
 */
export type OpenTicketResult = 'opened' | 'login' | 'failed';

export type OpenTicketOptions = {
  /** Where login returns to; this page when left out (the Trade sheet passes the stock's page). */
  redirect?: string;
};

const FAILED_TITLE = 'The order ticket did not open';
const failedBody = (symbol: string) => `Tap Buy or Sell on ${symbol} to try again.`;

/**
 * What a Buy or Sell button does (T-106): records the ticket intent, which opens the order ticket
 * slide-over (T-135) once a session is held. When nobody is logged in it goes to
 * /login?redirect=<this page>; the intent stays in memory across that client-side navigation, so
 * the ticket opens when the user is back. It never rejects: a failure clears the intent and shows
 * an error toast (NSTOCK-0466), so every caller gets the same feedback.
 */
export function useOpenTicket(): (
  intent: TicketIntent,
  options?: OpenTicketOptions,
) => Promise<OpenTicketResult> {
  const api = useApiClient();
  const navigate = useNavigate();
  const here = useRouterState({ select: (s) => s.location.href });
  const openTicket = useTicketIntentStore((s) => s.openTicket);
  const closeTicket = useTicketIntentStore((s) => s.closeTicket);
  const toast = useOptionalToast();
  return useCallback(
    async (intent, options) => {
      openTicket(intent);
      try {
        if (await ensureSession(api)) return 'opened';
        await navigate({ to: '/login', search: { redirect: options?.redirect ?? here } });
        return 'login';
      } catch (error) {
        console.error('The order ticket did not open', error);
        closeTicket();
        toast?.show({ tone: 'error', title: FAILED_TITLE, description: failedBody(intent.symbol) });
        return 'failed';
      }
    },
    [api, navigate, here, openTicket, closeTicket, toast],
  );
}
