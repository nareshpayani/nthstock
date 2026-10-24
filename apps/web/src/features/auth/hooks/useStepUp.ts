import { useCallback } from 'react';
import { useSessionStore } from '@/shared/lib/sessionStore';
import { authFailure } from '../model/authError';
import { useStepUpStore } from '../store/stepUpStore';

/**
 * Wraps a sensitive call (NSTOCK-0219): when it answers 403 STEP_UP_REQUIRED, the step-up dialog
 * opens, and once the user confirms, the call is retried once. Cancelling rejects with
 * `StepUpCancelledError`. Needs `<StepUpDialog />` mounted on the page.
 */
export function useStepUp() {
  const ask = useStepUpStore((state) => state.ask);
  return useCallback(
    async <T>(call: () => Promise<T>): Promise<T> => {
      try {
        return await call();
      } catch (failure) {
        const { code, details } = authFailure(failure);
        if (code !== 'STEP_UP_REQUIRED') throw failure;
        await ask(details.totpRequired ?? false);
        return call();
      }
    },
    [ask],
  );
}

/** Steps up only if the last step-up ends within this long, so the action that follows has time. */
const STEP_UP_MARGIN_MS = 60_000;

/**
 * Steps up before an action whose own form asks for a code (turning two-factor off, new recovery
 * codes): opening the step-up dialog mid-way would spend the code the user is about to type, as
 * each TOTP code works once. Resolves at once while the last step-up is still fresh.
 */
export function useEnsureSteppedUp() {
  const ask = useStepUpStore((state) => state.ask);
  return useCallback(async () => {
    const until = useStepUpStore.getState().steppedUpUntil;
    if (until !== null && until - Date.now() > STEP_UP_MARGIN_MS) return;
    const totpEnabled = useSessionStore.getState().session?.user.totpEnabled ?? false;
    await ask(totpEnabled);
  }, [ask]);
}
