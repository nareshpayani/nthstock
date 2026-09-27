import { useNavigate, useRouterState } from '@tanstack/react-router';
import { useCallback } from 'react';
import { useApiClient } from '@/shared/lib/apiClientContext';
import { ensureSession } from '@/shared/lib/sessionClient';
import { useTicketIntentStore, type TicketIntent } from '@/shared/lib/ticketIntentStore';

/** `opened`: the intent is set for the ticket. `login`: sent to log in first, intent kept. */
export type OpenTicketResult = 'opened' | 'login';

/**
 * What a Buy or Sell button does (T-106): records the ticket intent, which opens the order ticket
 * slide-over (T-135) once a session is held. When nobody is logged in it goes to
 * /login?redirect=<this page>; the intent stays in memory across that client-side navigation, so
 * the ticket opens when the user is back.
 */
export function useOpenTicket(): (intent: TicketIntent) => Promise<OpenTicketResult> {
  const api = useApiClient();
  const navigate = useNavigate();
  const here = useRouterState({ select: (s) => s.location.href });
  const openTicket = useTicketIntentStore((s) => s.openTicket);
  return useCallback(
    async (intent) => {
      openTicket(intent);
      if (await ensureSession(api)) return 'opened';
      await navigate({ to: '/login', search: { redirect: here } });
      return 'login';
    },
    [api, navigate, here, openTicket],
  );
}
