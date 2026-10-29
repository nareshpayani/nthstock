import { Button } from '@nthstock/ui';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useEffectEvent, useState } from 'react';
import { useApiClient } from '@/shared/lib/apiClientContext';
import { clearDemoPending, DEMO_PENDING_STORAGE_KEY, startDemo } from '@/shared/lib/demoSimulator';
import { useRequestOtp, useVerifyOtp } from '../hooks/useAuthMutations';
import { authFailure } from '../model/authError';
import { DEMO_INSTRUMENT, DEMO_MOBILE } from '../model/demo';
import { openDemoPosition } from '../model/demoPosition';
import { strings } from '../strings';

function isDemoPending(): boolean {
  try {
    return window.sessionStorage.getItem(DEMO_PENDING_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * "Try demo" (REQ-DEL-02): one tap logs in as the seeded demo user with the mock OTP and opens the
 * instrument page in demo mode, with the Demo simulator (TFC-12) and an open position guarded by a
 * trailing stop, so the chart shows both lines at once. Rendered only where the mock OTP is known
 * (`devOtp` is not null). `autoStart` (the reviewer link, `/login?try=1`) starts it without a tap.
 */
export function TryDemo({ devOtp, autoStart = false }: { devOtp: string; autoStart?: boolean }) {
  const navigate = useNavigate();
  const api = useApiClient();
  const requestOtp = useRequestOtp();
  const verifyOtp = useVerifyOtp();
  // After the Try demo reload (outside demo mode), carry on without a second tap.
  const [resume] = useState(isDemoPending);
  const [pending, setPending] = useState(resume || autoStart);
  const [error, setError] = useState<string | null>(null);

  /** `resumed`: the page already reloaded once for the demo account, so never reload again. */
  const run = async (resumed = false) => {
    try {
      // Outside demo mode the page reloads with the demo account first, then carries on in
      // `resume`. A second reload would loop, so after a resume it counts as a failure.
      if (startDemo() === 'reloading') {
        if (!resumed) return;
        throw new Error('demo mode did not start after the reload');
      }
      const sent = await requestOtp.mutateAsync({ mobile: DEMO_MOBILE, purpose: 'LOGIN' });
      await verifyOtp.mutateAsync({ requestId: sent.requestId, mobile: DEMO_MOBILE, otp: devOtp });
      await openDemoPosition(api, DEMO_INSTRUMENT);
      await navigate({ to: '/stocks/$symbol', params: { symbol: DEMO_INSTRUMENT }, replace: true });
    } catch (failure) {
      console.warn('Try demo failed', failure);
      setPending(false);
      setError(
        authFailure(failure).code === 'NETWORK' ? strings.errors.network : strings.errors.generic,
      );
    }
  };
  const start = () => {
    setPending(true);
    setError(null);
    void run();
  };

  const resumeDemo = useEffectEvent(() => {
    try {
      clearDemoPending(window.sessionStorage);
    } catch {
      // No storage, so no flag.
    }
    void run(true);
  });
  const autoStartDemo = useEffectEvent(() => {
    void run();
  });
  useEffect(() => {
    if (!resume && !autoStart) return undefined;
    // A task later, so a remount (Strict Mode) starts it once. A pending reload resumes first.
    const timer = window.setTimeout(resume ? resumeDemo : autoStartDemo, 0);
    return () => window.clearTimeout(timer);
  }, [resume, autoStart]);

  return (
    <div className="grid gap-2">
      <Button block disabled={pending} loading={pending} onClick={start}>
        {pending ? strings.demo.starting : strings.demo.label}
      </Button>
      {error ? (
        <p role="alert" className="text-label text-ink-muted">
          {error}
        </p>
      ) : null}
    </div>
  );
}
